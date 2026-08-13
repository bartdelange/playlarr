import csv
import tempfile
import unittest
from pathlib import Path

from music_importer.models import MusicBrainzResult
from music_importer.reports import artist_additions, write_artist_impact_report


class ArtistImpactTests(unittest.TestCase):
    def test_groups_missing_tracks_by_unique_artist(self):
        results = [
            MusicBrainzResult(artist_names=("New Artist",), primary_artist_id="new-id"),
            MusicBrainzResult(artist_names=("New Artist",), primary_artist_id="new-id"),
            MusicBrainzResult(artist_names=("Existing Artist",), primary_artist_id="existing-id"),
            MusicBrainzResult(),
        ]

        additions = artist_additions(
            results,
            {
                0: "artist_missing",
                1: "artist_missing",
                2: "release_missing",
                3: "musicbrainz_unresolved",
            },
        )

        self.assertEqual(
            additions,
            [
                {
                    "artist_name": "New Artist",
                    "artist_mbid": "new-id",
                    "playlist_tracks": 2,
                }
            ],
        )

    def test_writes_header_for_playlist_with_no_new_artists(self):
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_mix_123_musicbrainz.csv"
            path = write_artist_impact_report(mapping, [])

            self.assertEqual(path.name, "spotify_mix_123_artist_impact.csv")
            with path.open(newline="", encoding="utf-8") as handle:
                self.assertEqual(list(csv.DictReader(handle)), [])


if __name__ == "__main__":
    unittest.main()
