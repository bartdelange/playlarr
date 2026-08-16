import unittest
from pathlib import Path
from unittest.mock import Mock

from music_importer.domain.models import PlaylistInfo
from music_importer.integrations.sources.spotify import SpotifySource


class SpotifySourceTests(unittest.TestCase):
    def test_marks_other_users_non_collaborative_playlists_as_followed(self):
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))
        source.user_id = "me"
        source.client = Mock()
        source.client.current_user_playlists.return_value = {
            "items": [
                {"id": "mine", "name": "Mine", "owner": {"id": "me"}, "tracks": {"total": 1}},
                {
                    "id": "followed",
                    "name": "Followed",
                    "owner": {"id": "other"},
                    "tracks": {"total": 2},
                },
                {
                    "id": "shared",
                    "name": "Shared",
                    "owner": {"id": "other"},
                    "collaborative": True,
                    "tracks": {"total": 3},
                },
            ],
            "next": None,
        }

        playlists = source.list_playlists()

        self.assertEqual([playlist.is_followed for playlist in playlists], [False, True, False])

    def test_includes_local_tracks_with_searchable_metadata(self):
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))
        source.client = Mock()
        source.client.playlist_items.return_value = {
            "items": [
                {
                    "is_local": True,
                    "item": {
                        "id": None,
                        "uri": "spotify:local:Artist:Album:Song:180",
                        "type": "track",
                        "name": "Song",
                        "artists": [{"name": "Artist"}],
                        "album": {"name": "Album"},
                        "external_ids": {},
                    },
                }
            ],
            "next": None,
        }

        tracks = source.get_tracks(PlaylistInfo("spotify", "playlist", "Playlist"))

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0].source_track_id, "spotify:local:Artist:Album:Song:180")
        self.assertEqual(tracks[0].artists, ("Artist",))
        self.assertIsNone(tracks[0].isrc)

    def test_skips_local_tracks_without_artist_metadata(self):
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))
        source.client = Mock()
        source.client.playlist_items.return_value = {
            "items": [
                {
                    "is_local": True,
                    "item": {
                        "id": None,
                        "type": "track",
                        "name": "Song",
                        "artists": [],
                        "album": {"name": ""},
                    },
                }
            ],
            "next": None,
        }

        self.assertEqual(source.get_tracks(PlaylistInfo("spotify", "playlist", "Playlist")), [])

    def test_exposes_skipped_entries_with_original_playlist_position(self):
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))
        source.client = Mock()
        source.client.playlist_items.return_value = {
            "items": [
                None,
                {
                    "is_local": False,
                    "item": {
                        "id": "track",
                        "type": "track",
                        "name": "Song",
                        "artists": [{"name": "Artist"}],
                        "album": {"name": "Album"},
                        "external_ids": {},
                    },
                },
            ],
            "next": None,
        }

        entries = source.get_entries(PlaylistInfo("spotify", "playlist", "Playlist"))

        self.assertEqual([entry.position for entry in entries], [0, 1])
        self.assertEqual(entries[0].skip_reason, "unavailable track")
        self.assertIsNone(entries[1].skip_reason)


if __name__ == "__main__":
    unittest.main()
