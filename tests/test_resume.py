import csv
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from music_importer.exports.lidarr_reports import (
    write_lidarr_action_report,
    write_resumed_matched_report,
    write_resumed_missing_report,
)
from music_importer.exports.mapping_report import FIELDS, load_mapping_report
from music_importer.workflows.resume import resume_lidarr


class ResumeTests(unittest.TestCase):
    def test_loads_lidarr_inputs_and_recreates_summary(self):
        rows = [
            {
                "resolved_via": "isrc",
                "mb_primary_artist_id": "artist-1",
                "mb_recording_title": "Song (edit)",
                "mb_recording_ids": "recording-1",
                "mb_release_group_ids": "group-1;group-2",
            },
            {
                "resolved_via": "search",
                "mb_primary_artist_id": "artist-2",
                "mb_release_group_ids": "group-3",
            },
            {"resolved_via": "none", "mb_primary_artist_id": "", "mb_release_group_ids": ""},
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mapping.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)

            results, loaded_rows, summary = load_mapping_report(path)

        self.assertEqual(results[0].primary_artist_id, "artist-1")
        self.assertEqual(results[0].recording_title, "Song (edit)")
        self.assertEqual(results[0].recording_ids, ("recording-1",))
        self.assertEqual(loaded_rows[0]["mb_primary_artist_id"], "artist-1")
        self.assertEqual(results[0].release_group_ids, ("group-1", "group-2"))
        self.assertIsNone(results[2].resolved_via)
        self.assertEqual(
            (
                summary.total,
                summary.resolved_by_isrc,
                summary.resolved_by_search,
                summary.unresolved,
            ),
            (3, 1, 1, 1),
        )

    def test_rejects_non_mapping_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            path.write_text("track_title,artists\nSong,Artist\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing columns"):
                load_mapping_report(path)

    def test_writes_resumed_missing_report_beside_mapping(self):
        row = {field: "" for field in FIELDS}
        row["track_title"] = "Song"
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_Mix_123_musicbrainz.csv"
            path = write_resumed_missing_report(mapping, [row], {0: "artist_missing"})
            with path.open(newline="", encoding="utf-8") as handle:
                written = list(csv.DictReader(handle))

        self.assertEqual(path.name, "spotify_Mix_123_missing_in_lidarr.csv")
        self.assertEqual(written[0]["lidarr_missing_reason"], "artist_missing")

    def test_writes_resumed_matched_report_with_reason(self):
        row = {field: "" for field in FIELDS}
        row["track_title"] = "Song"
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_Mix_123_musicbrainz.csv"
            path = write_resumed_matched_report(mapping, [row], {0: "recording_match"})
            with path.open(newline="", encoding="utf-8") as handle:
                written = list(csv.DictReader(handle))

        self.assertEqual(path.name, "spotify_Mix_123_matched_in_lidarr.csv")
        self.assertEqual(written[0]["lidarr_match_reason"], "recording_match")

    def test_writes_lidarr_action_report_beside_mapping(self):
        actions = [
            {
                "mapped_artist_names": "Mapped Artist",
                "artist_name": "Artist",
                "artist_mbid": "artist-id",
                "artist_lidarr_url": "http://lidarr/artist/artist-id",
                "release_group_id": "group-id",
                "album_title": "Album",
                "album_lidarr_url": "http://lidarr/album/group-id",
                "action": "add_album",
                "outcome": "created",
                "details": "",
            }
        ]
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_Mix_123_musicbrainz.csv"
            path = write_lidarr_action_report(mapping, actions)
            with path.open(newline="", encoding="utf-8") as handle:
                written = list(csv.DictReader(handle))

        self.assertEqual(path.name, "spotify_Mix_123_lidarr_actions.csv")
        self.assertEqual(written, actions)

    def test_resumed_missing_mode_compares_without_syncing(self):
        row = {field: "" for field in FIELDS}
        row.update(
            {
                "resolved_via": "isrc",
                "mb_primary_artist_id": "artist-1",
                "mb_release_group_ids": "group-1",
            }
        )
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_Mix_123_musicbrainz.csv"
            with mapping.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerow(row)
            client = Mock()
            client.compare.return_value = ({0: "release_missing"}, {})
            with patch("music_importer.workflows.resume.LidarrClient", return_value=client):
                resume_lidarr(mapping, SimpleNamespace(lidarr_enabled=True), missing_in_lidarr=True)

            self.assertTrue(mapping.with_name("spotify_Mix_123_missing_in_lidarr.csv").exists())
            self.assertTrue(mapping.with_name("spotify_Mix_123_matched_in_lidarr.csv").exists())
        client.compare.assert_called_once()
        client.sync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
