#!/usr/bin/env python3
"""Prepare and publish guarded semantic-version releases."""

import argparse
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
VALIDATION_COMMANDS = (
    ("uv", "run", "ruff", "format", "--check", "src", "tests", "scripts"),
    ("uv", "run", "ruff", "check", "src", "tests", "scripts"),
    ("uv", "run", "python", "-m", "unittest", "discover", "-s", "tests", "-v"),
    ("uv", "build"),
)


class ReleaseError(RuntimeError):
    """A release precondition or command failed."""


def run(*args: str, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            cwd=ROOT,
            check=check,
            text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
        )
    except FileNotFoundError as exc:
        raise ReleaseError(f"required command is unavailable: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        suffix = f": {detail}" if detail else ""
        raise ReleaseError(f"command failed: {' '.join(args)}{suffix}") from exc


def output(*args: str) -> str:
    return run(*args, capture=True).stdout.strip()


def project_version(path: Path = ROOT / "pyproject.toml") -> str:
    with path.open("rb") as handle:
        version = tomllib.load(handle)["project"]["version"]
    if not isinstance(version, str) or VERSION_PATTERN.fullmatch(version) is None:
        raise ReleaseError(f"project version must use MAJOR.MINOR.PATCH, got {version!r}")
    return version


def bumped_version(version: str, part: str) -> str:
    match = VERSION_PATTERN.fullmatch(version)
    if match is None:
        raise ReleaseError(f"project version must use MAJOR.MINOR.PATCH, got {version!r}")
    major, minor, patch = (int(value) for value in match.groups())
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ReleaseError(f"unsupported version bump: {part}")


def require_clean_master() -> None:
    if output("git", "status", "--porcelain"):
        raise ReleaseError("working tree must be clean before releasing")
    branch = output("git", "branch", "--show-current")
    if branch != "master":
        raise ReleaseError(f"release commands must start on master, currently on {branch!r}")
    run("git", "fetch", "origin")
    if output("git", "rev-parse", "HEAD") != output("git", "rev-parse", "origin/master"):
        raise ReleaseError(
            "local master must exactly match origin/master; pull or resolve it first"
        )


def require_unused_tag(tag: str) -> None:
    if output("git", "tag", "--list", tag):
        raise ReleaseError(f"tag already exists locally: {tag}")
    result = run(
        "git",
        "ls-remote",
        "--exit-code",
        "--tags",
        "origin",
        f"refs/tags/{tag}",
        capture=True,
        check=False,
    )
    if result.returncode == 0:
        raise ReleaseError(f"tag already exists on origin: {tag}")
    if result.returncode != 2:
        raise ReleaseError(f"could not check whether tag exists on origin: {tag}")


def prepare(part: str) -> None:
    require_clean_master()
    current = project_version()
    version = bumped_version(current, part)
    tag = f"v{version}"
    branch = f"chore/release-{tag}"
    require_unused_tag(tag)

    run("git", "switch", "-c", branch)
    run("uv", "version", version, "--no-sync")
    changed = set(output("git", "status", "--short").splitlines())
    changed_paths = {line[3:] for line in changed}
    if changed_paths != {"pyproject.toml", "uv.lock"}:
        raise ReleaseError(
            "version bump changed unexpected files: " + ", ".join(sorted(changed_paths))
        )

    for command in VALIDATION_COMMANDS:
        run(*command)

    message = f"🚀 release(repo): prepare {version}"
    run("git", "add", "pyproject.toml", "uv.lock")
    run("git", "commit", "-m", message)
    run("git", "push", "-u", "origin", branch)
    body = (
        f"## Summary\n\n- Prepare release `{tag}`.\n\n"
        "## Validation\n\n"
        "- [x] Formatting\n- [x] Linting\n- [x] Unit tests\n- [x] Package build\n\n"
        "## Persistence and configuration\n\nNone.\n\n"
        "## Breaking changes\n\nNone.\n"
    )
    url = output(
        "gh",
        "pr",
        "create",
        "--base",
        "master",
        "--head",
        branch,
        "--title",
        message,
        "--body",
        body,
    )
    print(f"Prepared {tag}: {url}")
    print("Merge the release PR, then run: uv run python scripts/release.py publish")


def publish() -> None:
    require_clean_master()
    version = project_version()
    tag = f"v{version}"
    require_unused_tag(tag)

    run("git", "tag", "-a", tag, "-m", f"Release {tag}")
    run("git", "push", "origin", tag)
    print(f"Published {tag}; GitHub Actions will validate and release the tagged commit.")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare", help="bump the version and open a release PR")
    prepare_parser.add_argument("part", choices=("major", "minor", "patch"))
    commands.add_parser("publish", help="tag and push the merged release commit")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "prepare":
            prepare(args.part)
        else:
            publish()
    except ReleaseError as exc:
        print(f"release aborted: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
