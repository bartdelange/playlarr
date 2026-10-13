---
name: playlarr-persistence
description: Change Playlarr database entities, repositories, MikroORM migrations, SQLite transactions, durable commands, retry state, or restart recovery. Use for persistence and concurrency work, including migration additions and durable-command race fixes; not for ordinary stateless API calls or UI-only changes.
---

# Playlarr persistence and recovery

Keep authoritative state correct across failures, concurrency, and process restarts using Playlarr's SQLite and MikroORM stack.

## Put data with its owner

- Feature entities and repositories belong in `libs/<capability>/persistence`.
- `libs/shared/database` owns root MikroORM/SQLite configuration, migration infrastructure, database startup, and only genuinely shared database mechanics.
- Do not move feature persistence into `shared/database` because it uses SQLite.
- Keep ORM entities internal to persistence; expose domain models or contracts across other boundaries.
- Avoid repository interfaces, generic units of work, storage wrappers, or injectable tokens that have only one concrete use and no architectural boundary to protect.

## Migrations and SQLite

- Add committed forward migrations for schema changes and preserve data created by the TypeScript application whenever feasible.
- Write migrations so they remain stable independently of the current entity implementation.
- Do not use destructive production schema synchronization.
- Preserve startup ordering: enable foreign keys, WAL, and busy timeout; run pending migrations before normal application work.
- Consider SQLite transaction modes, lock duration, uniqueness and foreign-key constraints, busy handling, and the exact atomic boundary when correctness depends on them.
- Use database constraints for authoritative invariants where appropriate, with application handling for expected constraint failures.

## Durable commands

Use durable commands only for work that must survive a restart, continue independently of an HTTP request, or expose meaningful persisted progress.

- Persist command state, progress needed for recovery, retry metadata, and failure information accurately.
- Make claims and state transitions atomic with the authoritative data they protect.
- On startup, distinguish completed work, safe retry, reconciliation, and terminal failure.
- Do not blindly repeat an external side effect when the previous attempt's outcome is uncertain. Reconcile first or represent the uncertainty explicitly.
- Keep planning separate from execution when external mutations depend on a plan.
- SSE or in-memory events may announce changes but cannot be the only record of state.
- Ensure shutdown stops new claims and handles in-flight work according to the persisted recovery contract.

## Test the risks that matter

Use real temporary SQLite databases for repository behavior, migrations, transactions, locking, constraints, and restart recovery. Do not replace SQLite semantics with mocks.

Prefer a few adversarial tests that would catch concrete Playlarr failures, such as:

- concurrent workers claiming the same command
- interruption between an external effect and local state transition
- retry metadata or progress lost on restart
- partial migration failure
- stale running work reconciled incorrectly
- ordering or duplicates lost during persistence

Use controlled promises, explicit transaction barriers, fakes, and fake timers instead of sleeps. Avoid exhaustive state matrices that merely restate implementation details.

Before finishing, inspect the full transition path and identify which persisted fact makes each retry or recovery decision safe. Run affected Nx targets and any relevant application startup or integration validation.
