import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from music_importer.models import MusicBrainzResult, PlaylistInfo, SourceTrack
from music_importer.workflow import overview


class OverviewTests(unittest.TestCase):
    @patch("music_importer.workflow.LidarrClient")
    @patch("music_importer.workflow.MusicBrainzClient")
    def test_scans_every_playlist_and_writes_artist_counts(self, mb_class, lidarr_class):
        source = Mock(name="source")
        source.name = "spotify"
        source.list_playlists.return_value = [
            PlaylistInfo("spotify", "one", "First"),
            PlaylistInfo("spotify", "two", "Second", path="Folder"),
            PlaylistInfo("spotify", "three", "Followed", track_count=20, is_followed=True),
        ]
        source.get_tracks.side_effect = [
            [SourceTrack("spotify", "t1", "Song", ("New",), "Album")],
            [SourceTrack("spotify", "t1", "Song", ("New",), "Album")],
        ]
        mb_class.return_value.resolve.return_value = MusicBrainzResult(
            resolved_via="isrc",
            artist_names=("New",),
            primary_artist_id="new-id",
            release_group_ids=("release",),
        )
        lidarr_class.return_value.compare.side_effect = [
            ({0: "artist_missing"}, {}),
            ({0: "artist_missing"}, {}),
        ]

        with tempfile.TemporaryDirectory() as directory:
            config = Mock(lidarr_enabled=True, output_dir=Path(directory))
            path = overview(source, config)
            with path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

        self.assertEqual([row["playlist"] for row in rows], ["First", "Second", "Followed"])
        self.assertEqual(rows[0]["artists_to_add"], "1")
        self.assertEqual(rows[0]["artist_names"], "New")
        self.assertEqual(rows[1]["artists_to_add"], "1")
        self.assertEqual(rows[2]["status"], "skipped_followed")
        self.assertEqual(source.get_tracks.call_count, 2)
        mb_class.return_value.resolve.assert_called_once()
        source.login.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
