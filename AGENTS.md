# Repository guidance

## Project purpose and architecture

Playlarr is a self-hosted playlist acquisition and library orchestration application.

The application imports playlists from Spotify and TIDAL, matches source tracks against MusicBrainz, plans and executes Lidarr operations, resolves resulting media through OpenSubsonic/Navidrome-compatible libraries, and exports deterministic playlists while preserving user intent, playlist ordering, and duplicates.

The repository is an Nx workspace using Next.js, TypeScript, SQLite, Vitest, Testing Library, and Playwright.

Keep the Next.js application layer thin. Application behavior belongs in the Nx libraries that own the relevant concern.

Current architectural areas are:

```text
apps/
  playlarr/
  playlarr-e2e/

libs/
  components/
    ui/
  features/
    home/
    imports/
    settings/
  lib/
    domain/
  server/
    providers/
    persistence/
    commands/
    runtime/
```

The intended ownership is:

* `apps/playlarr` — Next.js routing, layouts, framework-specific entrypoints, and application composition
* `apps/playlarr-e2e` — Playwright end-to-end tests
* `libs/components/ui` — generic reusable React UI
* `libs/features/*` — user-facing feature implementation and feature-specific presentation logic
* `libs/lib/domain` — framework-independent Playlarr domain models and business rules
* `libs/server/providers` — external-service adapters and normalized provider behavior
* `libs/server/persistence` — SQLite repositories, migrations, transactions, and persistence-specific concerns
* `libs/server/commands` — durable asynchronous command state and execution semantics
* `libs/server/runtime` — application composition root and process/runtime lifecycle

Nx module-boundary rules are authoritative. Do not bypass them with relative imports, path aliases, or moving code into a less appropriate project merely to satisfy the linter.

## Nx workspace conventions

Nx is the canonical task runner and project graph.

Use pnpm for dependency installation and workspace management, but do not introduce pnpm recursive or filter-based task orchestration where Nx targets are appropriate.

Use:

```bash
pnpm nx run <project>:<target>
pnpm nx run-many -t <targets>
pnpm nx affected -t <targets>
pnpm nx show project <project>
pnpm nx show projects
pnpm nx graph
pnpm nx graph --affected
```

Prefer inferred targets from official Nx plugins.

Keep `nx.json` configuration minimal. Use `project.json` only when package metadata, plugin inference, or existing configuration cannot express a genuine project-level requirement.

Add explicit dependencies only when Nx cannot infer them from imports, package relationships, or configuration.

Deterministic operations such as linting, type checking, testing, builds, formatting checks, and workflow validation should remain cacheable with accurate inputs and outputs.

Operations with external side effects must not be treated as cacheable. Examples include production deployment, destructive data operations, credential changes, or other mutations outside the local workspace.

Do not weaken or disable Nx module-boundary enforcement to make an implementation easier.

## Canonical validation commands

Use Nx targets rather than package-by-package orchestration.

Typical repository-wide validation is:

```bash
pnpm nx run-many -t lint,typecheck,test
pnpm nx run @playlarr/playlarr:build
pnpm nx run @playlarr/playlarr-e2e:e2e
pnpm nx format:check
```

Use affected validation where appropriate:

```bash
pnpm nx affected -t lint,typecheck,test,build
```

Run workflow validation using the repository's canonical actionlint setup.

Do not claim validation was performed unless the command actually ran successfully.

## General principles

Keep changes focused, reviewable, and easy to reason about.

For any non-trivial task:

* inspect the relevant existing code before changing it
* understand the current architecture and conventions before introducing abstractions
* prefer extending an existing pattern over creating a parallel implementation
* avoid unrelated cleanup, renaming, formatting, or refactoring
* remove obsolete code when its replacement is complete and verified
* do not silently change behavior outside the requested scope
* preserve unrelated user work

Do not add a dependency when the existing stack already provides an appropriate solution.

## Code organization

Organize code around domain cohesion and architectural ownership, not arbitrary file-size limits.

Keep unrelated models in separate domain files.

