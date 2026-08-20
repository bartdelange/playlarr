# Contributing

Use Node.js 22+ and a dedicated branch. Preserve user data, ordered duplicates, durable manual
mappings, and Lidarr's approval/revalidation boundary.

```bash
npm ci
pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
npm run dev
npm run worker
```

The App Router lives in `src/app`; Server Components call repositories directly. `src/server/domain`
contains provider-neutral values, `application` owns workflows, `integrations` isolates external
payloads, `persistence` owns schema-v8 SQLite, and `jobs` owns durable background execution. Avoid
internal HTTP calls from Server Components and keep secrets out of browser bundles.

Tests use Vitest under `tests-ts` and Playwright under `e2e`. External services must be mocked.
For normal changes run `npm run validate`; run `npm run test:e2e` for web workflows and build/run the
container for deployment changes.

Commit headers use `<emoji> <type>(<scope>): <lowercase description>`. Do not bypass hooks. Stage
exact files, keep commits coherent, and never commit `.env`, OAuth sessions, SQLite data, reports,
or container mounts.
