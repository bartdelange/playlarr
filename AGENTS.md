# Repository guidance

## Project principles

- Prefer explicit, readable code over clever abstractions. Keep abstractions proportional to the
  domain problem they represent.
- Preserve externally observable behavior and persisted-data compatibility unless a change
  explicitly requires a migration.
- This application is deliberately conservative around Lidarr. Planning must remain read-only;
  mutations must correspond to an approved plan; synchronization remains additive; and Various
  Artists protections must not be bypassed implicitly.
- Preserve playlist positions and duplicate occurrences. Stable source IDs, ISRCs, and confirmed
  manual mappings are durable workflow inputs.
- Consolidate repeated implementations of the same domain rule, but do not combine superficially
  similar concepts that may evolve independently.

## Architecture and dependency direction

- `cli.py` and `launcher.py` are the installed command and local-server entry points.
- `web.py` owns HTTP routing and presentation coordination. Templates and CSS belong in
  `web_assets/`; presentation-independent behavior does not.
- `services.py` coordinates source-neutral workflows and must not depend on FastAPI, terminal I/O,
  templates, or CSV reports.
- `sources/` contains the source protocol and Spotify/TIDAL adapters. Keep provider payload parsing
  and authentication inside the owning adapter.
- `musicbrainz.py`, `lidarr.py`, and `navidrome.py` are external integration boundaries. Do not leak
  raw provider payload assumptions into routes or templates.
- `persistence.py` is the SQLite boundary and owns schema migrations and durable record mapping.
  Schema changes must be forward migrations that retain existing imports.
- `models.py` contains shared domain value objects. Keep small route-only or module-only types near
  their owner instead of growing a universal model layer.
- `reports.py`, `csv_compat.py`, and `m3u.py` own export/import formats. CSV is compatibility and
  diagnostic data, not the primary application state.

Dependencies should point from entry points and presentation toward services and domain/integration
boundaries. Domain services must not import the web layer.

## File organization and reuse

- Create a module when a responsibility has a stable name and can be tested independently. Do not
  split files solely to reduce line count.
- Colocate small private types and constants with the behavior they describe. Move types only when
  multiple boundaries genuinely share the contract.
- Use responsibility-specific names such as `playlist_updates.py`; do not introduce `utils.py`,
  `helpers.py`, `common.py`, or other dumping grounds.
- Prefer a small direct function over a one-use factory or generic framework. New shared helpers
  must express a domain concept, not merely remove matching lines.
- Avoid barrel modules. Import from the module that owns the behavior.

## Coding conventions

- Target Python 3.12+ and use modern built-in generics and union syntax.
- Ruff defines formatting and import ordering. The configured line length is 100 characters.
- Use `snake_case` for modules, functions, and values; `PascalCase` for classes; and descriptive
  domain names rather than implementation abbreviations.
- Add vertical whitespace between setup, derived state, side effects, and return logic in non-trivial
  functions. Prefer early returns where they clarify failure paths.
- Keep async code only where the framework or I/O contract requires it. Background workflows use
  `TaskManager`; persist progress and cancellation state through `ImportRepository`.
- Catch errors at the boundary that can add context or translate them for a user. Do not silently
  swallow errors or catch and rethrow without context. Never include API keys, passwords, or OAuth
  tokens in rendered errors or logs.
- Comments should explain invariants, external constraints, and safety decisions, not restate code.
- Prefer precise dataclasses, protocols, tuples, and optional values to `Any` or unstructured
  dictionaries when the shape is owned locally. Raw dictionaries are acceptable at external JSON
  boundaries and for deliberately flexible persisted payloads.

## Testing

- Tests live in `tests/` and use `unittest`. Name files after the module or behavior under test.
- Protect observable domain behavior: matching safeguards, persistence across restarts, migration,
  source parsing, ordered duplicates, planning/execution correspondence, cancellation, and web
  workflow transitions.
- Mock external services; the automated suite must not require credentials or network access.
- Add a regression test when fixing a bug or extracting logic whose contract was previously hidden
  inside a route or integration.

## Tooling

Use the locked `uv` environment:

```bash
uv sync --locked --dev
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
uv run music-import
uv run ruff format src tests scripts
uv run ruff format --check src tests scripts
uv run ruff check src tests scripts
uv run python -m unittest discover -s tests -v
uv build
docker compose up -d --build
```

For normal code changes, run the format check, lint, and full unit suite. Also run `uv build` when
changing packaging, dependencies, entry points, or package data. Validate the Compose build when
changing container or deployment files.

## Git workflow

For non-trivial work, use a dedicated branch instead of working directly on the default branch.

Before changing files:

1. Ensure the working tree is clean. Preserve existing user changes and stop if they overlap the
   requested work.
2. Fetch the latest remote state and start from the latest default branch.
3. Create a short, descriptive kebab-case branch using `feat/`, `fix/`, or `chore/`, for example
   `feat/playlist-refresh`, `fix/lidarr-release-selection`, or `chore/update-ci`.

Keep commits small, logical, and independently reviewable. A commit should represent one coherent
change and leave the repository valid whenever practical. Do not create `WIP` or checkpoint commits,
mix unrelated changes, merge unrelated branches into the task branch, bypass hooks with
`--no-verify`, or push directly to the default branch.

Use Conventional Commit headers:

```text
<type>(<optional-scope>): <description>
```

Allowed types are `chore`, `docs`, `feat`, `fix`, `refactor`, `release`, `revert`, and `test`.
Allowed optional scopes are `config`, `deployment`, `lidarr`, `musicbrainz`, `persistence`,
`playlist`, `repo`, `sources`, and `web`. Choose the narrowest applicable scope; omit it for a
genuinely cross-cutting change. Descriptions start lowercase, use imperative wording where
practical, describe the resulting change, do not end with a period, and keep the complete header at
100 characters or fewer.

Examples:

```text
feat(playlist): preview source playlist updates
fix(lidarr): preserve downloaded release selection
refactor(config): isolate persisted settings normalization
test(persistence): cover restart recovery
docs: explain container authentication boundary
chore(repo): add pull request validation
```

Tests normally belong in the same commit as the feature or fix they protect. Use `test` only for
standalone test improvements and `refactor` only for behavior-preserving structural changes. Commit
messages are enforced by the `commit-msg` hook; correct rejected messages instead of bypassing it.

After implementation:

1. Run the relevant validation, then review the complete branch diff against the default branch.
2. Push the task branch and open a non-draft pull request using
   `.github/pull_request_template.md`.
3. Fill the template from the actual behavior, validation, persistence/configuration impact, and
   known follow-up work.
4. Do not merge the pull request unless the user explicitly requests it.

When asked to publish completed work, report the branch, commits, pull request URL, validation,
deployment or configuration steps, and unresolved concerns.

## Change discipline

1. Inspect nearby code and tests before introducing a new pattern.
2. Reuse existing domain abstractions when they represent the same rule.
3. Avoid dependencies for functionality that is small and clear locally.
4. Keep focused changes focused; do not mix unrelated refactors into feature or bug work.
5. Update tests and documentation when behavior, configuration, persistence, or workflows change.
6. Run the relevant validation commands before considering the work complete.
7. Never commit `.env`, `.secrets/`, `.data/`, OAuth sessions, API keys, generated reports, or
   container data.
