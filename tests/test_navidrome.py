import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from music_importer.navidrome import NavidromeClient


class NavidromeTests(unittest.TestCase):
    def client(self):
        return NavidromeClient(
            SimpleNamespace(
                navidrome_url="http://navidrome",
                navidrome_username="user",
                navidrome_password="pass",
                navidrome_root_folder="/music",
            )
        )

    def test_matches_normalized_exact_title_and_participating_artist(self):
        client = self.client()
        client._request = Mock(
            return_value={
                "searchResult3": {
                    "song": [
                        {
                            "title": "Tri-State (Robert Nickson mix)",
                            "artist": "Above & Beyond • Robert Nickson",
                            "album": "Stealing Time / Tri-State",
                            "path": "Above & Beyond/Tri-State.flac",
                        }
                    ]
                }
            }
        )

        self.assertEqual(
            client.find_song("Above & Beyond", "Tri State (Robert Nickson Mix)"),
            ("/music/Above & Beyond/Tri-State.flac", "navidrome_exact_match"),
        )
        self.assertEqual(
            client._request.call_args.kwargs["query"],
            "Above & Beyond - Tri State (Robert Nickson Mix)",
        )

    def test_rejects_ambiguous_exact_matches(self):
        client = self.client()
        client._request = Mock(
            return_value={
                "searchResult3": {
                    "song": [
                        {"title": "Song", "artist": "Artist", "path": "one.flac"},
                        {"title": "Song", "artist": "Artist", "path": "two.flac"},
                    ]
                }
            }
        )

        self.assertEqual(client.find_song("Artist", "Song"), (None, "navidrome_ambiguous"))


if __name__ == "__main__":
    unittest.main()
