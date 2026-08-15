import csv
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from music_importer.csv_compat import import_mapping_csv
from music_importer.models import (
    AcquiredTrack,
    MusicBrainzResult,
    PlaylistInfo,
    SourceTrack,
)
from music_importer.persistence import ImportRepository
from music_importer.reports import FIELDS


class ImportRepositoryTests(unittest.TestCase):
    def repository(self, directory: str) -> ImportRepository:
        return ImportRepository(Path(directory) / "imports.db")

    def test_migrates_version_five_jobs_to_persist_results(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "imports.db"
            with sqlite3.connect(path) as db:
                db.executescript("""
                    CREATE TABLE jobs (
                        id TEXT PRIMARY KEY,
                        import_id TEXT,
                        kind TEXT NOT NULL,
                        status TEXT NOT NULL,
                        current INTEGER NOT NULL DEFAULT 0,
                        total INTEGER NOT NULL DEFAULT 0,
                        current_item TEXT,
                        cancel_requested INTEGER NOT NULL DEFAULT 0,
                        error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    PRAGMA user_version = 5;
                """)
                db.execute(
                    """INSERT INTO jobs
                    (id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)""",
                    ("job", "playlist_catalogue", "completed", "now", "now"),
                )

            repository = ImportRepository(path)
            repository.save_job_result("job", {"source": "spotify"})
            with sqlite3.connect(path) as db:
                version = db.execute("PRAGMA user_version").fetchone()[0]
                result_json = db.execute(
                    "SELECT result_json FROM jobs WHERE id = 'job'"
                ).fetchone()[0]

        self.assertEqual(version, 6)
        self.assertEqual(json.loads(result_json), {"source": "spotify"})

    def test_import_survives_restart_and_preserves_order_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = self.repository(directory)
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            tracks = [
                SourceTrack("spotify", "same", "Song", ("Artist",), "Album"),
                SourceTrack("spotify", "same", "Song", ("Artist",), "Album"),
            ]
            repository.replace_tracks(imported.id, tracks)

            restarted = self.repository(directory)
            entries = restarted.entries(imported.id)
            workflow_state = restarted.get_import(imported.id).workflow_state

        self.assertEqual([entry.position for entry in entries], [0, 1])
        self.assertEqual([entry.track.source_track_id for entry in entries], ["same", "same"])
        self.assertEqual(workflow_state, "ready_to_resolve")

    def test_manual_override_is_persisted_and_not_overwritten_by_automation(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = self.repository(directory)
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("spotify", "track", "Song", ("Artist",), "Album")]
            )
            entry_id = repository.entries(imported.id)[0].id
            manual = MusicBrainzResult(
                resolved_via="manual_mbid",
                recording_title="Song",
                recording_ids=("manual",),
                release_group_ids=("group",),
                primary_artist_id="artist",
            )
            repository.save_manual_resolution(
                entry_id,
                manual,
                method="manual_mbid",
                validation_status="warning",
                evidence={"artist_match": "warning"},
            )

            saved = repository.save_automatic_resolution(
                entry_id, MusicBrainzResult(resolved_via="isrc", recording_ids=("auto",))
            )
            entry = self.repository(directory).entries(imported.id)[0]

        self.assertFalse(saved)
        self.assertTrue(entry.is_manual)
        self.assertEqual(entry.result.recording_ids, ("manual",))
        self.assertEqual(entry.validation_status, "warning")

    def test_manual_override_can_be_cleared_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = self.repository(directory)
            imported = repository.create_import(PlaylistInfo("tidal", "playlist", "Mix"))
            repository.replace_tracks(
                imported.id, [SourceTrack("tidal", "track", "Song", ("Artist",), "Album")]
            )
            entry_id = repository.entries(imported.id)[0].id
            repository.save_manual_resolution(
                entry_id,
                MusicBrainzResult(resolved_via="manual_search"),
                method="manual_search",
                validation_status="valid",
            )

            repository.clear_manual_resolution(entry_id)
            entry = repository.entries(imported.id)[0]

        self.assertEqual(entry.resolution_state, "pending")
        self.assertFalse(entry.is_manual)

    def test_manual_match_suggestions_require_stable_track_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = self.repository(directory)
            source_import = repository.create_import(
                PlaylistInfo("spotify", "source-list", "Partee")
            )
            target_import = repository.create_import(
                PlaylistInfo("tidal", "target-list", "Harde Stijl")
            )
            unrelated_import = repository.create_import(
                PlaylistInfo("tidal", "other-list", "Trance")
            )
            repository.replace_tracks(
                source_import.id,
                [SourceTrack("spotify", "spotify-id", "Song", ("Artist",), "Album", isrc="MATCH")],
            )
            repository.replace_tracks(
                target_import.id,
                [SourceTrack("tidal", "tidal-id", "Song", ("Artist",), "Album", isrc="MATCH")],
            )
            repository.replace_tracks(
                unrelated_import.id,
                [SourceTrack("tidal", "other-id", "Song", ("Artist",), "Album")],
            )
            source_entry = repository.entries(source_import.id)[0]
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

            suggestions = repository.manual_match_suggestions(
                repository.entries(target_import.id)[0].id
            )
            unsafe_suggestions = repository.manual_match_suggestions(
                repository.entries(unrelated_import.id)[0].id
            )

        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0].playlist_name, "Partee")
        self.assertEqual(unsafe_suggestions, [])

    def test_playlist_update_preserves_matches_and_audits_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = self.repository(directory)
            imported = repository.create_import(PlaylistInfo("spotify", "playlist", "Old Mix"))
            repository.replace_tracks(
                imported.id,
                [
                    SourceTrack("spotify", "keep", "Keep", ("Artist",), "Album", isrc="KEEP"),
                    SourceTrack("spotify", "remove", "Remove", ("Artist",), "Album"),
                ],
            )
            kept = repository.entries(imported.id)[0]
            repository.save_manual_resolution(
                kept.id,
                MusicBrainzResult(resolved_via="manual_mbid", recording_ids=("mbid",)),
                method="manual_mbid",
                validation_status="valid",
            )
            current = [
                AcquiredTrack(0, SourceTrack("spotify", "new", "New", ("Artist",), "Album")),
                AcquiredTrack(
                    1, SourceTrack("spotify", "keep", "Keep", ("Artist",), "Album", isrc="KEEP")
                ),
            ]

            preview = repository.preview_playlist_update(imported.id, current)
            applied = repository.apply_playlist_update(
                imported.id, PlaylistInfo("spotify", "playlist", "New Mix"), current
            )
            entries = repository.entries(imported.id)
            revisions = repository.playlist_revisions(imported.id)
            updated_name = repository.get_import(imported.id).playlist_name

        self.assertEqual((preview.added, preview.removed, preview.moved), (1, 1, 1))
        self.assertEqual(applied, preview)
        self.assertEqual([entry.track.source_track_id for entry in entries], ["new", "keep"])
        self.assertEqual(entries[1].id, kept.id)
        self.assertTrue(entries[1].is_manual)
        self.assertEqual(entries[1].result.recording_ids, ("mbid",))
        self.assertEqual(updated_name, "New Mix")
        self.assertEqual(len(revisions), 1)
        self.assertEqual((revisions[0].added, revisions[0].removed), (1, 1))

    def test_settings_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            self.repository(directory).set_setting("path_mappings", [["/music", "/media"]])
            value = self.repository(directory).get_setting("path_mappings")

        self.assertEqual(value, [["/music", "/media"]])

    def test_existing_mapping_csv_can_be_imported_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spotify_Mix_playlist_musicbrainz.csv"
            rows = []
            for source_id, via in (("one", "isrc"), ("one", "none")):
                row = {field: "" for field in FIELDS}
                row.update(
                    {
                        "source": "spotify",
                        "source_playlist_id": "playlist",
                        "source_track_id": source_id,
                        "track_title": "Song",
                        "artists": "Artist",
                        "resolved_via": via,
                        "mb_recording_ids": "recording" if via != "none" else "",
                        "mb_release_group_ids": "group" if via != "none" else "",
                        "mb_primary_artist_id": "artist" if via != "none" else "",
                    }
                )
                rows.append(row)
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)
            repository = self.repository(directory)

            imported = import_mapping_csv(path, repository, "Mix")
            entries = repository.entries(imported.id)

        self.assertEqual(imported.workflow_state, "review_required")
        self.assertEqual([entry.track.source_track_id for entry in entries], ["one", "one"])
        self.assertEqual(
            [entry.resolution_method for entry in entries],
            ["imported_from_csv", "imported_from_csv"],
        )


if __name__ == "__main__":
    unittest.main()
