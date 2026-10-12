# Playlarr repository guidance

## Architecture

- Playlarr is a strict-TypeScript Nx monorepo for self-hosted playlist acquisition and library orchestration.
- The production application is one Docker/Unraid container with one public origin.
- The request path is `Next.js -> same-origin /api/* proxy -> NestJS -> capability -> SQLite`.
- `apps/web` and `apps/server` are intentionally thin composition roots. They are not fallback feature locations.
- Next.js owns App Router routes, rendering composition, global frontend integration, and browser-facing framework concerns.
- NestJS owns API transport, backend composition, global configuration, orchestration boundaries, and process lifecycle.
- Substantial feature implementation belongs in `libs/<capability>/*`, even with one application consumer.
- Do not put substantial feature code in `apps/web/src/features`, application controllers, or equivalent application directories to avoid fixing a library boundary.
- Organize capabilities vertically using only the layers containing real code: `contracts`, `domain`, `web`, `server`, and `persistence`.
- Do not create empty or speculative capability layers.
- Feature-specific DTOs, rules, components, controllers, services, entities, repositories, and adapters stay with their owning capability.
- Use `libs/shared/*` only for concerns with multiple genuine consumers. `shared` is not a holding area for unclear ownership.

## Boundaries and communication

- Nx project tags and the module-boundary rules in `eslint.config.mjs` are authoritative.
- Do not bypass a boundary with relative imports, path aliases, application placement, or weakened lint rules.
- Resolve buildability failures at the owning project boundary. Do not move capability code into an app to make a build pass.
- Web code must not import server or persistence implementations.
- Browser requests use relative same-origin `/api/*` URLs. Next.js proxies them to internal NestJS services.
- Centralize server-side Next.js-to-NestJS transport configuration at the application boundary. Capability UI must not assemble internal backend URLs.
- Contracts and domain code remain framework-independent and must not expose ORM entities as API contracts.
- Keep provider credentials, tokens, private addresses, and other secrets server-side and out of logs, responses, fixtures, and browser bundles.

## Persistence and durable work

- SQLite and MikroORM are the production persistence stack.
- `libs/shared/database` owns root ORM configuration, migrations, startup, and genuinely shared database infrastructure only.
- Feature entities and repositories belong to the owning capability persistence library.
- Production startup enables foreign keys, WAL, and a busy timeout, then runs committed migrations before normal operation.
- Use forward migrations and preserve data created by the TypeScript application whenever feasible. Do not use destructive production schema synchronization.
- Use persisted SQLite-backed commands for long-running work that must survive restarts or outlive a request.
- Persisted command state is authoritative. In-process scheduling and SSE may communicate or trigger work but are not authoritative state.
- Recovery must distinguish completed work from work requiring retry, reconciliation, or failure handling. Never blindly replay uncertain external side effects.

## Product invariants

- Preserve playlist ordering and duplicate entries; never silently deduplicate imports.
- Explicit manual matching decisions are authoritative unless the user intentionally rematches or unlinks.
- Keep Lidarr planning separate from execution. Execution acts on the persisted or explicit plan rather than silently recalculating it.
- External provider adapters stay server-side, validate responses, normalize them into Playlarr-owned models, and encapsulate provider-specific transport behavior.

## Runtime conventions

- Use NestJS `Logger` with a meaningful class or subsystem context and log an exception once at the layer owning the operation.
- `ERROR` is for failed authoritative work, unexpected infrastructure failures, or unreachable invariants.
- `WARN` is for abnormal but recoverable or safely ignored failures, never normal control flow.
- `INFO` is for meaningful application, database, integration, and durable-command lifecycle milestones, not per-request or per-item activity.
- `DEBUG` is for diagnostic claims, progress, filtering, retries, reconciliation, and fallbacks.
- Never log secrets, authorization data, cookies, command payloads, or other sensitive values.
- Treat environment variables as a small deployment interface. Add one only when users or deployment environments genuinely need to configure the value.
- Prefer deterministic paths, existing configuration, or application composition for internal implementation details.

## Engineering approach

- Inspect the relevant implementation and existing coverage before changing it.
- Prefer extending the capability that already owns the concern.
- Implement the smallest complete behavior that solves the current requirement.
- Avoid speculative interfaces, wrappers, services, tokens, shared infrastructure, and generic abstractions.
- A capability requiring configuration is complete only when users can configure and operate it; keep UI, validation, backend behavior, and persistence together under its ownership.
- Prefer a small number of strong behavioral tests for Playlarr-owned decisions, failures, concurrency, and recovery.
- Do not add tests mainly to restate acceptance criteria, increase coverage, or prove framework behavior.
- Use real temporary SQLite databases when behavior depends on migrations, transactions, locking, constraints, or repository semantics.
- Use deterministic fixtures and fakes for providers. Normal automated tests must not require live services or personal credentials.
- Preserve unrelated user work and avoid unrelated cleanup, renaming, formatting, or refactoring.
- Remove obsolete code when its replacement is complete.

## Repository skills

Use the focused repository skill matching the task. Codex may select skills implicitly from their descriptions.

- `playlarr-feature`: implementing or changing a capability, its API, or its Nx library ownership.
- `playlarr-frontend`: implementing or changing Playlarr UI or App Router composition.
- `playlarr-persistence`: migrations, repositories, transactions, durable commands, or restart recovery.
- `playlarr-review`: reviewing a PR, branch, diff, or completed implementation for merge readiness.

Reuse the existing Nx skills for workspace exploration, generation, linking, task execution, and CI monitoring. Playlarr-specific skill guidance takes precedence when generic generation defaults conflict with this repository's enforced buildability or ownership rules.

## Tooling and validation

- Use pnpm for dependency management and keep runtime dependencies with the consuming package.
- Use Nx for project inspection and task orchestration. Prefer resolved project configuration over guessing from files.
- Keep TypeScript strict. Model types accurately rather than using broad casts, `any`, `@ts-ignore`, or framework leakage.
- Use Vitest for focused domain, persistence, integration, and security behavior; use Testing Library for React behavior.
- Validate proportionally through existing Nx targets. Typical checks are `pnpm nx affected -t lint,typecheck,test,build`, `pnpm nx format:check`, and the workspace `actionlint` target when workflows change.
- Do not claim a check passed unless that command completed successfully.
- Changes to Docker packaging, native runtime dependencies, container persistence, or supervisor lifecycle require exercising the production image and affected runtime behavior.
- Treat ESLint, TypeScript, Nx, commitlint, and CI configuration as authoritative instead of copying their complete rules into instructions.

## Delivery

- For non-trivial work, start from the latest `master` on a focused `feat/`, `fix/`, or `chore/` branch with a clean tree.
- Keep commits small, logical, independently understandable, and valid whenever practical.
- Commit and PR titles follow the enforced format: `<gitmoji> <type>(<optional-scope>): <subject>`.
- Run relevant final validation, review the complete diff against `master`, push the task branch, and open one non-draft PR using `.github/pull_request_template.md`.
- Keep PR descriptions concise and factual. Report only validation actually performed.
- Do not merge unless explicitly requested.
