import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from music_importer.integrations.navidrome import NavidromeClient


class NavidromeClientTests(unittest.TestCase):
    def config(self):
        return SimpleNamespace(
            navidrome_enabled=True,
            navidrome_url="http://navidrome",
            navidrome_username="user",
            navidrome_password="secret",
        )

    @patch("music_importer.integrations.navidrome.client.requests.get")
    def test_search_uses_token_auth_and_returns_song_paths(self, get):
        response = Mock()
        response.json.return_value = {
            "subsonic-response": {
                "status": "ok",
                "searchResult3": {
                    "song": [{"id": "1", "title": "Song", "artist": "Artist", "path": "A/S.flac"}]
                },
            }
        }
        get.return_value = response

        songs = NavidromeClient(self.config()).search_songs("song")

        self.assertEqual(songs[0].path, "A/S.flac")
        params = get.call_args.kwargs["params"]
        self.assertNotIn("p", params)
        self.assertNotIn("secret", params.values())
        self.assertIn("t", params)

    @patch("music_importer.integrations.navidrome.client.requests.get")
    def test_missing_song_is_omitted_from_export_paths(self, get):
        response = Mock()
        response.json.return_value = {
            "subsonic-response": {"status": "failed", "error": {"message": "Not found"}}
        }
        get.return_value = response

        self.assertEqual(NavidromeClient(self.config()).paths(["gone"]), {})


if __name__ == "__main__":
    unittest.main()
