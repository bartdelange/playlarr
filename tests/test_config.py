import os
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from music_importer.config import (
    apply_stored_config,
    load_config,
    serializable_config,
    service_config_values,
)


class StoredConfigTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, {"MUSICBRAINZ_USER_AGENT": "test@example.com"}, clear=True):
            self.config = load_config()

    def test_applies_known_values_but_ignores_saved_output_path(self):
        updated = apply_stored_config(
            self.config,
            {
                "output_dir": "/saved/output",
                "lidarr_url": "http://lidarr",
                "unknown_future_setting": True,
            },
        )

        self.assertEqual(updated.output_dir, self.config.output_dir)
        self.assertEqual(updated.lidarr_url, "http://lidarr")

    def test_environment_storage_paths_take_precedence(self):
        configured = replace(self.config, data_dir=Path("/environment/data"))
        with patch.dict(os.environ, {"DATA_DIR": "/environment/data"}):
            updated = apply_stored_config(configured, {"data_dir": "/saved/data"})

        self.assertEqual(updated.data_dir, Path("/environment/data"))

    def test_non_mapping_stored_value_is_ignored(self):
        self.assertEqual(apply_stored_config(self.config, "invalid"), self.config)

    def test_form_values_preserve_omitted_secrets_and_normalize_urls(self):
        values = service_config_values(
            self.config,
            {"lidarr_api_key": "saved-key"},
            mb_user_agent=" agent ",
            spotify_client_id="",
            spotify_redirect_uri="",
            lidarr_url=" http://lidarr/ ",
            lidarr_api_key="",
            lidarr_root_folder="",
            lidarr_quality_profile_id=2,
            lidarr_metadata_profile_id=3,
            navidrome_url=" http://navidrome/ ",
            navidrome_username=" user ",
            navidrome_password=" password ",
        )

        self.assertEqual(values["lidarr_url"], "http://lidarr")
        self.assertEqual(values["lidarr_api_key"], "saved-key")
        self.assertEqual(values["navidrome_url"], "http://navidrome")
        self.assertNotIn("output_dir", serializable_config(values))


if __name__ == "__main__":
    unittest.main()