Keep small supporting definitions beside the model they exist to support when they have no meaningful independent use.

Put React components in a same-named folder when they have supporting files such as tests, helper modules, or component-specific types.

Keep shared types with the narrowest domain or feature that owns them.

Use `index.ts` only as a small public barrel containing exports. Do not place implementations, unrelated constants, or domain logic in barrel files.

Avoid catch-all files and directories such as:

```text
types.ts
common.ts
helpers.ts
utils.ts
misc.ts
```

when they mix unrelated concerns.

Do not create one file per type when several definitions form one cohesive model and normally change together.

### Vertical whitespace and logical boundaries

Use blank lines to separate distinct logical sections within a file, function, component, or JSX tree.

For React components, generally separate:

* state and hook declarations from callbacks and derived values
* callbacks and effects from one another
* setup logic from the component return
* distinct sibling sections in JSX
* guard clauses, mutation setup, execution, and cleanup

Use whitespace to communicate structure, not mechanically between every statement.

Prefer:

```tsx
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string | null>(null);

const mutate = async () => {
  if (busy) return;

  setBusy(true);
  setError(null);

  try {
    await performMutation();
  } finally {
    setBusy(false);
  }
};

return (
  <>
    <ImportControls />

    {error ? <ErrorMessage error={error} /> : null}

    {dialog === 'review' ? <ReviewDialog /> : null}
  </>
);
```

Avoid compressing unrelated logical phases into one uninterrupted block.

## UI and feature organization

Keep `apps/playlarr/src/app` intentionally small.

Route files should primarily:

* define routing
* receive route/search parameters
* compose feature entrypoints
* define framework-required layouts or boundaries
* expose Next.js-specific route handlers or server entrypoints where appropriate

Do not move ordinary feature implementation into the app directory merely because Next.js allows it.

User-facing application behavior belongs in `libs/features/*`.

Feature libraries may own:

* screens
* feature-specific components
* hooks
* view models
* client-side orchestration
* feature-local types
* loading, empty, error, and interaction states

Generic reusable visual primitives belong in `libs/components/ui`.

Feature libraries must not directly import persistence, providers, command infrastructure, or runtime composition unless an explicit server-facing architectural boundary is introduced.

Do not use a generic feature library as a dumping ground. Create feature libraries around meaningful user-facing responsibilities.

## Domain and server boundaries

### Domain

`libs/lib/domain` must remain framework- and infrastructure-independent.

Domain code must not depend on:

* React
* Next.js
* SQLite libraries
* HTTP clients
* provider SDKs
* process/environment APIs
* persistence implementations
* runtime composition

Domain code should model Playlarr concepts, invariants, and behavior.

### Providers

`libs/server/providers` owns external-service integration.

Provider code should:

* encapsulate transport and authentication details
* validate external responses
* normalize external data into Playlarr-owned models
* implement retries/backoff where appropriate
* avoid leaking third-party response shapes throughout the application

Provider code must not own SQLite persistence or application runtime lifecycle.

### Persistence

`libs/server/persistence` owns SQLite-specific behavior.

Persistence code should contain:

* repositories
* migrations
* transaction behavior
* SQLite configuration
* persistence mappings

Do not place business rules in repositories merely because data happens to be available there.

### Commands

`libs/server/commands` owns durable asynchronous operation semantics.

Long-running or restart-sensitive work must be represented by authoritative persisted command state rather than browser state or ephemeral in-memory state.

Commands should support clear persisted states such as pending, running, completed, failed, skipped, or equivalent domain-appropriate states.

Command execution must be designed so restart recovery can distinguish completed work from work that may need reconciliation.

Do not blindly repeat external side effects after an uncertain restart.

### Runtime

`libs/server/runtime` is the composition root.

Runtime code may initialize and connect:

* SQLite
* migrations
* repositories
* providers
* command execution
* event infrastructure
* application lifecycle
* the Next.js host

Avoid creating additional composition roots elsewhere in the repository.

The production application should remain one Node-owned runtime unless project requirements explicitly change.

