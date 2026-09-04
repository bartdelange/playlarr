# Repository guidance

## Project purpose and architecture

Playlarr is a self-hosted playlist acquisition and library orchestration application.

The application imports playlists from Spotify and TIDAL, matches source tracks against MusicBrainz, plans and executes Lidarr operations, resolves resulting media through OpenSubsonic/Navidrome-compatible libraries, and exports deterministic playlists while preserving user intent, playlist ordering, and duplicates.

Playlarr is a strict-TypeScript Nx monorepo.

The application architecture is:

```text
User
  ↓
Next.js
  ↓
same-origin /api/* proxy
  ↓
NestJS
  ↓
feature logic
  ↓
feature persistence
  ↓
SQLite
```

Production remains one Docker/Unraid container and one public Playlarr origin.

Next.js owns rendering, UI, frontend composition, and browser-facing concerns.

NestJS owns API transport, backend orchestration, long-running work, persistence composition, and backend lifecycle.

### Current repository structure

The current top-level application and library structure is:

```text
apps/
  web/
  web-e2e/
  server/

libs/
  shared/
    database/
```

Current project ownership is:

* `@playlarr/web` — Next.js App Router application, rendering, layouts, routes, frontend composition, and same-origin `/api/*` proxy configuration
* `@playlarr/web-e2e` — Playwright end-to-end tests spanning the public Playlarr application
* `@playlarr/server` — NestJS backend application, API transport, backend composition, configuration, and process lifecycle
* `@playlarr/shared-database` — global MikroORM/SQLite setup, migrations, and database infrastructure

The repository is intentionally still being decomposed into capabilities. Do not create placeholder libraries merely to match the intended architecture.

## Capability and library organization

Prefer vertical capabilities.

When functionality becomes substantial enough to warrant extraction from an application, organize it under:

```text
libs/<capability>/contracts
libs/<capability>/domain
libs/<capability>/web
libs/<capability>/server
libs/<capability>/persistence
```

Only create layers that contain real code.

Do not scaffold empty `contracts`, `domain`, `web`, `server`, or `persistence` libraries in anticipation of future work.

Before creating a new library, determine:

1. whether an existing capability already owns the concern
2. whether the new boundary provides real architectural value
3. whether the code has enough independent responsibility to justify another Nx project

Cross-feature code belongs under `libs/shared` only when it has multiple genuine consumers.

Examples of appropriate shared libraries include:

```text
libs/shared/ui
libs/shared/database
libs/shared/contracts
libs/shared/testing
```

These examples describe valid ownership locations, not libraries that must exist.

Do not use `shared` as a dumping ground for code whose owning capability is unclear.

Feature-specific DTOs, entities, repositories, components, domain rules, and transport code belong to their owning capability.

## Dependency boundaries

Nx module-boundary rules are authoritative.

The workspace uses project tags to enforce both platform and architectural dependencies.

Relevant platform tags are:

* `platform:web`
* `platform:server`
* `platform:shared`

Relevant project-type tags are:

* `type:app`
* `type:e2e`
* `type:feature`
* `type:ui`
* `type:domain`
* `type:contracts`
* `type:config`
* `type:infrastructure`
* `type:persistence`

Follow the dependency constraints defined in `eslint.config.mjs`.

Do not bypass them using relative imports, path aliases, inappropriate project placement, or weakened lint rules merely to make an implementation pass.

### Web

Frontend code belongs on the web platform.

Web code must not import server-only or persistence/database implementation libraries.

Next.js communicates with backend capabilities through NestJS HTTP or SSE APIs.

Do not import repositories, MikroORM entities, database infrastructure, or backend provider implementations into frontend code.

Shared API request and response models belong in capability contracts where such contracts are needed.

### Server

Backend code belongs on the server platform.

Server code may compose capability server, domain, contracts, persistence, configuration, and infrastructure libraries where allowed by the Nx dependency rules.

NestJS modules, controllers, and providers are composition and transport boundaries.

Keep pure business and domain logic framework-independent where practical.

Infrastructure such as repositories, adapters, and lifecycle services may use NestJS dependency injection when appropriate.

### Persistence

Feature persistence belongs with the capability that owns the data.

For example:

```text
libs/imports/persistence
libs/matching/persistence
libs/lidarr/persistence
```

