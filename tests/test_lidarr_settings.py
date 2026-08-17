import unittest
from unittest.mock import Mock, call

from music_importer.integrations.lidarr import LidarrClient


class LidarrSettingsTests(unittest.TestCase):
    def setUp(self):
        self.client = object.__new__(LidarrClient)
        self.client._request = Mock()

    def test_root_folders_are_returned_as_sorted_choices(self):
        self.client._request.return_value = [
            {"id": 2, "path": "/Music"},
            {"id": 1, "path": "/archive"},
            {"id": 3},
        ]

        choices = self.client.root_folders()

        self.assertEqual(choices, [("/archive", "/archive"), ("/Music", "/Music")])
        self.client._request.assert_called_once_with("GET", "rootfolder")

    def test_profiles_are_returned_as_named_sorted_choices(self):
        self.client._request.side_effect = [
            [{"id": 2, "name": "Standard"}, {"id": 1, "name": "Lossless"}],
            [{"id": 3, "name": "Extended"}, {"id": 1, "name": "Standard"}],
        ]

        quality = self.client.quality_profiles()
        metadata = self.client.metadata_profiles()

        self.assertEqual(quality, [(1, "Lossless"), (2, "Standard")])
        self.assertEqual(metadata, [(3, "Extended"), (1, "Standard")])
        self.assertEqual(
            self.client._request.call_args_list,
            [call("GET", "qualityprofile"), call("GET", "metadataprofile")],
        )


if __name__ == "__main__":
    unittest.main()
