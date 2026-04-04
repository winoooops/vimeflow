# Git Worktree Management

## Principles

1. **Main worktree is sacred** — it stays on `main`, always clean, never committed to directly. It is the launchpad from which agents create worktrees.
2. **All code changes happen in worktrees** — any work that produces commits (`feat/`, `fix/`, `refactor/`, `docs/`, `test/`) must use a dedicated worktree.
3. **Read-only tasks skip worktrees** — research, exploration, and answering questions can use the main worktree.
4. **Harness always uses a worktree** — autonomous loops (`/init`) must be fully isolated.
5. **Git commands start with `git`** — always invoke git as the first token in the command (e.g., `git push`, not `ENV=val git push` or `cd repo && git push`). This ensures the PreToolUse hook can reliably detect and guard git operations. This framework is designed for agents, not humans — compound shell expressions are unnecessary.

## Worktree Location

All worktrees live under `.claude/worktrees/` (gitignored, local-only):

```
Vimeflow/                          ← main worktree (stays on main)
├── .claude/
│   ├── skills/                    ← tracked in git (pushed to repo)
│   └── worktrees/                 ← gitignored (local-only)
│       ├── feat-chat-history/     ← agent 1's full checkout
│       └── fix-layout-bug/        ← agent 2's full checkout
├── src/
└── ...
```

Each worktree is a complete working directory with its own `src/`, `node_modules/`, etc. They share only the `.git` object database with the main repo.

## Lifecycle

### CREATE

```bash
# From the main worktree (root project dir)
git worktree add .claude/worktrees/<branch-name> -b <branch-name>
cd .claude/worktrees/<branch-name>
npm install
```

Or use Claude Code's built-in: `EnterWorktree` (creates under `.claude/worktrees/` by default).

### ACTIVE

Agent works normally — edit, commit, push, create PR. The worktree is a fully independent working directory.

**Once a PR is created, the agent stays in the worktree/branch until the PR is resolved.** Do not switch back to `main` between creating the PR and the PR being merged or closed. This ensures review-fix cycles (`/review-fix`) happen in the correct working directory without branch switching.

The PR lifecycle within a worktree:

```
create PR → wait for review → fix findings → push → wait for review → ... → merged/closed
```

Only the **user** decides when a PR is merged. Agents do not merge PRs unless explicitly instructed.

### CLEANUP

After the user merges or closes the PR:

```bash
# From the main worktree
git worktree remove .claude/worktrees/<branch-name>
git branch -d <branch-name>       # delete local branch (use -D if unmerged and abandoned)
git worktree prune                 # clean up stale worktree metadata
```

## Lock Contention Guardrails

Multiple worktrees share one `.git` directory. Concurrent git operations can cause lock contention on `.git/index.lock` or ref locks.

### Prevention

```bash
# Disable auto-gc — prevents surprise garbage collection during parallel work
git config gc.auto 0

# Run gc manually during maintenance windows only (no agents active)
git gc
```

### Safe to Parallelize

These operations use per-worktree state or are read-only — no lock contention:

- `git add`, `git commit` (per-worktree index)
- `git push` (network-bound, different refs)
- `git log`, `git diff`, `git status`, `git branch` (read-only)

### Must Serialize (never run in parallel across worktrees)

These touch shared `.git` state and will cause lock contention:

- `git gc`, `git prune`, `git repack`
- `git fetch` (ref lock contention) — fetch once in the main worktree, all worktrees see the result
- Large rebases that rewrite many refs

### Lock Recovery

If an agent encounters `fatal: Unable to create '.git/index.lock': File exists`:

1. **Wait 2-5 seconds** and retry — another agent may be mid-operation
2. **If lock persists > 30 seconds**, check the PID in the lockfile
3. **Only remove a stale lock** if the owning process is confirmed dead
4. **Never** `rm -f .git/index.lock` blindly

## Auditing Worktrees

### List all worktrees

```bash
git worktree list
```

### Find orphaned worktrees (branch already merged)

```bash
# List merged branches
git branch --merged main

# Cross-reference with active worktrees
git worktree list --porcelain | grep "^branch" | sed 's|branch refs/heads/||'
```

### Staleness indicators

A worktree is likely stale if:

- Its branch has been merged to `main`
- No commits in the last 7 days
- The associated PR is closed/merged

### Cleanup all stale worktrees

```bash
# Remove each stale worktree
git worktree remove .claude/worktrees/<stale-branch>

# After removing worktrees, prune metadata
git worktree prune

# Delete merged local branches
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d
```

## Hook Enforcement

Two hooks support the worktree workflow:

| Hook               | Type        | Script                               | Purpose                                                             |
| ------------------ | ----------- | ------------------------------------ | ------------------------------------------------------------------- |
| Block main commits | PreToolUse  | `scripts/hooks/block-main-commit.sh` | Prevents `git commit`/`git push` on the main worktree               |
| Post-push review   | PostToolUse | `scripts/hooks/post-push-review.sh`  | After `git push`, reminds agent to wait ~90s then run `/review-fix` |

To register both hooks, add to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/block-main-commit.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash scripts/hooks/post-push-review.sh"
          }
        ]
      }
    ]
  }
}
```

## Integration

- [git-workflow.md](./git-workflow.md) — commit format, PR process
- [development-workflow.md](./development-workflow.md) — full pipeline before git operations
- [agents.md](./agents.md) — parallel agent orchestration
