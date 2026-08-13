#!/usr/bin/env python3
"""Validate the repository's Conventional Commit header format."""

import re
import sys
from pathlib import Path

ALLOWED_TYPES = {
    "chore",
    "docs",
    "feat",
    "fix",
    "refactor",
    "release",
    "revert",
    "test",
}
ALLOWED_SCOPES = {
    "config",
    "deployment",
    "lidarr",
    "musicbrainz",
    "persistence",
    "playlist",
    "repo",
    "sources",
    "web",
}
MAX_HEADER_LENGTH = 100
HEADER_PATTERN = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[a-z0-9._/-]+)\))?: (?P<subject>.+)$")


def validate_header(header: str) -> str | None:
    if not header:
        return "Commit message must not be empty."
    if header.startswith(("Merge ", "Revert ")):
        return None
    if len(header) > MAX_HEADER_LENGTH:
        return f"Commit header is {len(header)} characters; maximum is {MAX_HEADER_LENGTH}."

    match = HEADER_PATTERN.fullmatch(header)
    if match is None:
        return "Invalid commit message. Use: <type>(<optional-scope>): <description>"

    commit_type = match.group("type")
    if commit_type not in ALLOWED_TYPES:
        allowed = ", ".join(sorted(ALLOWED_TYPES))
        return f"Invalid commit type {commit_type!r}. Allowed types: {allowed}."

    scope = match.group("scope")
    if scope is not None and scope not in ALLOWED_SCOPES:
        allowed = ", ".join(sorted(ALLOWED_SCOPES))
        return f"Invalid commit scope {scope!r}. Allowed scopes: {allowed}."

    subject = match.group("subject")
    if subject[0].isupper():
        return "Commit description must start with a lowercase character."
    if subject.endswith("."):
        return "Commit description must not end with a period."

    return None


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_commit_msg.py <commit-msg-file>", file=sys.stderr)
        return 2

    lines = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
    header = next((line.strip() for line in lines if line.strip() and not line.startswith("#")), "")
    error = validate_header(header)
    if error is None:
        return 0

    print(f"{error}\nExample: fix(lidarr): preserve downloaded release selection", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