Do not introduce an external queue, database, daemon, or second application process unless the architecture is deliberately changed.

## Durable state and SSE

Persisted state is authoritative.

In-memory events and Server-Sent Events are observation and notification mechanisms, not the source of truth.

A reconnecting client must be able to reconstruct current state from persisted application data.

Do not require a browser connection to keep long-running work alive.

Do not model normal external API calls as background commands merely because they may take several seconds. Use durable commands for work that genuinely requires persistence, restart recovery, asynchronous lifecycle management, or meaningful progress tracking.

## Playlist and matching semantics

Preserve playlist ordering and duplicate entries where Playlarr behavior requires them.

Do not silently deduplicate source tracks.

Do not replace a deliberate manual user decision with an automatic match merely because a later automatic result appears better.

Automatic MusicBrainz matching must preserve explicit manual decisions unless the user intentionally requests rematching or unlinking.

Keep Lidarr planning separate from Lidarr execution.

A plan should represent persisted intended actions based on current source, match, and Lidarr state.

Execution must operate against an explicit persisted plan rather than silently rebuilding a different plan during mutation.

## SQLite and migration discipline

Existing Playlarr SQLite data is part of the compatibility contract.

Do not casually change existing schema semantics.

When changing the database:

* use explicit migrations
* keep migrations deterministic
* consider populated existing databases
* avoid destructive or lossy changes unless explicitly required
* update repositories, mappings, tests, and migration logic together where appropriate
* preserve existing imports, settings, matches, and other application state
* document migration ordering when application code depends on it

SQLite integration tests should use temporary real SQLite databases where database semantics matter.

Do not substitute mocks for transaction, migration, locking, or persistence behavior that specifically needs SQLite validation.

Configure SQLite runtime behavior deliberately, including WAL, busy timeout, and transaction behavior where appropriate.

## External integrations

External-service code must use Playlarr-owned normalized models at architectural boundaries.

Relevant integrations include:

* Spotify
* TIDAL
* MusicBrainz
* Lidarr
* OpenSubsonic/Navidrome-compatible servers

Do not depend on live credentials or external services in normal automated tests.

Use deterministic fixtures, fakes, or mocked HTTP responses for automated integration tests.

Real-service smoke tests belong in explicit validation before release and must not expose credentials or personal service data.

Secrets, tokens, credentials, server addresses, and private user data must not be committed.

## TypeScript and dependency discipline

Keep TypeScript strict.

Do not suppress type errors with broad casts, `any`, or `@ts-ignore` when the underlying type can be modeled correctly.

Prefer:

* explicit domain types
* validated external inputs
* discriminated unions for meaningful state
* exhaustive handling where practical
* narrow interfaces at architectural boundaries

Avoid creating generic infrastructure abstractions before there is a concrete repeated need.

Do not add dependencies solely to avoid writing a small amount of straightforward code already well supported by the platform or existing stack.

When adding or upgrading dependencies:

* explain the architectural reason
* keep unrelated upgrades out of the change
* update the lockfile with dependency changes
* verify compatibility with supported runtime/tooling versions

## Testing

Add or update tests when behavior changes.

Use:

* Vitest for unit and integration tests
* Testing Library for React behavior
* Playwright for meaningful end-to-end user journeys

Prioritize tests around:

* domain/business rules
* matching behavior
* persistence
* migrations
* durable command behavior
* restart recovery
* authentication and authorization
* external input validation
* provider normalization
* error handling
* security-sensitive behavior
* playlist ordering and duplicate preservation

For integrations, test externally observable behavior rather than implementation details.

Do not weaken, skip, or remove existing tests merely to make a new implementation pass.

Newly scaffolded projects may temporarily contain no tests, but once behavior exists it should be tested at the appropriate boundary.

Critical restart-sensitive workflows must be tested by exercising interruption and recovery, not merely by unit-testing internal state transitions.

## Git workflow

For any non-trivial task, perform the work on a dedicated branch rather than directly on the default branch.

Before making changes:

