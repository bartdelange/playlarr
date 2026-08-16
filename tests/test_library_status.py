import unittest
from unittest.mock import Mock

from music_importer.application.library_status import LibraryStatusService, library_availability
from music_importer.domain.models import MusicBrainzResult


class LibraryStatusServiceTests(unittest.TestCase):
    def test_groups_diagnostic_states_into_user_facing_availability(self):
        self.assertEqual(
            library_availability("represented_locally", "/music/song.flac"), "downloaded"
        )
        self.assertEqual(library_availability("release_monitored_missing"), "downloadable")
        self.assertEqual(library_availability("release_missing"), "downloadable")
        self.assertEqual(library_availability("musicbrainz_unresolved"), "not_downloadable")
        self.assertEqual(library_availability("various_artists_skipped"), "not_downloadable")

    def test_distinguishes_downloaded_pending_and_unresolved_tracks(self):
        lidarr = Mock()
        lidarr.compare.return_value = (
            {1: "release_monitored_missing", 2: "musicbrainz_unresolved"},
            {0: "recording_match"},
        )
        lidarr.downloaded_paths.return_value = {0: "/music/Song.flac"}

        statuses = LibraryStatusService(lidarr).refresh(
            [
                MusicBrainzResult(resolved_via="isrc"),
                MusicBrainzResult(resolved_via="search"),
                MusicBrainzResult(),
            ]
        )

        self.assertEqual(
            [status.classification for status in statuses],
            [
                "represented_locally",
                "release_monitored_missing",
                "musicbrainz_unresolved",
            ],
        )
        self.assertEqual(statuses[0].path, "/music/Song.flac")

    def test_reports_progress_during_lidarr_batches(self):
        lidarr = Mock()
        lidarr.compare.side_effect = lambda results, callback: (
            callback("Loaded artists"),
            callback("Compared Artist"),
            ({}, {}),
        )[2]
        lidarr.downloaded_paths.side_effect = lambda results, callback: (
            callback("Loaded files"),
            callback("Checked Artist"),
            {},
        )[2]
        updates = []

        LibraryStatusService(lidarr).refresh(
            [
                MusicBrainzResult(primary_artist_id="artist", artist_names=("Artist",)),
            ],
            lambda current, total, item: updates.append((current, total, item)),
        )

        self.assertEqual([update[0] for update in updates], [0, 1, 2, 3, 4])
        self.assertTrue(all(update[1] == 4 for update in updates))


if __name__ == "__main__":
    unittest.main()
