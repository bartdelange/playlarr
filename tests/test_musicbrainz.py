import unittest

from music_importer.musicbrainz import MusicBrainzClient


class MusicBrainzReleaseSelectionTests(unittest.TestCase):
    def test_selects_only_release_group_matching_source_album(self):
        recording = {
            "id": "recording-id",
            "title": "Faded",
            "artist-credit": [{"artist": {"id": "artist-id", "name": "Alan Walker"}}],
            "releases": [
                {
                    "id": "compilation-release",
                    "title": "Top Hits 2016",
                    "status": "Official",
                    "release-group": {
                        "id": "compilation-group",
                        "title": "Top Hits 2016",
                        "secondary-types": ["Compilation"],
                    },
                },
                {
                    "id": "wanted-release",
                    "title": "Faded",
                    "status": "Official",
                    "release-group": {"id": "wanted-group", "title": "Faded"},
                },
                {
                    "id": "another-compilation-release",
                    "title": "Dance Anthems",
                    "release-group": {
                        "id": "another-compilation-group",
                        "title": "Dance Anthems",
                        "secondary-types": ["Compilation"],
                    },
                },
            ],
        }

        result = MusicBrainzClient._result([recording], "isrc", "Faded")

        self.assertIsNotNone(result)
        self.assertEqual(result.release_group_ids, ("wanted-group",))
        self.assertEqual(result.release_ids, ("wanted-release",))

    def test_keeps_editions_from_only_the_selected_release_group(self):
        recording = {
            "id": "recording-id",
            "title": "Song",
            "artist-credit": [{"artist": {"id": "artist-id", "name": "Artist"}}],
            "releases": [
                {
                    "id": "edition-a",
                    "title": "Source Album",
                    "release-group": {"id": "source-group", "title": "Source Album"},
                },
                {
                    "id": "edition-b",
                    "title": "Source Album",
                    "release-group": {"id": "source-group", "title": "Source Album"},
                },
                {
                    "id": "other",
                    "title": "Other Album",
                    "release-group": {"id": "other-group", "title": "Other Album"},
                },
            ],
        }

        result = MusicBrainzClient._result([recording], "search", "Source Album")

        self.assertEqual(result.release_group_ids, ("source-group",))
        self.assertEqual(result.release_ids, ("edition-a", "edition-b"))


if __name__ == "__main__":
    unittest.main()
