# Contributing

Thank you for improving Music Importer. Please open an issue before a large architectural change so
the intended behavior and migration impact can be agreed first.

## Local setup

Use Python 3.12 or newer and `uv`:

```bash
uv sync --locked --dev
cp .env.example .env
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

Do not commit credentials, OAuth sessions, SQLite databases, or generated reports. Tests should not
call live Spotify, TIDAL, MusicBrainz, Lidarr, or Navidrome services.

## Making changes

- Preserve source playlist order, duplicate occurrences, manual decisions, and Lidarr's additive
  safety behavior unless a change explicitly intends otherwise.
- Keep external API details inside their integration modules and persistence details inside
  `persistence.py`.
- Add focused regression tests for behavior changes. Prefer observable outcomes over implementation
  details.
- Avoid unrelated cleanup in focused fixes and avoid new dependencies for trivial functionality.

## Git workflow

Create a dedicated `feat/`, `fix/`, or `chore/` branch from the latest default branch. Keep commits
focused and independently reviewable, and do not push directly to the default branch.

Commit headers combine a Gitmoji with a Conventional Commit type and required scope:

```text
<emoji> <type>(<scope>): <description>
```

Allowed types are `chore`, `docs`, `feat`, `fix`, `refactor`, `release`, `revert`, and `test`.
Allowed scopes are `config`, `deployment`, `lidarr`, `musicbrainz`, `persistence`, `playlist`,
`repo`, `sources`, and `web`. Keep headers at 100 characters or fewer, begin the description with
lowercase wording, and omit the final period. For example:

```text
🐛 fix(lidarr): preserve downloaded release selection
📝 docs(repo): explain local configuration
```

The installed `commit-msg` hook enforces this format. Do not bypass repository hooks with
`--no-verify`.

Before submitting a change, run:

```bash
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run python -m unittest discover -s tests -v
uv build
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7
```

Review the branch diff, push the task branch, and open a non-draft pull request using the repository
template. Explain user-visible changes, validation, and configuration or migration requirements. Do
not merge your own pull request as part of the contribution workflow. A license has intentionally
not been selected yet; contributors should not add one without maintainer approval.