1. ensure the working tree is clean
2. fetch the latest remote state
3. start from the latest default branch
4. create a dedicated branch using one of:

  * `feat/`
  * `fix/`
  * `chore/`

Use a short descriptive kebab-case branch name, for example:

```text
feat/spotify-import
fix/lidarr-recovery
chore/repository-tooling
```

During implementation:

* follow the repository's commit strategy
* keep commits small, logical, and independently reviewable
* do not merge or rebase unrelated work into the task branch
* do not push directly to the default branch

After implementation:

1. run the required final validation
2. review the complete branch diff against the default branch
3. push the task branch
4. create a non-draft pull request using `.github/pull_request_template.md`
5. complete the pull request description from the actual implementation and validation
6. do not merge the pull request unless explicitly requested

## Commit strategy

Split substantial work into small, logical, independently reviewable commits.

Before starting a large implementation or refactor, identify sensible commit boundaries based on functional or architectural units.

Good commit boundaries include:

* foundational domain models
* persistence schema or migrations
* provider implementation
* command infrastructure
* feature implementation
* runtime integration
* tests belonging to a completed behavior
* deployment or repository infrastructure
* removal of superseded code

Prefer several focused commits over one large final commit.

Do not:

* create arbitrary checkpoint commits
* create commits named `WIP`, `progress`, or similar
* split commits merely to reduce file count
* mix unrelated changes in the same commit
* intentionally leave the repository broken between commits when avoidable

Each commit should represent one understandable change and leave the repository valid whenever practical.

## Commit messages

All commits must use:

```text
<gitmoji> <type>(<scope>): <description>
```

The complete first line must not exceed 100 characters.

### Types

Only use:

* `feat` — introduces or extends behavior
* `fix` — corrects broken or incorrect behavior
* `chore` — maintenance, refactoring, tooling, infrastructure, dependency changes, test-only work, or repository housekeeping

Do not use `test` as a commit type.

Tests added as part of a feature or fix should normally be committed with that feature or fix.

Use `chore` for standalone test improvements.

Do not use `refactor` as a commit type. Use `chore` for behavior-preserving refactoring.

### Scopes

Use the narrowest applicable scope from:

* `app` — Next.js application composition, routing, and layouts
* `ui` — shared UI components and styling
* `import` — playlist import workflows and source-track handling
* `spotify` — Spotify integration
* `tidal` — TIDAL integration
* `musicbrainz` — MusicBrainz integration and matching
* `lidarr` — Lidarr planning and execution
* `library` — OpenSubsonic/Navidrome resolution and local additions
* `db` — SQLite schemas, migrations, repositories, and database infrastructure
* `runtime` — lifecycle, commands, events, SSE, and runtime composition
* `auth` — authentication, sessions, route protection, and CSRF
* `export` — playlist path mapping and exports
* `config` — shared application or runtime configuration
* `deployment` — Docker, Unraid, CI/CD, release infrastructure
* `repo` — repository-wide tooling or maintenance

Do not invent new scopes unless the repository convention is explicitly updated.

### Gitmoji

Every commit message begins with an appropriate Gitmoji.

Examples:

```text
✨ feat(import): add Spotify playlist selection
🐛 fix(lidarr): avoid replaying completed plan items
🗃️ feat(db): add persisted command state
♻️ chore(runtime): extract application event bus
✅ chore(import): add duplicate playlist track coverage
🔐 feat(auth): add optional session authentication
👷 chore(deployment): validate production Docker build
🔧 chore(repo): align Nx validation targets
```

The Gitmoji is independent of the commit type.

### Description style

Descriptions must:

* use lowercase sentence-style wording
* use imperative mood where practical
* describe the resulting change rather than the implementation process
* not end with a period

Prefer:

```text
✨ feat(lidarr): persist execution plans
```

Avoid:

```text
✨ feat(lidarr): added code for storing Lidarr execution plans.
```

Commit messages must satisfy the repository's commit-message validation.

If a commit is rejected, correct the message. Never bypass hooks using `--no-verify`.

