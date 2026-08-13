import tempfile
import unittest
from pathlib import Path

from scripts.release import ReleaseError, bumped_version, parse_args, project_version


class ReleaseScriptTests(unittest.TestCase):
    def test_bumps_each_semantic_version_part(self):
        self.assertEqual(bumped_version("1.2.3", "patch"), "1.2.4")
        self.assertEqual(bumped_version("1.2.3", "minor"), "1.3.0")
        self.assertEqual(bumped_version("1.2.3", "major"), "2.0.0")

    def test_rejects_non_release_versions(self):
        with self.assertRaisesRegex(ReleaseError, "MAJOR.MINOR.PATCH"):
            bumped_version("1.2.3rc1", "patch")

    def test_reads_project_version(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pyproject.toml"
            path.write_text('[project]\nversion = "3.4.5"\n', encoding="utf-8")

            self.assertEqual(project_version(path), "3.4.5")

    def test_parses_prepare_and_publish_commands(self):
        prepare = parse_args(["prepare", "minor"])
        publish = parse_args(["publish"])

        self.assertEqual((prepare.command, prepare.part), ("prepare", "minor"))
        self.assertEqual(publish.command, "publish")


if __name__ == "__main__":
    unittest.main()
