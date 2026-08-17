import re
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from music_importer.config import load_config
from music_importer.persistence import ImportRepository
from music_importer.web.app import create_app


class WebSecurityTests(unittest.TestCase):
    def app(self, directory: str):
        with patch.dict("os.environ", {"MUSICBRAINZ_USER_AGENT": "test@example.com"}, clear=True):
            config = replace(load_config(), data_dir=Path(directory), web_auth_enabled=True)
        repository = ImportRepository(Path(directory) / "state.db")
        return create_app(config, repository), repository

    def test_first_run_setup_protects_routes_and_hashes_password(self):
        with tempfile.TemporaryDirectory() as directory:
            app, repository = self.app(directory)
            client = TestClient(app)

            protected = client.get("/", follow_redirects=False)
            setup = client.post(
                "/setup",
                data={"password": "long-test-password", "confirm_password": "long-test-password"},
                follow_redirects=False,
            )
            dashboard = client.get("/")
            stored = repository.get_setting("web_auth_password_hash")

        self.assertEqual(protected.headers["location"], "/setup")
        self.assertEqual(setup.status_code, 303)
        self.assertEqual(dashboard.status_code, 200)
        self.assertTrue(str(stored).startswith("$argon2"))
        self.assertNotIn("long-test-password", str(stored))

    def test_csrf_and_origin_checks_protect_state_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = self.app(directory)
            client = TestClient(app)
            client.post(
                "/setup",
                data={"password": "long-test-password", "confirm_password": "long-test-password"},
            )
            dashboard = client.get("/")
            csrf = re.search(r'input\.value="([a-f0-9]+)"', dashboard.text).group(1)

            missing = client.post("/settings/path-mappings", data={})
            cross_site = client.post(
                "/logout",
                data={"csrf_token": csrf},
                headers={"origin": "https://attacker.invalid"},
            )
            accepted = client.post("/logout", data={"csrf_token": csrf}, follow_redirects=False)
            protected = client.get("/", follow_redirects=False)

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(cross_site.status_code, 403)
        self.assertEqual(accepted.status_code, 303)
        self.assertEqual(protected.headers["location"], "/login")

    def test_login_is_throttled_after_repeated_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = self.app(directory)
            client = TestClient(app)
            client.post(
                "/setup",
                data={"password": "long-test-password", "confirm_password": "long-test-password"},
            )
            client.cookies.clear()

            for _ in range(5):
                response = client.post("/login", data={"password": "wrong-password"})
            throttled = client.post("/login", data={"password": "long-test-password"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(throttled.status_code, 429)

    def test_password_change_revokes_existing_session(self):
        with tempfile.TemporaryDirectory() as directory:
            app, _ = self.app(directory)
            client = TestClient(app)
            client.post(
                "/setup",
                data={"password": "long-test-password", "confirm_password": "long-test-password"},
            )
            dashboard = client.get("/")
            csrf = re.search(r'input\.value="([a-f0-9]+)"', dashboard.text).group(1)
            old_session = client.cookies.get("playlarr_session")

            changed = client.post(
                "/settings/password",
                data={
                    "csrf_token": csrf,
                    "current_password": "long-test-password",
                    "password": "different-test-password",
                    "confirm_password": "different-test-password",
                },
                follow_redirects=False,
            )
            client.cookies.set("playlarr_session", old_session)
            revoked = client.get("/", follow_redirects=False)
            logged_in = client.post(
                "/login",
                data={"password": "different-test-password"},
                follow_redirects=False,
            )

        self.assertEqual(changed.headers["location"], "/login")
        self.assertEqual(revoked.headers["location"], "/login")
        self.assertEqual(logged_in.headers["location"], "/")


if __name__ == "__main__":
    unittest.main()
