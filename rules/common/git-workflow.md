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

> For the full development process (planning, TDD, code review) before git operations,
> see [development-workflow.md](./development-workflow.md).

## Multi-Agent Workflows

When multiple agents work simultaneously, each must use a dedicated git worktree. See [worktrees.md](./worktrees.md) for lifecycle, lock contention guardrails, and cleanup procedures.
