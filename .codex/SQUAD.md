# Playlarr Codex squad

The main Codex session is the squad lead. Native configured agents provide implementation, independent behavioral testing, and two review perspectives. Repository `AGENTS.md` remains authoritative; this file only defines orchestration.

## Start a PBI

From a clean checkout at current `master`, start Codex with:

```text
codex -C /absolute/path/to/playlarr --search "Implement GitHub issue #<number> using the Playlarr squad workflow in .codex/SQUAD.md. Read the issue and linked requirements, establish the behavioral contract, create isolated developer and tester worktrees, delegate implementation and independent tests, integrate and validate, run independent review, and open one non-draft PR. Never merge."
```

The lead should stop before mutation if the current tree is dirty or GitHub authentication cannot read the issue and later create the PR.

## Worktrees and branches

Use an issue-specific slug and explicit paths outside every existing checkout. The lead owns all Git and integration operations; agents receive an already-created worktree as their working directory.

```text
BASE=master
INTEGRATION=feat/<issue>-<slug>
DEVELOPER=feat/<issue>-<slug>-dev
TESTER=feat/<issue>-<slug>-behavior-tests

git fetch origin
git worktree add -b "$INTEGRATION" <integration-path> "origin/$BASE"
git worktree add -b "$DEVELOPER" <developer-path> "$INTEGRATION"
git worktree add -b "$TESTER" <tester-path> "$INTEGRATION"
```

Before creation, inspect `git status --short`, `git worktree list --porcelain`, and branch existence. Never reuse a path or branch with unknown work. Native `codex --worktree` can create a managed isolated worktree for a session, but explicit Git worktrees are preferred here because the lead needs stable developer, tester, and integration branch names for commit-based integration.

The developer commits implementation and developer-level tests on the developer branch. The tester commits independent behavioral tests on the tester branch. They never write the same worktree. The lead integrates coherent commits into the integration branch with `git cherry-pick <sha>` (or an intentional merge when commit topology matters), resolves conflicts against the behavioral contract, and records any integration-only edits as separate commits. Tests may initially fail on the tester branch because production code is absent; authoritative validation happens after both contributions are integrated.

## Contract, validation, and review

The lead records a concise contract in the task conversation: observable inputs/outputs, state transitions and invariants, failure/recovery behavior, acceptance-criterion mapping, and unresolved assumptions. Developer and tester receive the same contract but separate assignments.

After integration, reconcile the diff with the PBI and run the smallest relevant resolved Nx targets, expanding when risk warrants it. Typical final checks are `pnpm nx affected -t lint,typecheck,test,build`, `pnpm nx format:check`, relevant Playwright targets, and `actionlint` when workflows change. Report only completed checks.

Run `senior-reviewer` against the actual integrated diff. Invoke `junior-reviewer` for substantial cross-capability changes, persistence/concurrency/lifecycle risk, or whenever a second view materially reduces risk. Confirm findings against code and contract. Delegate corrections to the developer (and test corrections to the tester when appropriate), reintegrate, revalidate, and re-review the resulting diff. Stop and ask the user after two correction rounds if material findings remain.

## One PR, never merge

Only the lead pushes the integration branch and creates or updates one non-draft PR targeting the PBI's base branch. Developer and tester branches do not get PRs.

```text
git push -u origin "$INTEGRATION"
gh pr create --base "$BASE" --head "$INTEGRATION" --title "<gitmoji> <type>(<scope>): <subject>" --body-file <completed-template>
```

Use `.github/pull_request_template.md`, keep claims factual, include validation actually run, and update the same PR after corrections. Never run `gh pr merge`.
