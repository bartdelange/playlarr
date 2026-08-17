import re
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, Mock, patch

from fastapi.testclient import TestClient

from music_importer.application.library_status import LibraryTrackStatus
from music_importer.domain.models import (
    AcquiredTrack,
    LidarrExecutionResult,
    LidarrPlan,
    LidarrPlanAction,
    MusicBrainzResult,
    PlaylistInfo,
    SourceTrack,
)
from music_importer.integrations.navidrome import NavidromeSong
from music_importer.persistence import ImportRepository
from music_importer.web.app import create_app


def config(directory: str):
    return SimpleNamespace(
        data_dir=Path(directory),
        output_dir=Path(directory),
        mb_base_url="https://example.invalid",
        mb_user_agent="test/1 (test@example.com)",
        mb_request_delay=0,
        mb_timeout=1,
        mb_max_retries=1,
        tidal_session_file=Path(directory) / "tidal.json",
        spotify_client_id="client",
        spotify_redirect_uri="http://127.0.0.1/callback",
        spotify_token_cache=Path(directory) / "spotify.json",
        lidarr_url="http://lidarr",
        lidarr_api_key="secret",
        lidarr_root_folder="/music",
        lidarr_enabled=True,
        lidarr_quality_profile_id=1,
        lidarr_metadata_profile_id=1,
        navidrome_url="http://navidrome",
        navidrome_username="user",
        navidrome_password="password",
        navidrome_enabled=True,
    )


def wait_for_job(repository: ImportRepository, job_id: str):
    deadline = time.monotonic() + 2
    while repository.get_job(job_id).status in {"queued", "running"}:
        if time.monotonic() >= deadline:
            raise AssertionError(f"job {job_id} did not finish")
        time.sleep(0.01)
    return repository.get_job(job_id)


def normalized_html(value: str) -> str:
    """Collapse formatting whitespace while preserving meaningful rendered content."""
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r">\s+", ">", value)
    value = re.sub(r"\s+<", "<", value)
    return re.sub(r"\s+>", ">", value)


