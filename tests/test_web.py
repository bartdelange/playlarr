import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from music_importer.models import (
    AcquiredTrack,
    LidarrExecutionResult,
    LidarrPlan,
    LidarrPlanAction,
    MusicBrainzResult,
    PlaylistInfo,
    SourceTrack,
)
from music_importer.persistence import ImportRepository
from music_importer.services import LibraryTrackStatus
from music_importer.web import create_app


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
        navidrome_url=None,
        navidrome_username=None,
        navidrome_password=None,
        navidrome_root_folder="/music",
        navidrome_enabled=False,
    )


class WebShellTests(unittest.TestCase):
    def test_playlist_update_preview_and_apply(self):
        class Source:
            def login(self):
                pass

            def get_playlist(self, playlist_id):
                return PlaylistInfo("spotify", playlist_id, "Updated Mix", track_count=2)

            def get_entries(self, playlist):
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

            preview = client.get(f"/imports/{imported.id}/update")
            token = re.search(r'name="update_token" value="([a-f0-9]+)"', preview.text).group(1)
            applied = client.post(
                f"/imports/{imported.id}/update",
                data={"update_token": token},
                follow_redirects=False,
            )
            detail = client.get(f"/imports/{imported.id}")
            entries = repository.entries(imported.id)

        self.assertEqual(preview.status_code, 200)
        self.assertIn("1</strong> added", preview.text)
        self.assertIn("1</strong> removed", preview.text)
        self.assertEqual(applied.status_code, 303)
        self.assertEqual([entry.track.source_track_id for entry in entries], ["added", "kept"])
        self.assertIn("Update history (1)", detail.text)

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
            repository.save_library_status(
                imported.id,
                [
                    LibraryTrackStatus(0, "represented_locally", "/music/downloaded.flac"),
                    LibraryTrackStatus(1, "release_missing"),
                ],
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/imports/{imported.id}?stage=export")

        self.assertIn(">All (2)</button>", response.text)
        self.assertIn(">Downloaded (1)</button>", response.text)
        self.assertIn(">Missing but downloadable (1)</button>", response.text)
        self.assertIn(">Not downloadable (0)</button>", response.text)
        self.assertNotIn(">Auto matched</button>", response.text)
        self.assertIn('data-availability="downloaded"', response.text)
        self.assertIn('data-availability="downloadable"', response.text)
        self.assertIn(">Missing but downloadable</span>", response.text)
        self.assertIn("/music/downloaded.flac", response.text)
        self.assertIn("Selected release is not currently present in Lidarr", response.text)

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

            response = client.get(f"/imports/{imported.id}?stage=export")

        self.assertIn("Not added: selected release is a Various Artists compilation", response.text)
        self.assertIn(">Not downloadable</span>", response.text)
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

    def test_dashboard_and_import_review_render_persisted_state_without_secrets(self):
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
            settings = client.get("/settings")
            premature_library = client.post(
                f"/imports/{imported.id}/library-status", follow_redirects=False
            )

        self.assertEqual(dashboard.status_code, 200)
        self.assertIn("My Mix", dashboard.text)
        self.assertIn("Song", detail.text)
        self.assertIn("pending", detail.text)
        self.assertIn("Resolve 1 tracks", detail.text)
        self.assertIn('class="active" href="/imports/', detail.text)
        self.assertIn('aria-current="step">3 Resolve', detail.text)
        self.assertIn('aria-current="step">2 Playlist', source_step.text)
        self.assertNotIn("Refresh downloads", detail.text)
        self.assertEqual(premature_library.status_code, 409)
        self.assertNotIn("secret", settings.text)
        self.assertIn("Configured — enter to replace", settings.text)

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

        self.assertIn('aria-current="step">4 Review', detail.text)
        self.assertNotIn('aria-current="step">5 Lidarr', detail.text)
        self.assertIn(f"/imports/{imported.id}?stage=lidarr", job_page.text)

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
        self.assertIn('aria-current="step">5 Lidarr', response.text)

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
                    )
                ),
            )
            client = TestClient(create_app(config(directory), repository))

            response = client.get(f"/plans/{plan_id}")
            review_stage = client.get(f"/imports/{imported.id}?stage=review")

        self.assertIn("Songs and Lidarr releases", response.text)
        self.assertIn("Source Compilation", response.text)
        self.assertIn("recording-id", response.text)
        self.assertIn("Canonical Album", response.text)
        self.assertNotIn("Lidarr artist", response.text)
        self.assertIn("Noisecontrollers ·", response.text)
        self.assertIn("lidarr-group", response.text)
        self.assertIn("Originally selected", response.text)
        self.assertIn("The Theme (Radio Edit)", response.text)
        self.assertIn("Track 3-12", response.text)
        self.assertIn("Exact recording ID", response.text)
        self.assertIn("Lidarr file 91", response.text)
        self.assertIn("https://musicbrainz.org/recording/recording-id", response.text)
        self.assertIn("reuse downloaded release", response.text)
        self.assertIn("Change track", response.text)
        self.assertIn("All Lidarr mutations", response.text)
        self.assertIn(
            'data-actions="create_artist reuse_downloaded_release unchanged"', response.text
        )
        self.assertIn('data-mutates="1"', response.text)
        self.assertIn("Artist-level action", response.text)
        self.assertIn("create artist", response.text)
        self.assertIn(f'href="/imports/{imported.id}?stage=review"', response.text)
        self.assertIn('aria-current="step">4 Review', review_stage.text)
        self.assertNotIn('aria-current="step">5 Lidarr', review_stage.text)
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
            f'href="/entries/{entry.id}/review?plan_id={plan_id}">Resolve track</a>', response.text
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
