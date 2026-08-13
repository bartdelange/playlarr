import unittest

from scripts.check_commit_msg import validate_header


class CommitMessageTests(unittest.TestCase):
    def test_accepts_emoji_scoped_conventional_commits(self):
        self.assertIsNone(validate_header("🐛 fix(lidarr): preserve downloaded release selection"))
        self.assertIsNone(validate_header("📝 docs(repo): explain local configuration"))

    def test_rejects_unknown_types_and_scopes(self):
        self.assertIn("Invalid commit type", validate_header("🔧 change(repo): update behavior"))
        self.assertIn("Invalid commit scope", validate_header("🐛 fix(api): update behavior"))

    def test_rejects_nonconforming_subject_style(self):
        self.assertIn("lowercase", validate_header("🐛 fix(web): Handle missing import"))
        self.assertIn("period", validate_header("🐛 fix(web): handle missing import."))

    def test_rejects_missing_emoji_or_scope(self):
        self.assertIn("Invalid commit message", validate_header("fix(web): handle missing import"))
        self.assertIn("Invalid commit message", validate_header("🐛 fix: handle missing import"))
        self.assertIn("emoji", validate_header("x fix(web): handle missing import"))


if __name__ == "__main__":
    unittest.main()