class WebShellTests(unittest.TestCase):
    @patch("music_importer.web.routes.local_additions.NavidromeClient")
    def test_local_navidrome_additions_can_repeat_and_be_removed(self, navidrome_client):
        navidrome_client.return_value.search_songs.return_value = [
            NavidromeSong("song", "Local song", "Local artist", "Local album", "A/song.flac")
        ]
        navidrome_client.return_value.song.return_value = NavidromeSong(
            "song", "Local song", "Local artist", "Local album", "A/song.flac"
        )
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            client = TestClient(create_app(config(directory), repository))

            search = client.get(f"/imports/{imported.id}/local-additions?q=local")
            client.post(f"/imports/{imported.id}/local-additions", data={"song_id": "song"})
            client.post(f"/imports/{imported.id}/local-additions", data={"song_id": "song"})
            additions = repository.local_playlist_additions(imported.id)
            removed = client.post(
                f"/imports/{imported.id}/local-additions/{additions[0].id}/delete",
                follow_redirects=False,
            )
            remaining = repository.local_playlist_additions(imported.id)

        self.assertIn("Local song", search.text)
        self.assertEqual(len(additions), 2)
        self.assertEqual(removed.status_code, 303)
        self.assertEqual(len(remaining), 1)

    def test_playlist_update_fails_instead_of_starting_interactive_spotify_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/imports/{imported.id}/update", follow_redirects=False)
            job_id = response.headers["location"].rsplit("/", 1)[-1]
            job = wait_for_job(repository, job_id)

        self.assertEqual(job.status, "failed")
        self.assertIn("authenticate Spotify in Settings", job.error)

    def test_import_can_be_deleted_when_no_job_is_active(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            client = TestClient(create_app(config(directory), repository))

            detail = client.get(f"/imports/{imported.id}")
            response = client.post(f"/imports/{imported.id}/delete", follow_redirects=False)

            with self.assertRaises(KeyError):
                repository.get_import(imported.id)

        self.assertIn(f'action="/imports/{imported.id}/delete"', detail.text)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/")

    def test_playlist_update_preview_and_apply(self):
        class Source:
            entry_reads = 0

            def login(self):
                pass

            def get_playlist(self, playlist_id):
                return PlaylistInfo("spotify", playlist_id, "Updated Mix", track_count=2)

            def get_entries(self, playlist):
                self.entry_reads += 1
                return [
                    AcquiredTrack(
                        0, SourceTrack("spotify", "added", "Added", ("Artist",), "Album")
                    ),
                    AcquiredTrack(1, SourceTrack("spotify", "kept", "Kept", ("Artist",), "Album")),
                ]

        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack("spotify", "kept", "Kept", ("Artist",), "Album"),
                    SourceTrack("spotify", "removed", "Removed", ("Artist",), "Album"),
                ],
            )
            app = create_app(config(directory), repository)
            app.state.context.sources["spotify"] = Source()
            client = TestClient(app)

            preview_start = client.get(f"/imports/{imported.id}/update", follow_redirects=False)
            preview_job = preview_start.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, preview_job)
            preview = client.get(f"/imports/{imported.id}/update?preview_job={preview_job}")
            token = re.search(r'name="update_token" value="([a-f0-9]+)"', preview.text).group(1)
            applied = client.post(
                f"/imports/{imported.id}/update",
                data={"update_token": token, "preview_job": preview_job},
                follow_redirects=False,
            )
            job_id = applied.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, job_id)
            detail = client.get(f"/imports/{imported.id}")
            entries = repository.entries(imported.id)
            job_status = repository.get_job(job_id).status

        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview_start.status_code, 303)
        preview_html = normalized_html(preview.text)
        self.assertIn("1</strong>added", preview_html)
        self.assertIn("1</strong>removed", preview_html)
        self.assertIn('data-state="added"', preview.text)
        self.assertIn('data-state="removed"', preview.text)
        self.assertNotIn("Stored snapshot", preview.text)
        self.assertEqual(applied.status_code, 303)
        self.assertEqual(applied.headers["location"], f"/jobs/{job_id}")
        self.assertEqual(job_status, "completed")
        self.assertEqual(app.state.context.sources["spotify"].entry_reads, 1)
        self.assertEqual([entry.track.source_track_id for entry in entries], ["added", "kept"])
        self.assertIn("Playlist refresh history (1)", detail.text)

    def test_mapping_override_page_previews_and_applies_selected_isrc_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            source_import = repository.create_import(PlaylistInfo("spotify", "source", "A"))
            target_import = repository.create_import(PlaylistInfo("tidal", "target", "B"))
            repository.replace_tracks(
                source_import.id,
                [SourceTrack("spotify", "one", "Source", ("Artist",), "Album", isrc="MATCH")],
            )
            repository.replace_tracks(
                target_import.id,
                [SourceTrack("tidal", "two", "Target", ("Artist",), "Album", isrc="MATCH")],
            )
            source_entry = repository.entries(source_import.id)[0]
            target_entry = repository.entries(target_import.id)[0]
            repository.save_manual_resolution(
                source_entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_title="Mapped title",
                    recording_ids=("recording",),
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            client = TestClient(create_app(config(directory), repository))

            preview = client.get(
                f"/imports/{target_import.id}/mapping-overrides",
                params={"source_import_id": source_import.id},
            )
            applied = client.post(
                f"/imports/{target_import.id}/mapping-overrides",
                data={
                    "source_import_id": source_import.id,
                    "target_entry_ids": str(target_entry.id),
                },
                follow_redirects=False,
            )
            saved = repository.entry(target_entry.id)

        self.assertIn("Overrides existing", preview.text)
        self.assertIn("Accepted and ignored", preview.text)
        self.assertIn("Mapped title", preview.text)
        self.assertEqual(applied.status_code, 303)
        self.assertEqual(saved.result.recording_ids, ("recording",))

    def test_failed_playlist_update_job_stays_on_error_page(self):
        class Source:
            def login(self):
                pass

            def get_playlist(self, playlist_id):
                return PlaylistInfo("spotify", playlist_id, "Changed Mix", track_count=1)

            def get_entries(self, playlist):
                return [
                    AcquiredTrack(
                        0, SourceTrack("spotify", "changed", "Changed", ("Artist",), "Album")
                    )
                ]

        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [SourceTrack("spotify", "original", "Original", ("Artist",), "Album")],
            )
            app = create_app(config(directory), repository)
            app.state.context.sources["spotify"] = Source()
            client = TestClient(app)

            preview_start = client.get(f"/imports/{imported.id}/update", follow_redirects=False)
            preview_job = preview_start.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, preview_job)
            response = client.post(
                f"/imports/{imported.id}/update",
                data={"update_token": "stale", "preview_job": preview_job},
                follow_redirects=False,
            )
            job_id = response.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, job_id)
            job_page = client.get(f"/jobs/{job_id}")
            job = repository.get_job(job_id)

        self.assertEqual(job.status, "failed")
        self.assertIn("the source playlist changed", job.error)
        self.assertIn("j.status === 'completed'", job_page.text)

    def test_playlist_catalogue_is_loaded_live_in_a_background_job(self):
        class Source:
            catalogue_reads = 0

            def login(self):
                pass

            def list_playlists(self):
                self.catalogue_reads += 1
                return [PlaylistInfo("spotify", "playlist", "Live Mix", track_count=12)]

        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            app = create_app(config(directory), repository)
            source = Source()
            app.state.context.sources["spotify"] = source
            client = TestClient(app)

            first = client.get("/imports/new?source=spotify", follow_redirects=False)
            first_job = first.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, first_job)
            completion_url = client.get(f"/api/jobs/{first_job}").json()["completion_url"]
            catalogue = client.get(completion_url)
            second = client.get("/imports/new?source=spotify", follow_redirects=False)
            second_job = second.headers["location"].rsplit("/", 1)[-1]
            wait_for_job(repository, second_job)

        self.assertEqual(first.status_code, 303)
        self.assertIn("Live Mix", catalogue.text)
        self.assertIn("12 tracks", catalogue.text)
        self.assertNotEqual(first_job, second_job)
        self.assertEqual(source.catalogue_reads, 2)

    def test_playlist_acquisition_runs_in_a_background_job(self):
        class Source:
            def login(self):
                pass

            def get_playlist(self, playlist_id):
                return PlaylistInfo("spotify", playlist_id, "Imported Mix", track_count=1)

            def get_entries(self, playlist):
                return [
                    AcquiredTrack(0, SourceTrack("spotify", "track", "Song", ("Artist",), "Album"))
                ]

        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            app = create_app(config(directory), repository)
            app.state.context.sources["spotify"] = Source()
            client = TestClient(app)

            response = client.post(
                "/imports",
                data={"source": "spotify", "playlist_id": "playlist"},
                follow_redirects=False,
            )
            job_id = response.headers["location"].rsplit("/", 1)[-1]
            job = wait_for_job(repository, job_id)
            imported = repository.get_import(job.import_id)
            entries = repository.entries(imported.id)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], f"/jobs/{job_id}")
        self.assertEqual(job.status, "completed")
        self.assertEqual(imported.playlist_name, "Imported Mix")
        self.assertEqual([entry.track.title for entry in entries], ["Song"])

    def test_playlist_analysis_fetches_metadata_inside_background_job(self):
        class Source:
            def login(self):
                pass

            def get_playlist(self, playlist_id):
                return PlaylistInfo("spotify", playlist_id, "Analyzed Mix", track_count=1)

            def get_tracks(self, playlist):
                return [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]

        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            app = create_app(config(directory), repository)
            app.state.context.sources["spotify"] = Source()
            client = TestClient(app)
            batch = SimpleNamespace(
                results=[MusicBrainzResult(resolved_via="isrc")],
                summary=SimpleNamespace(unresolved=0),
            )

            with (
                patch(
                    "music_importer.web.routes.catalogue.ResolutionService"
                ) as resolution_service,
                patch("music_importer.web.routes.catalogue.LidarrClient") as lidarr_client,
            ):
                resolution_service.return_value.resolve_tracks.return_value = batch
                lidarr_client.return_value.compare.return_value = ({}, {})
                response = client.post(
                    "/playlists/spotify/playlist/analyze", follow_redirects=False
                )
                job_id = response.headers["location"].rsplit("/", 1)[-1]
                job = wait_for_job(repository, job_id)

            analysis = repository.playlist_analyses("spotify")["playlist"]

        self.assertEqual(response.status_code, 303)
        self.assertEqual(job.status, "completed")
        self.assertEqual(analysis["tracks"], 1)

    def test_export_stage_filters_downloaded_and_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack("spotify", "one", "Downloaded Song", ("Artist",), "Album"),
                    SourceTrack("spotify", "two", "Missing Song", ("Artist",), "Album"),
                ],
            )
            repository.set_workflow_state(imported.id, "waiting_for_downloads")
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan(()))
            repository.approve_lidarr_plan(plan_id)
            repository.record_lidarr_execution(plan_id, [])
            repository.save_library_status(
                imported.id,
                [
                    LibraryTrackStatus(0, "represented_locally", "/music/downloaded.flac"),
                    LibraryTrackStatus(1, "release_missing"),
                ],
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/imports/{imported.id}?stage=final")

        html = normalized_html(response.text)
        self.assertIn(">All (2)</button>", html)
        self.assertIn(">Downloaded (1)</button>", html)
        self.assertIn(">Missing but downloadable (1)</button>", html)
        self.assertIn(">Not downloadable (0)</button>", html)
        self.assertNotIn(">Automatic</button>", html)
        self.assertIn('data-availability="downloaded"', response.text)
        self.assertIn('data-availability="downloadable"', response.text)
        self.assertIn(">Missing but downloadable</span>", html)
        self.assertIn("/music/downloaded.flac", response.text)
        self.assertIn("Selected release is not currently present in Lidarr", response.text)
        self.assertIn("Choose visible columns", response.text)
        self.assertIn("sessionStorage", response.text)

    def test_export_stage_shows_recording_scoped_lidarr_match(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "one", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("requested-recording",),
                    recording_title="Song (extended mix)",
                    artist_names=("Artist",),
                    primary_artist_id="artist",
                    release_group_ids=("requested-group",),
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan(
                    (
                        LidarrPlanAction(
                            "reuse_downloaded_release",
                            "artist",
                            "Artist",
                            "matched-group",
                            "Matched Album",
                            "downloaded_recording_match",
                            {
                                "mapped_release_group_ids": ["requested-group"],
                                "requested_recording_ids": ["requested-recording"],
                                "lidarr_album_id": 20,
                                "matched_track": {
                                    "title": "Song (extended mix)",
                                    "track_number": "1",
                                    "foreign_recording_id": "requested-recording",
                                    "track_file_id": 91,
                                    "has_file": True,
                                    "match_method": "recording_id",
                                },
                            },
                        ),
                    )
                ),
            )
            repository.approve_lidarr_plan(plan_id)
            repository.record_lidarr_execution(
                plan_id,
                [
                    LidarrExecutionResult(
                        repository.get_lidarr_plan(plan_id)[2].actions[0], "unchanged"
                    )
                ],
            )
            repository.save_library_status(
                imported.id, [LibraryTrackStatus(0, "represented_locally", "/music/song.flac")]
            )
            client = TestClient(create_app(config(directory), repository))

            export = client.get(f"/imports/{imported.id}?stage=final")
            review = client.get(f"/imports/{imported.id}?stage=match")

        self.assertIn("<th>Lidarr matched</th>", export.text)
        self.assertIn("Matched Lidarr track", export.text)
        self.assertIn("Exact recording ID", export.text)
        self.assertIn("Lidarr file 91", export.text)
        self.assertIn("Matched Album", export.text)
        self.assertNotIn("<th>Lidarr matched</th>", review.text)
        self.assertNotIn("<th>Matched recording</th>", export.text)

    def test_export_stage_explains_safety_skip_from_executed_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [SourceTrack("spotify", "one", "Guide You", ("Sound Rush",), "Compilation")],
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    recording_title="Guide You",
                    artist_names=("Sound Rush",),
                    primary_artist_id="artist",
                    release_group_ids=("group",),
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            action = LidarrPlanAction(
                "skip", "artist", "Sound Rush", "group", "Compilation", "various_artists_album"
            )
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan((action,)))
            repository.approve_lidarr_plan(plan_id)
            repository.record_lidarr_execution(
                plan_id, [LidarrExecutionResult(action, "unchanged", "various_artists_album")]
            )
            repository.save_library_status(imported.id, [LibraryTrackStatus(0, "release_missing")])
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/imports/{imported.id}?stage=final")

        self.assertIn("Not added: selected release is a Various Artists compilation", response.text)
        self.assertIn(">Not downloadable</span>", normalized_html(response.text))
        self.assertIn("skip: unchanged", response.text)

    def test_matching_session_advances_after_each_decision_and_finishes(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack("spotify", "one", "First", ("Artist",), "Album"),
                    SourceTrack("spotify", "two", "Second", ("Artist",), "Album"),
                ],
            )
            entries = repository.entries(imported.id)
            for entry in entries:
                repository.save_automatic_resolution(entry.id, MusicBrainzResult())
            repository.set_workflow_state(imported.id, "review_required")
            client = TestClient(create_app(config(directory), repository))

            started = client.get(f"/imports/{imported.id}/review", follow_redirects=False)
            first_page = client.get(started.headers["location"])
            advanced = client.post(
                f"/entries/{entries[0].id}/skip", data={"session": "true"}, follow_redirects=False
            )
            finished = client.post(
                f"/entries/{entries[1].id}/skip", data={"session": "true"}, follow_redirects=False
            )
            final_state = repository.get_import(imported.id).workflow_state

        self.assertEqual(
            started.headers["location"], f"/entries/{entries[0].id}/review?session=true"
        )
        self.assertIn("Track 1 of 2", first_page.text)
        self.assertEqual(
            advanced.headers["location"], f"/entries/{entries[1].id}/review?session=true"
        )
        self.assertEqual(finished.headers["location"], f"/imports/{imported.id}")
        self.assertEqual(final_state, "ready_to_plan")

    def test_review_can_apply_manual_match_from_another_playlist(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            source_import = repository.create_import(PlaylistInfo("spotify", "source", "Partee"))
            target_import = repository.create_import(
                PlaylistInfo("spotify", "target", "Harde Stijl")
            )
            track = SourceTrack("spotify", "same-track", "Song", ("Artist",), "Album")
            repository.replace_tracks(source_import.id, [track])
            repository.replace_tracks(target_import.id, [track])
            source_entry = repository.entries(source_import.id)[0]
            target_entry = repository.entries(target_import.id)[0]
            repository.save_manual_resolution(
                source_entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    recording_title="Song",
                    artist_names=("Artist",),
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            client = TestClient(create_app(config(directory), repository))

            review = client.get(f"/entries/{target_entry.id}/review")
            applied = client.post(
                f"/entries/{target_entry.id}/reuse/{source_entry.id}", follow_redirects=False
            )
            saved = repository.entry(target_entry.id)

        self.assertIn("Manually matched in Partee", review.text)
        self.assertEqual(applied.status_code, 303)
        self.assertTrue(saved.is_manual)
        self.assertEqual(saved.resolution_method, "reused_manual")
        self.assertEqual(saved.result.recording_ids, ("recording",))

    def test_reimporting_a_playlist_opens_canonical_import_without_acquiring_again(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            older = repository.create_import(PlaylistInfo("spotify", "same", "My Mix"))
            repository.replace_tracks(
                older.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            duplicate = repository.create_import(PlaylistInfo("spotify", "same", "My Mix"))
            repository.replace_tracks(
                duplicate.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            repository.set_workflow_state(older.id, "library_status")
            client = TestClient(create_app(config(directory), repository))

            response = client.post(
                "/imports",
                data={"source": "spotify", "playlist_id": "same"},
                follow_redirects=False,
            )
            dashboard = client.get("/")

        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], f"/imports/{older.id}")
        self.assertEqual(dashboard.text.count("<h2>My Mix</h2>"), 1)

    def test_interrupted_progress_wins_over_an_unstarted_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            blank = repository.create_import(PlaylistInfo("spotify", "same", "My Mix"))
            repository.replace_tracks(
                blank.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            progressed = repository.create_import(PlaylistInfo("spotify", "same", "My Mix"))
            repository.replace_tracks(
                progressed.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(progressed.id)[0]
            repository.save_automatic_resolution(
                entry.id, MusicBrainzResult(resolved_via="isrc", recording_ids=("recording",))
            )
            repository.set_workflow_state(progressed.id, "resolution_interrupted")
            client = TestClient(create_app(config(directory), repository))

            canonical = repository.find_import("spotify", "same")
            stale_page = client.get(f"/imports/{blank.id}", follow_redirects=False)

        self.assertEqual(canonical.id, progressed.id)
        self.assertEqual(stale_page.status_code, 307)
        self.assertEqual(stale_page.headers["location"], f"/imports/{progressed.id}")

    @patch("music_importer.web.routes.settings.LidarrClient")
    def test_dashboard_and_import_review_render_persisted_state_without_secrets(
        self, lidarr_client
    ):
        lidarr_client.return_value.root_folders.return_value = [("/music", "/music")]
        lidarr_client.return_value.quality_profiles.return_value = [(1, "Standard")]
        lidarr_client.return_value.metadata_profiles.return_value = [(1, "Standard")]
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "My Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            client = TestClient(create_app(config(directory), repository))

            dashboard = client.get("/")
            detail = client.get(f"/imports/{imported.id}")
            source_step = client.get("/imports/new?source=unknown")
            source_start = client.get("/imports/new")
            settings = client.get("/settings")
            premature_library = client.post(
                f"/imports/{imported.id}/library-status", follow_redirects=False
            )

        self.assertEqual(dashboard.status_code, 200)
        self.assertIn("<title>Playlarr</title>", dashboard.text)
        self.assertIn('class="brand" href="/">Playlarr</a>', dashboard.text)
        self.assertIn("My Mix", dashboard.text)
        self.assertIn("Song", detail.text)
        self.assertIn("pending", detail.text)
        self.assertIn("Resolve 1 tracks", detail.text)
        detail_html = normalized_html(detail.text)
        self.assertIn('class="active" href="/imports/', detail_html)
        self.assertIn('aria-current="step">1 Music match', detail_html)
        self.assertIn('aria-current="step">2 Playlist', source_step.text)
        self.assertIn("Authorization Code + PKCE", source_start.text)
        self.assertNotIn("Authorization Code + PKCE", source_step.text)
        self.assertNotIn("Import an existing mapping", source_start.text)
        self.assertNotIn("CSV exports", detail.text)
        self.assertIn("<th>Matched recording</th>", detail.text)
        self.assertNotIn("<th>Library state</th>", detail.text)
        self.assertNotIn("Refresh monitored &amp; downloaded", detail.text)
        self.assertNotIn(">1 Source<", detail.text)
        self.assertNotIn(">2 Playlist<", detail.text)
        self.assertEqual(premature_library.status_code, 409)
        self.assertNotIn("secret", settings.text)
        self.assertIn("Configured — enter to replace", settings.text)
        self.assertIn('for="services-tab">Services</label>', settings.text)
        self.assertIn('for="data-tab">Data Settings</label>', settings.text)
        self.assertNotIn('name="output_dir"', settings.text)

    @patch("music_importer.web.routes.settings.LidarrClient")
    def test_lidarr_settings_load_named_options_and_preserve_selection(self, lidarr_client):
        lidarr_client.return_value.root_folders.return_value = [
            ("/archive", "/archive"),
            ("/music", "/music"),
        ]
        lidarr_client.return_value.quality_profiles.return_value = [
            (1, "Lossless"),
            (2, "Standard"),
        ]
        lidarr_client.return_value.metadata_profiles.return_value = [
            (1, "Standard"),
            (3, "Extended"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            configured = config(directory)
            configured.lidarr_quality_profile_id = 2
            configured.lidarr_metadata_profile_id = 3
            client = TestClient(
                create_app(configured, ImportRepository(Path(directory) / "state.db"))
            )

            response = client.get("/settings")

        html = normalized_html(response.text)
        self.assertIn('<select name="lidarr_root_folder">', html)
        self.assertIn('<option value="/music" selected>/music</option>', html)
        self.assertIn('<option value="2" selected>Standard</option>', html)
        self.assertIn('<option value="3" selected>Extended</option>', html)

    @patch("music_importer.web.routes.settings.LidarrClient")
    def test_lidarr_options_are_disabled_without_an_api_key(self, lidarr_client):
        with tempfile.TemporaryDirectory() as directory:
            unconfigured = config(directory)
            unconfigured.lidarr_api_key = None
            client = TestClient(
                create_app(unconfigured, ImportRepository(Path(directory) / "state.db"))
            )

            response = client.get("/settings")

        self.assertEqual(response.text.count('<select name="lidarr_'), 3)
        self.assertIn('name="lidarr_root_folder" disabled', response.text)
        self.assertIn("Save a Lidarr URL and API key", response.text)
        lidarr_client.assert_not_called()

    def test_each_service_settings_form_updates_only_its_own_block(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            client = TestClient(create_app(config(directory), repository))

            response = client.post(
                "/settings/services/musicbrainz",
                data={"mb_user_agent": "playlarr@example.com"},
                follow_redirects=False,
            )

            stored = repository.get_setting("service_config", {})

            self.assertEqual(response.status_code, 303)
            self.assertEqual(stored, {"mb_user_agent": "playlarr@example.com"})

    def test_service_settings_accept_omitted_controls_and_ignore_other_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            client = TestClient(create_app(config(directory), repository))

            response = client.post(
                "/settings/services/lidarr",
                data={
                    "lidarr_url": "http://new-lidarr",
                    "spotify_client_id": "must-not-change",
                },
                follow_redirects=False,
            )
            stored = repository.get_setting("service_config", {})

        self.assertEqual(response.status_code, 303)
        self.assertEqual(stored, {"lidarr_url": "http://new-lidarr"})

    def test_job_status_is_json_and_unknown_import_is_404(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            job = repository.create_job("resolution", total=10)
            repository.update_job(job.id, current=3, current_item="Artist — Song")
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/api/jobs/{job.id}")
            missing_status = client.get("/imports/missing").status_code

        self.assertEqual(response.json()["current"], 3)
        self.assertEqual(missing_status, 404)

    def test_lidarr_planning_job_opens_plan_and_playlist_table_stays_review_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    release_group_ids=("group",),
                    primary_artist_id="artist",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            repository.save_lidarr_plan(imported.id, LidarrPlan(()))
            job = repository.create_job("lidarr_planning", imported.id, total=1)
            client = TestClient(create_app(config(directory), repository))

            detail = client.get(f"/imports/{imported.id}")
            job_page = client.get(f"/jobs/{job.id}")

        self.assertIn('aria-current="step">2 Lidarr', normalized_html(detail.text))
        self.assertIn("Apply to Lidarr", detail.text)
        self.assertIn(f"/imports/{imported.id}?stage=lidarr", job_page.text)

    def test_lidarr_stage_owns_plan_creation_and_final_warns_for_unapplied_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    release_group_ids=("group",),
                    primary_artist_id="artist",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            client = TestClient(create_app(config(directory), repository))

            match_page = client.get(f"/imports/{imported.id}?stage=match")
            empty_plan = client.get(f"/imports/{imported.id}?stage=lidarr")
            blocked_final = client.get(
                f"/imports/{imported.id}?stage=final", follow_redirects=False
            )
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan(()))
            draft_page = client.get(f"/plans/{plan_id}")
            draft_final = client.get(f"/imports/{imported.id}?stage=final")
            repository.approve_lidarr_plan(plan_id)
            repository.record_lidarr_execution(plan_id, [])
            completed_page = client.get(f"/plans/{plan_id}")

        self.assertIn("Open Lidarr plan", match_page.text)
        self.assertNotIn("Build Lidarr plan", match_page.text)
        self.assertIn("No Lidarr plan exists yet", empty_plan.text)
        self.assertIn("Create Lidarr plan", empty_plan.text)
        self.assertEqual(blocked_final.headers["location"], f"/imports/{imported.id}?stage=lidarr")
        self.assertIn("Apply to Lidarr", draft_page.text)
        self.assertIn("Rebuild Lidarr plan", draft_page.text)
        self.assertIn(f'href="/imports/{imported.id}?stage=final"', draft_page.text)
        self.assertIn("There are unapplied Lidarr changes", draft_final.text)
        self.assertIn(f'href="/plans/{plan_id}"', draft_final.text)
        self.assertIn(f'href="/imports/{imported.id}?stage=final"', completed_page.text)

    def test_lidarr_execution_refreshes_persisted_library_status(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(imported.id)[0]
            result = MusicBrainzResult(
                resolved_via="manual_mbid",
                recording_ids=("recording",),
                release_group_ids=("group",),
                primary_artist_id="artist",
            )
            repository.save_manual_resolution(
                entry.id, result, method="manual_mbid", validation_status="valid"
            )
            action = LidarrPlanAction("queue_search", "artist", "Artist", "group", "Album")
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan((action,)))
            app = create_app(config(directory), repository)
            client = TestClient(app)
            lidarr = Mock()
            lidarr.execute_plan.return_value = [LidarrExecutionResult(action, "queued")]

            with (
                patch(
                    "music_importer.web.routes.lidarr_execution.LidarrClient",
                    return_value=lidarr,
                ),
                patch(
                    "music_importer.web.routes.lidarr_execution.LibraryStatusService"
                ) as status_service,
            ):
                status_service.return_value.refresh.return_value = [
                    LibraryTrackStatus(0, "release_monitored_missing")
                ]
                response = client.post(f"/plans/{plan_id}/execute", follow_redirects=False)
                app.state.context.tasks.executor.shutdown(wait=True)

            stored_status = repository.library_status(imported.id)

        self.assertEqual(response.status_code, 303)
        self.assertEqual(stored_status, {0: ("release_monitored_missing", None)})
        status_service.return_value.refresh.assert_called_once_with([result], ANY)

    def test_plan_page_shows_impact_summary_and_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan(
                    (
                        LidarrPlanAction("create_artist", "artist", "Artist"),
                        LidarrPlanAction("monitor_release", "artist", "Artist", "group", "Album"),
                        LidarrPlanAction("queue_search", "artist", "Artist", "group", "Album"),
                    )
                ),
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/plans/{plan_id}")

        self.assertEqual(response.status_code, 200)
        self.assertIn("1 new", response.text)
        self.assertIn("Searches queued", response.text)
        self.assertIn("monitor release", response.text)
        self.assertIn('aria-current="step">2 Lidarr', normalized_html(response.text))

    def test_plan_page_links_source_song_to_selected_lidarr_release(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack(
                        "spotify", "track", "The Theme", ("Noisecontrollers",), "Source Compilation"
                    )
                ],
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_title="The Theme",
                    recording_ids=("recording-id",),
                    artist_names=("Noisecontrollers",),
                    release_group_ids=("requested-group",),
                    primary_artist_id="artist-id",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan(
                    (
                        LidarrPlanAction(
                            "create_artist",
                            "artist-id",
                            "Noisecontrollers",
                            reason="artist_missing",
                        ),
                        LidarrPlanAction(
                            "reuse_downloaded_release",
                            "artist-id",
                            "Noisecontrollers",
                            "lidarr-group",
                            "Canonical Album",
                            "downloaded_recording_match",
                            {
                                "mapped_release_group_ids": ["requested-group"],
                                "requested_recording_ids": ["recording-id"],
                                "lidarr_album_id": 20,
                                "matched_track": {
                                    "id": 44,
                                    "title": "The Theme (Radio Edit)",
                                    "track_number": "3-12",
                                    "foreign_recording_id": "recording-id",
                                    "track_file_id": 91,
                                    "has_file": True,
                                    "match_method": "recording_id",
                                },
                            },
                        ),
                        LidarrPlanAction(
                            "unchanged",
                            "artist-id",
                            "Noisecontrollers",
                            "lidarr-group",
                            "Canonical Album",
                            "already_monitored",
                        ),
                        LidarrPlanAction(
                            "unchanged",
                            "artist-id",
                            "Noisecontrollers",
                            reason="already_reconciled",
                        ),
                    )
                ),
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/plans/{plan_id}")
            review_stage = client.get(f"/imports/{imported.id}?stage=review")

        html = normalized_html(response.text)
        self.assertIn("Songs and Lidarr releases", html)
        self.assertIn("Source Compilation", html)
        self.assertIn("Canonical Album", html)
        self.assertNotIn("Lidarr artist", html)
        self.assertIn("Noisecontrollers ·", html)
        self.assertIn("Rebound because this Lidarr release contains the selected track", html)
        self.assertIn("The Theme (Radio Edit)", html)
        self.assertIn("Track 3-12", html)
        self.assertIn("Lidarr file 91", html)
        self.assertNotIn("https://musicbrainz.org/recording/recording-id", html)
        self.assertIn("reuse downloaded release", html)
        self.assertIn("The release is already monitored", html)
        self.assertIn("No Lidarr changes are needed for this artist", html)
        self.assertEqual(html.count("Artist-level action"), 2)
        self.assertIn("Change track", html)
        self.assertIn("All Lidarr mutations", html)
        self.assertIn('data-actions="create_artist reuse_downloaded_release unchanged"', html)
        self.assertIn('data-mutates="1"', response.text)
        self.assertIn("Artist-level action", response.text)
        self.assertIn("create artist", response.text)
        self.assertIn(f'href="/imports/{imported.id}?stage=match"', html)
        review_html = normalized_html(review_stage.text)
        self.assertIn('aria-current="step">1 Music match', review_html)
        self.assertNotIn('aria-current="step">2 Lidarr', review_html)
        self.assertIn(f'href="/plans/{plan_id}"', review_stage.text)

    def test_plan_page_does_not_rebind_other_tracks_from_shared_compilation(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack(
                        "spotify", "reused", "Children of Drums", ("Wildstylez",), "Defqon.1 2018"
                    ),
                    SourceTrack(
                        "spotify", "skipped", "Guide You", ("Sound Rush",), "Defqon.1 2018"
                    ),
                ],
            )
            reused, skipped = repository.entries(imported.id)
            repository.save_manual_resolution(
                reused.id,
                MusicBrainzResult(
                    resolved_via="isrc",
                    recording_title="Children of Drums",
                    recording_ids=("reused-recording",),
                    artist_names=("Wildstylez",),
                    release_group_ids=("compilation-group",),
                    primary_artist_id="wildstylez",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            repository.save_manual_resolution(
                skipped.id,
                MusicBrainzResult(
                    resolved_via="isrc",
                    recording_title="Guide You",
                    recording_ids=("skipped-recording",),
                    artist_names=("Sound Rush",),
                    release_group_ids=("compilation-group",),
                    primary_artist_id="sound-rush",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan(
                    (
                        LidarrPlanAction(
                            "reuse_downloaded_release",
                            "wildstylez",
                            "Wildstylez",
                            "children-ep",
                            "Children of Drums EP",
                            "downloaded_recording_match",
                            {
                                "mapped_release_group_ids": ["compilation-group"],
                                "requested_recording_ids": ["reused-recording"],
                            },
                        ),
                        LidarrPlanAction(
                            "skip",
                            "sound-rush",
                            "Sound Rush",
                            "compilation-group",
                            "Defqon.1 2018",
                            "various_artists_album",
                            {"requested_recording_ids": ["skipped-recording"]},
                        ),
                    )
                ),
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/plans/{plan_id}")

        reused_row = response.text[response.text.index("Children of Drums") :]
        reused_row = reused_row[: reused_row.index("</tr>")]
        skipped_row = response.text[response.text.index("Guide You") :]
        skipped_row = skipped_row[: skipped_row.index("</tr>")]
        self.assertIn("Children of Drums EP", reused_row)
        self.assertIn("reuse_downloaded_release", reused_row)
        self.assertNotIn("Children of Drums EP", skipped_row)
        self.assertIn("compilation-group", skipped_row)
        self.assertIn("various artists", skipped_row.lower())
        self.assertIn("skip", skipped_row)

    def test_binding_change_supersedes_old_plan_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry = repository.entries(imported.id)[0]
            original = MusicBrainzResult(
                resolved_via="manual_mbid",
                recording_ids=("recording",),
                release_group_ids=("one", "two"),
                primary_artist_id="artist",
            )
            repository.save_manual_resolution(
                entry.id, original, method="manual_mbid", validation_status="valid"
            )
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan(()))
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    release_group_ids=("two",),
                    primary_artist_id="artist",
                ),
                method="manual_mbid",
                validation_status="valid",
                selected_release_group_id="two",
            )
            client = TestClient(create_app(config(directory), repository))

            stale_execution = client.post(f"/plans/{plan_id}/execute", follow_redirects=False)
            _, status, _ = repository.get_lidarr_plan(plan_id)

        self.assertEqual(status, "superseded")
        self.assertEqual(stale_execution.status_code, 409)

    def test_plan_binding_changes_queue_until_explicit_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack("spotify", "one", "One", ("Artist",), "Compilation"),
                    SourceTrack("spotify", "two", "Two", ("Artist",), "Compilation"),
                ],
            )
            first, second = repository.entries(imported.id)
            for entry, recording in ((first, "recording-one"), (second, "recording-two")):
                repository.save_manual_resolution(
                    entry.id,
                    MusicBrainzResult(
                        resolved_via="manual_mbid",
                        recording_ids=(recording,),
                        release_group_ids=("compilation", "single"),
                        primary_artist_id="artist",
                    ),
                    method="manual_mbid",
                    validation_status="valid",
                )
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan(()))
            client = TestClient(create_app(config(directory), repository))

            first_change = client.post(
                f"/plans/{plan_id}/entries/{first.id}/release",
                data={"release_group_id": "single"},
                follow_redirects=False,
            )
            second_change = client.post(
                f"/plans/{plan_id}/entries/{second.id}/release",
                data={"release_group_id": "single"},
                follow_redirects=False,
            )
            stale_page = client.get(f"/plans/{plan_id}")
            _, status, _ = repository.get_lidarr_plan(plan_id)
            first_selected = repository.entry(first.id).selected_release_group_id
            second_selected = repository.entry(second.id).selected_release_group_id
            jobs = repository.list_jobs()

        self.assertEqual(first_change.headers["location"], f"/plans/{plan_id}")
        self.assertEqual(second_change.headers["location"], f"/plans/{plan_id}")
        self.assertEqual(status, "superseded")
        self.assertEqual(first_selected, "single")
        self.assertEqual(second_selected, "single")
        self.assertEqual(jobs, [])
        self.assertIn("Binding changes are queued", stale_page.text)
        self.assertIn("Rebuild Lidarr plan", stale_page.text)
        self.assertIn(f"/entries/{first.id}/review?plan_id={plan_id}", stale_page.text)

    def test_various_artists_skip_offers_retry_and_durable_override(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Compilation")]
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    release_group_ids=("compilation",),
                    primary_artist_id="artist",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan(
                    (
                        LidarrPlanAction(
                            "skip",
                            "artist",
                            "Artist",
                            "compilation",
                            "Compilation",
                            "various_artists_album",
                        ),
                    )
                ),
            )
            client = TestClient(create_app(config(directory), repository))

            page = client.get(f"/plans/{plan_id}")
            changed = client.post(
                f"/plans/{plan_id}/entries/{entry.id}/allow-va", follow_redirects=False
            )
            saved = repository.entry(entry.id)
            _, status, _ = repository.get_lidarr_plan(plan_id)

        self.assertIn("Retry automatic search", page.text)
        self.assertIn("Allow this VA release", page.text)
        self.assertEqual(changed.headers["location"], f"/plans/{plan_id}")
        self.assertTrue(saved.evidence["allow_various_artists_release"])
        self.assertEqual(status, "superseded")

    def test_completed_various_artists_skip_can_queue_override_for_next_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Compilation")]
            )
            entry = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                entry.id,
                MusicBrainzResult(
                    resolved_via="manual_mbid",
                    recording_ids=("recording",),
                    release_group_ids=("compilation",),
                    primary_artist_id="artist",
                ),
                method="manual_mbid",
                validation_status="valid",
            )
            action = LidarrPlanAction(
                "skip",
                "artist",
                "Artist",
                "compilation",
                "Compilation",
                "various_artists_album",
            )
            plan_id = repository.save_lidarr_plan(imported.id, LidarrPlan((action,)))
            repository.approve_lidarr_plan(plan_id)
            repository.record_lidarr_execution(
                plan_id, [LidarrExecutionResult(action, "skipped", "various_artists_album")]
            )
            client = TestClient(create_app(config(directory), repository))

            page = client.get(f"/plans/{plan_id}")
            changed = client.post(
                f"/plans/{plan_id}/entries/{entry.id}/allow-va", follow_redirects=False
            )
            saved = repository.entry(entry.id)
            _, status, _ = repository.get_lidarr_plan(plan_id)

        self.assertIn("Allow this VA release", page.text)
        self.assertEqual(changed.headers["location"], f"/imports/{imported.id}")
        self.assertTrue(saved.evidence["allow_various_artists_release"])
        self.assertEqual(status, "completed")

    def test_unresolved_plan_row_can_be_resolved_from_final_review(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id,
                [SourceTrack("spotify", "track", "Together", ("Crystal Lake",), "Together")],
            )
            entry = repository.entries(imported.id)[0]
            repository.mark_skipped(entry.id)
            plan_id = repository.save_lidarr_plan(
                imported.id,
                LidarrPlan((LidarrPlanAction("skip", reason="musicbrainz_unresolved"),)),
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/plans/{plan_id}")

        self.assertIn(
            f'href="/entries/{entry.id}/review?plan_id={plan_id}">Resolve track</a>',
            normalized_html(response.text),
        )

    def test_dashboard_and_jobs_page_link_back_to_active_job(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = ImportRepository(Path(directory) / "state.db")
            job = repository.create_job("playlist_analysis", total=20)
            repository.update_job(job.id, status="running", current=4, current_item="Artist — Song")
            client = TestClient(create_app(config(directory), repository))

            dashboard = client.get("/")
            jobs = client.get("/jobs")

        self.assertIn(f"/jobs/{job.id}", dashboard.text)
        self.assertIn("Artist — Song", dashboard.text)
        self.assertIn(f"/jobs/{job.id}", jobs.text)
        self.assertIn("Background Jobs", jobs.text)


if __name__ == "__main__":
    unittest.main()
