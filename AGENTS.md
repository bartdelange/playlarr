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

`music_importer` is organized by capability. Its root is reserved for package metadata and truly
cross-cutting configuration; it is not the default location for new modules.

- `app/` owns installed commands, local-server launch, and container process bootstrap.
- `domain/` owns provider-independent value objects and playlist identity rules.
- `application/` owns source-neutral acquisition, resolution, library-status, playlist-export, and
  background-task coordination. It must not depend on FastAPI, templates, or terminal I/O.
- `workflows/` owns end-to-end process workflows and any CLI-specific presentation.
- `integrations/sources/` owns the source protocol and Spotify/TIDAL adapters.
- `integrations/musicbrainz/` owns MusicBrainz protocol, matching, and validation details.
- `integrations/lidarr/` owns Lidarr transport, planning, execution, and library matching. Planning
  stays read-only and execution must correspond to an approved plan.
- `persistence/` owns SQLite schema migrations, durable records, and repositories. Migrations must
  be forward-only and retain existing imports.
- `exports/` owns CSV compatibility, diagnostic reports, and M3U serialization. CSV is interchange
  or diagnostic data, never primary state.
- `web/` owns FastAPI composition, thin capability-oriented handlers, templates, and static assets.

Dependencies flow from `web/` and `app/` through `application/` or `workflows/`, then toward domain
and infrastructure boundaries. Domain and application logic must never depend on the web UI.
Circular dependencies are architectural defects and must be removed rather than hidden by local
imports. External-service payload and protocol details stay behind their integration boundary.

## File organization and reuse

- Create a module when a responsibility has a stable name and can be tested independently. Do not
  split files solely to reduce line count.
- Files approaching roughly 100–200 lines should trigger a responsibility review. Line count is a
  warning signal, not an architectural metric: keep a longer cohesive implementation together, but
  decompose a module whenever the review reveals distinct reasons to change.
- New functionality belongs in the package or subpackage that owns its responsibility. Introduce a
  new top-level package only when it represents a meaningful capability.
- Keep web handlers thin: translate requests, call application/workflow services, and prepare
  responses. Do not move business rules into handlers or templates.
- Colocate small private types and constants with the behavior they describe. Move types only when
  multiple boundaries genuinely share the contract.
- Use responsibility-specific names such as `playlist_updates.py`; do not introduce `utils.py`,
  `helpers.py`, `misc.py`, `common.py`, or other dumping grounds.
- Decompose large modules along real responsibility boundaries. Do not create fragments merely to
  satisfy a line-count target.
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
uv run uvicorn music_importer.web.app:create_app --factory --host 127.0.0.1 --port 8787
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
<emoji> <type>(<scope>): <description>
```

Allowed types are `chore`, `docs`, `feat`, `fix`, `refactor`, `release`, `revert`, and `test`.
Allowed scopes are `config`, `deployment`, `lidarr`, `musicbrainz`, `persistence`,
`playlist`, `repo`, `sources`, and `web`. Choose the narrowest applicable scope. Descriptions start lowercase, use imperative wording where
practical, describe the resulting change, do not end with a period, and keep the complete header at
100 characters or fewer.

Examples:

```text
✨ feat(playlist): preview source playlist updates
🐛 fix(lidarr): preserve downloaded release selection
♻️ refactor(config): isolate persisted settings normalization
✅ test(persistence): cover restart recovery
📝 docs(repo): explain container authentication boundary
👷 chore(repo): add pull request validation
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
