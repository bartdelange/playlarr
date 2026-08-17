import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from music_importer.app.container_entrypoint import (
    APPLICATION_GID,
    APPLICATION_UID,
    CONTAINER_STORAGE_DIRS,
    prepare_storage,
    run,
)


class ContainerEntrypointTests(unittest.TestCase):
    def test_container_uses_one_appdata_root_and_a_separate_playlist_mount(self):
        self.assertEqual(CONTAINER_STORAGE_DIRS, (Path("/config"), Path("/playlists")))

    def test_prepare_storage_creates_and_owns_mount_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "data"
            with patch("music_importer.app.container_entrypoint.os.chown") as chown:
                prepare_storage((storage,))

            self.assertTrue(storage.exists())
            chown.assert_called_once_with(storage, APPLICATION_UID, APPLICATION_GID)

    @patch("music_importer.app.container_entrypoint.os.execvp")
    @patch("music_importer.app.container_entrypoint.os.setuid")
    @patch("music_importer.app.container_entrypoint.os.setgid")
    @patch("music_importer.app.container_entrypoint.os.setgroups")
    @patch("music_importer.app.container_entrypoint.prepare_storage")
    @patch("music_importer.app.container_entrypoint.os.geteuid", return_value=0)
    def test_run_prepares_storage_and_drops_privileges_before_exec(
        self, geteuid, prepare, setgroups, setgid, setuid, execvp
    ):
        manager = unittest.mock.Mock()
        manager.attach_mock(prepare, "prepare")
        manager.attach_mock(setgroups, "setgroups")
        manager.attach_mock(setgid, "setgid")
        manager.attach_mock(setuid, "setuid")
        manager.attach_mock(execvp, "execvp")

        run(("server", "--port", "8787"))

        self.assertEqual(
            manager.mock_calls,
            [
                call.prepare(),
                call.setgroups([]),
                call.setgid(APPLICATION_GID),
                call.setuid(APPLICATION_UID),
                call.execvp("server", ("server", "--port", "8787")),
            ],
        )

    @patch("music_importer.app.container_entrypoint.os.execvp")
    @patch("music_importer.app.container_entrypoint.prepare_storage")
    def test_run_does_not_prepare_storage_when_already_unprivileged(self, prepare, execvp):
        with patch("music_importer.app.container_entrypoint.os.geteuid", return_value=1000):
            run(("server",))

        prepare.assert_not_called()
        execvp.assert_called_once_with("server", ("server",))
