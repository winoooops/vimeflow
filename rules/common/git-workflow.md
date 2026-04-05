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

## Post-PR Protocol

After creating a PR, the agent remains on the feature branch/worktree until the PR is resolved:

1. **Stay**: remain in the worktree/branch — do not return to `main`
2. **Review-fix loop**: run `/harness-plugin:github-review` to fetch and address code review findings
3. **Push fixes**: commit and push from the same branch
4. **Repeat**: wait for next review cycle, fix, push
5. **Done**: only the user merges or closes the PR
6. **Cleanup**: after merge, return to main and clean up the worktree/branch (see [worktrees.md](./worktrees.md))

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).

## Multi-Agent Workflows

When multiple agents work simultaneously, each must use a dedicated git worktree. See [worktrees.md](./worktrees.md) for lifecycle, lock contention guardrails, and cleanup procedures.