These paths are examples of the intended organization and do not imply that those libraries currently exist.

`libs/shared/database` owns only global database concerns such as:

* MikroORM root configuration
* SQLite connection configuration
* migration infrastructure
* database startup lifecycle
* genuinely shared database infrastructure

Do not move feature entities or repositories into `shared/database` merely because they use SQLite.

### Contracts and domain

Contracts and domain libraries should remain framework-independent.

Do not expose ORM entities directly as API contracts.

Domain and contracts code should not depend on framework or infrastructure implementation details such as:

* React
* Next.js
* NestJS
* MikroORM
* SQLite drivers
* provider SDKs
* persistence implementations

unless the project explicitly belongs to an infrastructure-facing layer.

## Next.js application

Use the App Router.

Keep `apps/web/src/app` intentionally small.

Route files should primarily:

* define routes
* receive route and search parameters
* compose feature entrypoints
* define layouts and framework boundaries
* implement genuinely Next.js-specific behavior

Prefer Server Components.

Use Client Components only when browser interaction requires them.

Use Suspense and loading states for asynchronous UI where appropriate.

Do not move normal feature implementation into `apps/web/src/app` merely because Next.js permits it.

Next.js communicates with backend capabilities through NestJS APIs.

Browser-facing backend requests use the same Playlarr origin through `/api/*`.

The Next.js application proxies `/api/*` to the internal NestJS server.

Do not make browser code aware of the internal NestJS host or port.

## NestJS backend

`apps/server` is the NestJS application and backend composition root.

It owns:

* NestJS application bootstrap
* global backend configuration
* API transport setup
* composition of backend capability modules
* startup and shutdown lifecycle

The NestJS HTTP API uses the `/api` global prefix.

Keep controllers thin.

Controllers should primarily:

* receive and validate transport input
* invoke capability-level orchestration
* translate results into HTTP responses

Do not place substantial business logic directly in controllers.

NestJS modules should compose capabilities rather than becoming large feature implementations themselves.

Long-running operations must not depend on the lifetime of an HTTP request or browser connection.

## Long-running work and durable commands

Use durable SQLite-backed commands for work that must survive application restarts or continue independently of the initiating request.

Examples include:

* large matching jobs
* long-running imports
* multi-step Lidarr execution
* tasks with meaningful progress or restart recovery

Ordinary provider calls and normal API requests should remain ordinary requests.

Do not model every operation as a background command merely because it performs I/O or takes several seconds.

Persist authoritative command state.

Appropriate command states may include:

```text
pending
running
completed
failed
skipped
```

or equivalent capability-specific states.

Command processing may use in-process scheduling or event mechanisms, but persisted SQLite state remains authoritative.

Do not introduce Redis, RabbitMQ, Kafka, another external queue, or another required infrastructure service unless the architecture is deliberately changed.

A restart must be able to distinguish completed work from work requiring retry, reconciliation, or failure handling.

Do not blindly repeat uncertain external side effects.

## SSE and application state

Persisted backend state is authoritative.

Server-Sent Events communicate changes and progress.

SSE is not authoritative state.

A reconnecting client must be able to reconstruct current state from persisted backend data.

Do not require an active browser connection to keep long-running operations alive.

## SQLite and MikroORM

SQLite is the production database.

MikroORM is the ORM.

Production database initialization must configure SQLite with:

* foreign keys enabled
* WAL journal mode
* busy timeout

Run committed pending migrations programmatically during NestJS startup before the application begins normal operation.

Do not use destructive automatic schema synchronization in production.

Existing Playlarr SQLite data is part of the compatibility contract.

Schema changes must use forward migrations that preserve legacy user data whenever feasible.

Prefer migrations that remain stable independently of the current entity implementation.

Feature entities and repositories belong to their capability persistence libraries.

`libs/shared/database` must not accumulate feature-specific persistence.

Persistence tests should use real temporary SQLite databases when testing:

* migrations
* transactions
* locking
* constraints
* SQLite-specific behavior
* repository behavior that depends on database semantics

Do not replace such tests with mocks.

## Playlist and matching semantics

Preserve playlist ordering.

Preserve duplicate playlist entries.

Do not silently deduplicate imported tracks.

Explicit manual matching decisions are authoritative.

Do not silently replace a manual match with a later automatic result.

