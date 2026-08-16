import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from music_importer.domain.models import PlaylistInfo
from music_importer.integrations.sources.spotify import SpotifySource
from music_importer.integrations.sources.spotify_auth import SpotifyAuthenticationRequired


class SpotifySourceTests(unittest.TestCase):
    @patch("music_importer.integrations.sources.spotify_auth.SpotifyPKCE")
    def test_background_login_requires_cached_authentication(self, auth_type):
        auth = auth_type.return_value
        auth.cache_handler.get_cached_token.return_value = None
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))

        with self.assertRaisesRegex(SpotifyAuthenticationRequired, "Settings"):
            source.login()

        auth_type.assert_called_once_with(
            client_id="client-id",
            redirect_uri="http://localhost/callback",
            state=None,
            scope="playlist-read-private playlist-read-collaborative",
            cache_handler=auth_type.call_args.kwargs["cache_handler"],
            open_browser=False,
            requests_timeout=30,
        )
        auth.get_access_token.assert_not_called()

    @patch("music_importer.integrations.sources.spotify_auth.spotipy.Spotify")
    @patch("music_importer.integrations.sources.spotify_auth.SpotifyPKCE")
    def test_web_authorization_completes_with_matching_state(self, auth_type, client_type):
        auth = auth_type.return_value
        auth.get_authorize_url.return_value = "https://accounts.spotify.test/authorize"
        auth.cache_handler.get_cached_token.return_value = {"access_token": "token"}
        auth.get_access_token.side_effect = ["token", "token"]
        client_type.return_value.current_user.return_value = {"id": "me"}
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))

        authorization_url = source.authorization_url()
        state = auth_type.call_args.kwargs["state"]
        source.complete_authorization("code", state)

        self.assertEqual(authorization_url, "https://accounts.spotify.test/authorize")
        auth.get_access_token.assert_any_call(code="code", check_cache=False)
        client_type.assert_called_once_with(auth="token", requests_timeout=30)
        self.assertEqual(source.user_id, "me")

    @patch("music_importer.integrations.sources.spotify_auth.SpotifyPKCE")
    def test_web_authorization_rejects_a_different_state(self, auth_type):
        source = SpotifySource("client-id", "http://localhost/callback", Path("token"))
        source.authorization_url()

        with self.assertRaisesRegex(ValueError, "state"):
            source.complete_authorization("code", "different")

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
