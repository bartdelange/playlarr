"""Prepare container storage before starting the application as an unprivileged user."""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from pathlib import Path

CONTAINER_STORAGE_DIRS = (Path("/data"), Path("/playlists"), Path("/secrets"))
APPLICATION_UID = 1000
APPLICATION_GID = 1000


def prepare_storage(paths: Sequence[Path] = CONTAINER_STORAGE_DIRS) -> None:
    """Make Docker-created bind mount roots writable by the application user."""
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, APPLICATION_UID, APPLICATION_GID)


def run(command: Sequence[str]) -> None:
    if not command:
        raise ValueError("a command is required")

    if os.geteuid() == 0:
        prepare_storage()
        os.setgroups([])
        os.setgid(APPLICATION_GID)
        os.setuid(APPLICATION_UID)

    os.execvp(command[0], command)


if __name__ == "__main__":
    run(sys.argv[1:])
