# Git Workflow

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Merge Strategy: Squash and Merge Only

All PRs must be **squash merged** into `main`. No merge commits, no rebase-and-merge.

- `main` history stays linear — one commit per PR
- The squash commit message must follow conventional commit format (`feat: ...`, `fix: ...`, etc.)
- Individual branch commits are development noise — they collapse into a single meaningful commit on merge
- When using `gh pr merge`, always pass `--squash`:
  ```bash
  gh pr merge <number> --squash
  ```

## Pull Request Workflow

When creating PRs:

1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch
6. Merge with `--squash` only
7. **Stay on the branch** — do not switch back to `main` after creating the PR

## Branching

- **Never commit to `main`** — always work on a feature branch (`feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `perf/`, `ci/`).
- The **interactive main agent** defaults to a dedicated linked worktree under `worktrees/<slug>/` when starting feature work (`git worktree add worktrees/<slug> -b feat/<name>` or `EnterWorktree`). A dirty primary checkout should not block the work; isolate the feature in a worktree instead.
- The **primary checkout** is used for writing feature work only when the user explicitly asks for it or the task must modify the exact checkout the user has open. Read-only tasks can happen there without a branch.
- **Subagents and Lifeline autonomous runs** (`/lifeline:loop`, dispatched parallel agents) must each isolate themselves in their own dedicated worktree under `worktrees/<slug>/`. See [worktrees.md](./worktrees.md).

## Post-PR Protocol

After creating a PR, the agent remains on the feature branch until the PR is resolved:

1. **Stay**: remain on the feature branch in the same worktree or primary-checkout override — do not return to `main`
2. **Review-fix loop**: run `/lifeline:upsource-review` to fetch and address code review findings
3. **Push fixes**: commit and push from the same branch
4. **Repeat**: wait for next review cycle, fix, push
5. **Done**: only the user merges or closes the PR
6. **Cleanup**: after merge, remove the linked worktree and delete the local branch; for primary-checkout overrides, return to `main` and delete the local branch. In both cases, refresh the primary checkout's `main` from the remote default branch before starting the next branch or worktree. See [worktrees.md](./worktrees.md).

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).

## Multi-Agent Workflows

When multiple agents work simultaneously, every writing agent gets a dedicated git worktree by default, including the interactive main agent. Do not share a worktree across agents unless the user explicitly asks for handoff or integration work in that checkout. See [worktrees.md](./worktrees.md) for lifecycle, lock contention guardrails, and cleanup procedures.