## Validation before committing

Run validation relevant to the affected code before creating a commit.

This may include:

* formatting
* linting
* type checking
* unit tests
* integration tests
* Playwright tests
* builds
* workflow validation
* Docker validation

Do not blindly run the most expensive repository-wide suite after every tiny change if narrower validation is sufficient.

Before completing the overall task, run the broadest practical validation for the affected system.

If validation cannot be run or fails for reasons unrelated to the implementation, state that explicitly.

## Large refactors

Preserve behavior incrementally where practical.

Prefer:

1. introduce the new foundation
2. add the new implementation
3. migrate a limited consumer
4. verify behavior
5. migrate remaining consumers
6. remove the old implementation
7. perform focused cleanup

Avoid rewriting an entire subsystem in one commit when the work can reasonably be decomposed.

At the end of a refactor, search for:

* unused old implementations
* stale imports
* obsolete environment variables
* old configuration keys
* duplicate code paths
* dead feature flags
* outdated documentation
* obsolete tests

## Generated files

Do not create separate commit boundaries for generated output alone unless the generated artifact is intentionally version-controlled.

When generated files must be committed:

* keep them with the source change that generated them
* do not manually edit them
* regenerate them using the canonical command

## Scope control

If requested work exposes unrelated issues:

* do not silently expand the implementation
* leave unrelated issues untouched unless they block the task
* mention relevant follow-up work in the final summary

Small fixes directly required for correctness may be included, but must remain clearly attributable to the task.

## Final review

Before declaring a task complete:

* inspect the complete diff against the starting branch
* ensure no accidental files were modified
* remove temporary debugging code
* check that no secrets or credentials were introduced
* confirm generated artifacts are intentional
* confirm architectural boundaries remain intact
* confirm old and new implementations are not accidentally active together
* verify relevant environment and deployment configuration
* run final relevant validation

For substantial tasks, also review commit history to ensure commits are logically ordered and independently understandable.

## Pull requests

Use `.github/pull_request_template.md`.

Complete the pull request description from the actual final branch state.

Do not leave template instructions or placeholders in the submitted description.

### Summary

Describe the overall outcome and why the change exists.

Focus on user-visible behavior, system behavior, or architectural outcomes rather than file-by-file implementation details.

### Changes

Summarize the main logical units of work.

Where practical, align these with atomic commit boundaries without simply repeating every commit message.

### Validation

Mark only checks actually performed.

Include commands or manual scenarios when useful.

Never claim a test, build, or verification was performed if it was not.

### Database changes

Describe SQLite schema changes, migrations, data migrations, compatibility considerations, and required ordering.

Use `None` when there are no database changes.

### Deployment

Describe special Docker, Unraid, environment, secret, persistent-data, CI/CD, or release considerations.

Use `None` when none apply.

### Breaking changes

Explicitly document incompatible changes to:

* APIs
* database schemas
* configuration
* environment variables
* deployment expectations
* package contracts
* application behavior

Use `None` when there are no known breaking changes.

### Screenshots

Include screenshots for meaningful visual changes when they help review.

Remove the section when not applicable.

### Notes

Use notes only for information that materially helps reviewers, such as:

* architectural decisions
* non-obvious trade-offs
* known limitations
* intentionally deferred work
* relevant follow-up work

Remove the section when unnecessary.

### Pull request title

Use the same commit convention when the PR has a natural single scope:

```text
✨ feat(import): add Spotify playlist import
```

If a pull request spans multiple genuine scopes, omit the scope rather than inventing an inaccurate broad one:

```text
✨ feat: add durable playlist import flow
```

Review the complete diff before creating the pull request and ensure the description accurately reflects the final branch.

Do not merge the pull request unless explicitly requested.

## Final response

At the end of a task, provide a concise summary containing:

* what was implemented
* important architectural decisions
* database or deployment steps required
* validation performed
* anything that could not be validated
* notable follow-up work

Also include a short commit summary.

Do not dump a long file-by-file change list unless it is specifically useful.
