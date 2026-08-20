# Repository guidance

## Invariants

- Preserve schema-v8 data compatibility, playlist positions, duplicate occurrences, stable source
  IDs, ISRCs, confirmed manual mappings, revisions, local additions, and job history.
- Lidarr planning is read-only. Mutations require an approved persisted plan, execution-time
  revalidation, per-action audit records, and no automatic replay after interruption.
- Various Artists mutation protection is opt-in per confirmed recording and must not be bypassed.
- Navidrome is read-only.
- Never expose API keys, passwords, OAuth sessions, or SQLite-backed secrets to Client Components,
  rendered errors, or logs.

## Architecture

- `src/app` owns App Router pages, route handlers, Server Actions, Suspense boundaries, and static
  chrome. Use Server Components by default and narrow Client Components for browser state only.
- `src/server/domain` owns provider-independent types and rules.
- `src/server/application` owns acquisition, resolution, library status, planning, and export logic.
- `src/server/integrations` owns Spotify, TIDAL, MusicBrainz, Lidarr, and Navidrome protocols.
- `src/server/persistence` owns forward-only schema-v8 migrations and repositories.
- `src/server/jobs` owns durable SQLite jobs and production handlers. Concurrency remains one unless
  mutation replay safety is redesigned explicitly.
- `src/server/exports` owns M3U8 serialization.

Keep request handlers thin. Domain/application code must not depend on React or Next.js. Do not add
Redis, queues, or another database without a demonstrated need. Use Cache Components only for safe,
non-secret, non-mutation-sensitive data; job progress and Lidarr execution state stay uncached.

## Style and tests

Use explicit, idiomatic strict TypeScript and responsibility-specific modules. Prefer readability
over statement compression: use blank lines between logical phases, name intermediate values, and
split modules or functions by cohesion rather than arbitrary line counts. Avoid catch-all `utils`,
oversized `helpers`, implementation-bearing barrels, broad Client Components, untyped owned data,
circular imports, and one-use frameworks. Prettier owns formatting; ESLint enforces correctness and
maintainability rather than competing stylistic rules.

Unit and integration tests live beside the source they exercise under `src`; browser tests live in
`e2e` and run against the real application with
deterministic fixtures. Make tests visibly show setup, action, and assertion. Prefer semantic
Playwright locators (`getByRole`, `getByLabel`) over CSS selectors. Add regressions for persistence,
matching, execution safety, security, and workflow bugs.

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
docker build -t playlarr .
```

Use a dedicated branch and Conventional Commit header:
`<emoji> <type>(<scope>): <lowercase description>`. Allowed scopes are `config`, `deployment`,
`lidarr`, `musicbrainz`, `persistence`, `playlist`, `repo`, `sources`, and `web`. Stage exact paths,
preserve unrelated user changes and `spike/`, never bypass hooks, and never commit secrets or data.
Run `npm run validate` before committing; run end-to-end and Docker checks when application,
workflow, dependency, or container changes make them relevant.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