Automatic MusicBrainz matching may only override an explicit decision when the user intentionally requests rematching or unlinking.

Keep Lidarr planning separate from Lidarr execution.

A plan should describe explicit intended operations based on known persisted state.

Execution should act on that plan rather than silently recalculating a different plan during mutation.

## External integrations

Relevant integrations include:

* Spotify
* TIDAL
* MusicBrainz
* Lidarr
* OpenSubsonic/Navidrome-compatible servers

External provider implementations belong on the server side.

Keep secrets server-side.

Never expose provider credentials, tokens, private server addresses, or sensitive configuration in:

* browser bundles
* public API responses
* logs
* committed fixtures

Provider adapters should:

* encapsulate transport and authentication details
* validate external responses
* normalize third-party data into Playlarr-owned models
* implement provider-specific retry or error behavior where appropriate

Do not leak raw provider response shapes throughout the application.

Automated tests should use deterministic fixtures, fakes, or mocked external responses.

Do not rely on live external services or personal credentials in normal automated test suites.

## Nx workspace conventions

Nx is the canonical project graph and task runner.

Use pnpm for dependency installation and workspace management.

Use Nx for task orchestration.

Prefer:

```bash
pnpm nx run <project>:<target>
pnpm nx run-many -t <targets>
pnpm nx affected -t <targets>
pnpm nx show project <project>
pnpm nx show projects
pnpm nx graph
pnpm nx graph --affected
```

Prefer inferred targets from official Nx plugins where appropriate.

Keep `nx.json` and project configuration minimal.

Use explicit project targets where plugin inference or package metadata cannot express a genuine project requirement.

Add explicit or implicit project dependencies only where Nx cannot infer a real relationship from imports, package relationships, or configuration.

For example, an E2E project may declare implicit dependencies on applications it starts or exercises when those relationships are not represented through imports.

Deterministic tasks such as:

* lint
* typecheck
* test
* build
* formatting checks
* workflow validation

should remain cacheable when their inputs and outputs can be represented accurately.

Operations with external side effects must not be treated as cacheable.

Do not weaken Nx module-boundary enforcement to make an implementation easier.

## Dependency installation

Use pnpm.

Workspace-wide development tooling:

```bash
pnpm add -w -D <package>
```

Application or library runtime dependencies:

```bash
pnpm --filter <package> add <dependency>
```

Package-specific development tooling:

```bash
pnpm --filter <package> add -D <dependency>
```

Keep Nx plugin versions aligned with the workspace Nx version.

Avoid installing feature runtime dependencies at the workspace root when they belong to one project.

## TypeScript

Keep TypeScript strict.

Do not silence type errors with broad casts, `any`, or `@ts-ignore` when the underlying type can be modeled correctly.

Prefer:

* explicit domain types
* validated external input
* discriminated unions for meaningful states
* exhaustive handling where practical
* narrow interfaces at architectural boundaries

Use explicit `.js` extensions for ESM/NodeNext relative imports where required.

Avoid premature generic infrastructure abstractions.

## Code organization

Organize code around capability ownership and cohesion rather than arbitrary file-size limits.

Keep types and helpers with the narrowest capability that owns them.

Use `index.ts` only as a small public export barrel.

Do not place implementations, unrelated constants, or domain logic in barrel files.

Avoid generic catch-all files such as:

```text
common.ts
helpers.ts
utils.ts
misc.ts
types.ts
```

when they mix unrelated concerns.

Small supporting definitions may remain beside the implementation they exist to support when they have no meaningful independent use.

For React components, use a same-named folder when the component has supporting files such as tests, helper modules, or component-specific types.

### Vertical whitespace and logical boundaries

Use blank lines to separate distinct logical sections within a file, function, component, or JSX tree.

For React components, generally separate:

* state and hook declarations from callbacks and derived values
* callbacks and effects from one another
* setup logic from the component return
* distinct sibling sections in JSX
* guard clauses, mutation setup, execution, and cleanup

Use whitespace to communicate structure rather than mechanically inserting blank lines between every statement.

## Testing

Use:

* Vitest for unit and integration tests
* Testing Library for React behavior
* Playwright for meaningful end-to-end user flows

Test behavior and architectural boundaries rather than framework internals.

Prioritize coverage for:

