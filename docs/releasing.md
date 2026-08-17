# Releasing Playlarr

This guide is for repository maintainers. Playlarr uses annotated semantic-version tags as releases.

## Prepare a release

Start from an up-to-date default branch and a clean worktree. Prepare a patch, minor, or major
release PR with the guarded helper:

```bash
uv run python scripts/release.py prepare patch
```

The helper updates `pyproject.toml` and `uv.lock`, runs project validation, opens the release PR,
and refuses to move or reuse an existing tag. Review and merge that PR normally.

## Publish the tag

After the release PR is merged:

```bash
git switch master
git pull --ff-only
uv run python scripts/release.py publish
```

The release workflow verifies the tag, publishes versioned and `latest` `linux/amd64` images to
GHCR with provenance, and creates the GitHub release.

## Publication safety

Before making a pre-existing repository public, inspect the complete Git history for credentials,
not just the current worktree. Verify that `.env`, `.secrets/`, `.data/`, OAuth sessions, API keys,
generated reports, and container data are excluded. Enable Dependabot alerts, secret scanning with
push protection, and CodeQL after public visibility is enabled.
