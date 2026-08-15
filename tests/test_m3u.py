import csv
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock

from music_importer.lidarr import LidarrClient
from music_importer.m3u import (
    cached_mapping,
    default_output_path,
    export_m3u,
    missing_report_path,
    translate_path,
)
from music_importer.models import MusicBrainzResult
from music_importer.reports import FIELDS


class M3UTests(unittest.TestCase):
    def test_downloaded_paths_prefers_recording_id_and_falls_back_to_title(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist", "path": "/music/Artist"}],
                [
                    {
                        "title": "Exact",
                        "foreignRecordingId": "recording",
                        "hasFile": True,
                        "trackFileId": 10,
                    },
                    {
                        "title": "Alternate Title",
                        "foreignRecordingId": "other",
                        "hasFile": True,
                        "trackFileId": 11,
                    },
                    {
                        "title": "Unavailable",
                        "foreignRecordingId": "missing",
                        "hasFile": False,
                        "trackFileId": 12,
                    },
                ],
                [
                    {"id": 10, "path": "/music/Artist/Exact.flac"},
                    {"id": 11, "relativePath": "Album/Alternate.flac"},
                    {"id": 12, "path": "/music/Artist/Unavailable.flac"},
                ],
            ]
        )
        results = [
            MusicBrainzResult(
                primary_artist_id="artist",
                recording_ids=("recording",),
                recording_title="Different title",
            ),
            MusicBrainzResult(
                primary_artist_id="artist",
                recording_ids=("playlist-version",),
                recording_title="Alternate Title (edit)",
            ),
            MusicBrainzResult(
                primary_artist_id="artist",
                recording_ids=("missing",),
                recording_title="Unavailable",
            ),
        ]

        self.assertEqual(
            client.downloaded_paths(results),
            {
                0: "/music/Artist/Exact.flac",
                1: "/music/Artist/Album/Alternate.flac",
            },
        )

    def test_downloaded_paths_rejects_a_different_named_remix(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "artist", "path": "/music/Artist"}],
                [
                    {
                        "title": "Diamonds (Angemi remix)",
                        "foreignRecordingId": "angemi-recording",
                        "hasFile": True,
                        "trackFileId": 10,
                    }
                ],
                [{"id": 10, "path": "/music/Artist/Diamonds.flac"}],
            ]
        )
        result = MusicBrainzResult(
            primary_artist_id="artist",
            recording_ids=("bass-modulators-recording",),
            recording_title="Diamonds (Bass Modulators extended remix)",
        )

        self.assertEqual(client.downloaded_paths([result]), {})

    def test_exports_extended_m3u_in_mapping_order_and_preserves_duplicates(self):
        rows = []
        for source_id, title in (("one", "First"), ("two", "Missing"), ("one", "First")):
            row = {field: "" for field in FIELDS}
            row.update(
                {
                    "source": "spotify",
                    "source_playlist_id": "playlist",
                    "source_track_id": source_id,
                    "track_title": title,
                    "artists": "Artist",
                    "resolved_via": "isrc",
                    "mb_recording_ids": source_id,
                    "mb_release_group_ids": "group",
                    "mb_primary_artist_id": "artist",
                }
            )
            rows.append(row)
        client = Mock()
        client.downloaded_paths.return_value = {0: "/music/First.flac", 2: "/music/First.flac"}
        with tempfile.TemporaryDirectory() as directory:
            mapping = Path(directory) / "spotify_Mix_id_musicbrainz.csv"
            output = Path(directory) / "Mix.m3u8"
            with mapping.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS)
                writer.writeheader()
                writer.writerows(rows)

            counts = export_m3u(mapping, output, client, [("/music", "/media/music")])
            contents = output.read_text(encoding="utf-8")
            with missing_report_path(output).open(newline="", encoding="utf-8") as handle:
                missing_rows = list(csv.DictReader(handle))

        self.assertEqual(counts, (2, 1))
        self.assertEqual(contents.count("#EXTINF:-1,Artist - First"), 2)
        self.assertEqual(contents.count("/media/music/First.flac"), 2)
        self.assertNotIn("Missing", contents)
        self.assertEqual(len(missing_rows), 1)
        self.assertEqual(missing_rows[0]["missing_reason"], "not_downloaded_or_unmatched")

    def test_downloaded_paths_finds_file_on_globally_owned_album(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "track-artist", "path": "/music/Track Artist"}],
                [],
                [],
                [
                    {
                        "id": 20,
                        "artistId": 9,
                        "foreignAlbumId": "selected-group",
                        "artist": {
                            "id": 9,
                            "foreignArtistId": "album-artist",
                            "path": "/music/Album Artist",
                        },
                    }
                ],
                [
                    {
                        "albumId": 20,
                        "foreignRecordingId": "recording",
                        "title": "Song",
                        "hasFile": True,
                        "trackFileId": 91,
                    }
                ],
                [{"id": 91, "path": "/music/Album Artist/Album/Song.flac"}],
            ]
        )
        result = MusicBrainzResult(
            recording_ids=("recording",),
            recording_title="Song",
            primary_artist_id="track-artist",
            release_group_ids=("selected-group",),
        )

        self.assertEqual(
            client.downloaded_paths([result]),
            {0: "/music/Album Artist/Album/Song.flac"},
        )

    def test_downloaded_paths_finds_file_on_various_artists_album(self):
        client = object.__new__(LidarrClient)
        client._request = Mock(
            side_effect=[
                [{"id": 7, "foreignArtistId": "track-artist", "path": "/music/Track Artist"}],
                [],
                [],
                [
                    {
                        "id": 20,
                        "artistId": 9,
                        "foreignAlbumId": "compilation",
                        "artist": {
                            "id": 9,
                            "artistName": "Various Artists",
                            "foreignArtistId": "89ad4ac3-39f7-470e-963a-56509c546377",
                            "path": "/music/Various Artists",
                        },
                    }
                ],
                [
                    {
                        "albumId": 20,
                        "foreignRecordingId": "recording",
                        "title": "Song",
                        "hasFile": True,
                        "trackFileId": 91,
                    }
                ],
                [{"id": 91, "path": "/music/Various Artists/Compilation/Song.flac"}],
            ]
        )
        result = MusicBrainzResult(
            recording_ids=("recording",),
            recording_title="Song",
            primary_artist_id="track-artist",
            release_group_ids=("compilation",),
        )

        self.assertEqual(
            client.downloaded_paths([result]),
            {0: "/music/Various Artists/Compilation/Song.flac"},
        )

    def test_path_helpers(self):
        self.assertEqual(translate_path("/music/a.flac", [("/music", "/media")]), "/media/a.flac")
        self.assertEqual(
            translate_path("/musical/a.flac", [("/music", "/media")]), "/musical/a.flac"
        )
        self.assertEqual(
            default_output_path(Path("spotify_Mix_id_musicbrainz.csv")), Path("spotify_Mix_id.m3u8")
        )
        self.assertEqual(
            missing_report_path(Path("spotify_Mix_id.m3u8")), Path("spotify_Mix_id_missing.csv")
        )

    def test_cached_mapping_uses_playlist_id_and_prefers_newest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            older = output / "spotify_Old_Name_playlist_musicbrainz.csv"
            newer = output / "spotify_New_Name_playlist_musicbrainz.csv"
            older.touch()
            time.sleep(0.01)
            newer.touch()

            self.assertEqual(cached_mapping(output, "spotify", "playlist"), newer)
            self.assertIsNone(cached_mapping(output, "spotify", "different"))


if __name__ == "__main__":
    unittest.main()