* domain and business rules
* playlist ordering and duplicates
* MusicBrainz matching
* explicit manual decisions
* persistence
* migrations
* long-running command behavior
* restart recovery
* provider normalization
* external input validation
* authentication and authorization
* error handling
* security-sensitive behavior

Use real temporary SQLite databases for persistence integration tests.

Use deterministic provider fixtures and mocks.

Critical restart-sensitive workflows should be tested through interruption and recovery, not only internal state transitions.

E2E tests should exercise behavior through the public application boundary:

```text
browser/request
  ↓
Next.js origin
  ↓
/api/*
  ↓
NestJS
```

unless a test specifically targets the backend API independently.

Do not weaken, skip, or remove existing tests merely to make a new implementation pass.

## Canonical validation

Use Nx targets rather than package-by-package task orchestration.

Typical repository-wide validation is:

```bash
pnpm nx run-many -t lint,typecheck,test
pnpm nx run @playlarr/web:build
pnpm nx run @playlarr/server:build
pnpm nx run @playlarr/web-e2e:e2e
pnpm nx format:check
```

Use affected validation where appropriate:

```bash
pnpm nx affected -t lint,typecheck,test,build
```

Run workflow validation through the repository's `actionlint` Nx target.

Do not claim validation passed unless the relevant command actually completed successfully.

## General implementation principles

Keep changes focused, reviewable, and easy to reason about.

For non-trivial work:

* inspect the relevant existing code before changing it
* understand current ownership and conventions before introducing abstractions
* prefer extending an existing capability over creating a parallel implementation
* avoid unrelated cleanup, renaming, formatting, or refactoring
* remove obsolete code once its replacement is complete and verified
* preserve unrelated user work
* do not silently change behavior outside the requested scope

Do not add a dependency when the existing stack already provides an appropriate solution.

Do not create libraries just because the intended architecture contains a possible place for them.

Create architectural boundaries when real code makes those boundaries valuable.

## Git workflow

For non-trivial tasks, work on a dedicated branch rather than directly on the default branch.

Before making changes:

1. ensure the working tree is clean
2. fetch the latest remote state
3. start from the latest default branch
4. create a focused branch using an appropriate prefix such as:

```text
feat/
fix/
chore/
```

During implementation:

* follow the repository commit strategy
* keep commits small, logical, and independently reviewable
* do not merge or rebase unrelated work into the task branch
* do not push directly to the default branch

After implementation:

1. run the relevant final validation
2. review the complete branch diff against the default branch
3. push the task branch
4. create a non-draft pull request using `.github/pull_request_template.md`
5. complete the pull request description based on the actual implementation and validation
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
* tests belonging to completed behavior
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

Commit messages must follow the repository's `commitlint.config.ts`.

Use:

```text
<gitmoji> <type>(<optional-scope>): <subject>
```

The complete first line must not exceed 100 characters.

### Types

Allowed types are:

* `feat`
* `fix`
* `chore`
* `test`

### Scopes

When a scope is used, it must be one of:

* `web`
* `server`
* `e2e`
* `ui`
* `database`
* `imports`
* `settings`
* `lidarr`
* `musicbrainz`
* `domain`
* `contracts`
* `persistence`
* `config`
* `repo`

Use the narrowest applicable scope.

The scope may be omitted when no listed scope accurately describes the change.

Do not invent new types or scopes without updating `commitlint.config.ts`.

### Gitmoji

Every commit message begins with a Gitmoji matching the repository parser.

### Subject style

Use sentence case for commit subjects.

Keep subjects concise and use imperative wording where practical.

Describe the resulting change rather than the implementation process.

Do not end the subject with a period.

Examples:

```text
✨ feat(imports): Add Spotify playlist selection
🐛 fix(lidarr): Avoid replaying completed plan items
🗃️ feat(database): Add persisted command state
♻️ chore(server): Extract command processing
✅ test(imports): Add duplicate playlist coverage
👷 chore(repo): Align Nx validation targets
```

`commitlint.config.ts` is authoritative if these instructions and the enforced commit-message rules ever disagree.

## Pull requests

Pull request titles follow the same basic format as commit messages:

```text
<gitmoji> <type>(<optional-scope>): <subject>
```

Use `.github/pull_request_template.md` when creating pull requests.

Complete the template based on the actual implementation and validation performed.

Do not claim tests, builds, compatibility, or manual verification that was not actually performed.
