# Contributing to Playlarr

Thanks for improving Playlarr. Open an issue before a substantial architectural or workflow change
so its user impact and persistence migration can be agreed first.

## Local setup

Use Python 3.12+ and [uv](https://docs.astral.sh/uv):

```bash
uv sync --locked --dev
cp .env.example .env
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
uv run uvicorn music_importer.web.app:create_app --factory --host 127.0.0.1 --port 8787
```

Playlarr is a web-only application. Do not commit credentials, OAuth sessions, SQLite databases,
generated reports, or screenshots containing personal data. Tests must not contact live services.

## Project structure

`music_importer` is organized by capability:

- `web/` contains FastAPI composition, thin routes, templates, and static assets.
- `application/` coordinates source-neutral use cases and background tasks.
- `domain/` owns provider-independent records and rules.
- `integrations/` isolates Spotify, TIDAL, MusicBrainz, Lidarr, and Navidrome details.
- `persistence/` owns SQLite migrations and durable repositories.
- `exports/` owns M3U8, CSV compatibility, and diagnostic reports.

Dependencies flow from web handlers through application services toward domain and infrastructure.
Keep Lidarr planning read-only, execute only approved plans, preserve playlist positions and duplicate
occurrences, and retain confirmed manual mappings unless a migration explicitly changes that contract.

## Validation

Before opening a pull request, run:

```bash
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run python -m unittest discover -s tests -v
uv build
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7
```

Add focused regression tests for behavior changes. The suite uses mocks and requires no credentials.

## Git and pull requests

Use a focused `feat/`, `fix/`, or `chore/` branch. Keep commits independently reviewable and do not
push directly to the default branch. Commit headers use Gitmoji Conventional Commits:

```text
<emoji> <type>(<scope>): <description>
```

Allowed types are `chore`, `docs`, `feat`, `fix`, `refactor`, `release`, `revert`, and `test`.
Allowed scopes are `config`, `deployment`, `lidarr`, `musicbrainz`, `persistence`, `playlist`,
`repo`, `sources`, and `web`. Headers are at most 100 characters, use lowercase descriptions, and
omit a final period. For example:

```text
🐛 fix(lidarr): preserve downloaded release selection
📝 docs(repo): explain local configuration
```

Review the full diff, push the branch, and open a non-draft pull request using the repository
template. Describe user-visible behavior, validation, and any configuration or migration impact.
See [docs/releasing.md](docs/releasing.md) for maintainer release procedures.
