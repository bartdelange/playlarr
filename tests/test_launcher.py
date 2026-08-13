import unittest
from unittest.mock import patch

from music_importer.cli import main


class LauncherTests(unittest.TestCase):
    @patch("music_importer.cli.run")
    def test_no_arguments_launches_local_gui(self, launch):
        with patch("sys.argv", ["music-import"]):
            main()
        launch.assert_called_once_with(debug=False)

    @patch("music_importer.cli.run")
    def test_debug_is_the_only_initial_launcher_option(self, launch):
        with patch("sys.argv", ["music-import", "--debug"]):
            main()
        launch.assert_called_once_with(debug=True)


if __name__ == "__main__":
    unittest.main()
