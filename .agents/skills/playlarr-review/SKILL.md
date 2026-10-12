---
name: playlarr-review
description: Review a Playlarr PR, branch, diff, or completed implementation for production merge readiness. Use when asked to review, audit, assess a PR, check a diff, or decide whether Playlarr code is safe to merge; not for implementing a feature or making routine edits.
---

# Playlarr merge-readiness review

Act as a senior staff engineer deciding whether the change is safe to merge. Review the actual diff and relevant surrounding code, not only the PR description or acceptance criteria.

## Establish the review surface

1. Identify the intended base and inspect the complete diff against it.
2. Read the PR description and linked issues when accessible; distinguish required behavior from proposed implementation details.
3. Inspect callers, consumers, persistence schema, lifecycle code, tests, and project configuration needed to evaluate the changed behavior.
4. Check whether generated or unrelated files expanded the scope.

Do not modify code unless the user separately asks for fixes.

## Priorities

Review in this order:

1. Material correctness and user-visible regressions.
2. Races, partial failures, retries, idempotency, and uncertain external effects.
3. Persistence, migration, transaction, and restart-recovery semantics.
4. Startup, shutdown, and long-running command lifecycle.
5. Security, authentication, authorization, validation, secrets, and trust boundaries.
6. Capability ownership, thin application roots, buildability, and Nx dependency boundaries.
7. Meaningful tests for Playlarr-owned risks and whether validation claims match evidence.
8. Performance and maintainability problems with concrete operational impact.
9. Unnecessary abstractions, generated-code smells, duplicated mechanisms, and unrelated scope expansion.

For UI changes, inspect real interaction, accessibility, loading/error behavior, and same-origin API use. For provider work, inspect normalization and leakage of provider shapes or credentials. For playlist and matching work, explicitly protect ordering, duplicates, manual decisions, and Lidarr plan/execution separation.

## Findings

Classify each finding:

- **Blocker**: unsafe to merge; data loss, security exposure, unrecoverable corruption, or fundamentally incorrect behavior.
- **Major**: material production failure or architectural violation that should be fixed before merge.
- **Minor**: bounded correctness or maintainability issue worth fixing but not normally merge-blocking.
- **Nit**: optional polish; use sparingly.

For every material finding, provide:

- a precise file and line reference
- the concrete failure scenario
- the impact
- the smallest reasonable fix

Do not manufacture findings, repeat the same root cause, demand speculative abstractions, or prolong the review with unrelated cleanup. Missing tests are a finding only when they leave a meaningful changed risk unprotected.

## Verdict

Lead with findings ordered by severity. If there are no findings, say so explicitly and mention any material validation gap or residual risk.

Finish with exactly one verdict:

- **Request changes** for any Blocker or Major finding.
- **Approve with minor comments** when only Minor or Nit findings remain.
- **Approve** when no actionable findings remain.
