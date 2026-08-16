import unittest

from music_importer.domain.models import AcquiredTrack, SourceTrack
from music_importer.domain.playlist_updates import playlist_snapshot_token


class PlaylistSnapshotTokenTests(unittest.TestCase):
    def test_is_stable_for_the_same_snapshot_and_changes_with_source_data(self):
        track = SourceTrack("spotify", "track-1", "Title", ("Artist",), "Album")
        entries = [AcquiredTrack(0, track)]

        self.assertEqual(playlist_snapshot_token(entries), playlist_snapshot_token(entries))
        self.assertNotEqual(
            playlist_snapshot_token(entries),
            playlist_snapshot_token([AcquiredTrack(1, track)]),
        )


if __name__ == "__main__":
    unittest.main()
