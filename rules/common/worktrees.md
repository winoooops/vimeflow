# Git Worktree Management

## Principles

1. **`main` branch is sacred** — never commit directly to `main`. The primary checkout is allowed (and expected) to be on a feature branch during active work.
2. **Main agent works on a feature branch in the primary checkout** — the interactive Claude Code agent checks out `feat/<name>` (or `fix/`, `refactor/`, etc.) in the primary checkout and commits there. It does **not** create a worktree for itself.
   - **Why:** the user runs the Vimeflow app from the primary checkout and watches the diff viewer live. Edits inside `.claude/worktrees/` are invisible to that view because the diff viewer only reflects its own cwd's working tree.
3. **Subagents and harness always use a worktree** — any autonomous or parallel agent (`/harness-plugin:loop`, dispatched parallel agents) must be fully isolated under `.claude/worktrees/<branch>/` so it does not fight the user or the main agent for the working tree.
4. **Read-only tasks skip branching** — research, exploration, and answering questions can happen on `main` in the primary checkout. No branch needed.
5. **Git commands start with `git`** — always invoke git as the first token in the command (e.g., `git push`, not `ENV=val git push` or `cd repo && git push`). This ensures the PreToolUse hook can reliably detect and guard git operations. This framework is designed for agents, not humans — compound shell expressions are unnecessary.

## Who Works Where

| Actor                               | Location                      | Branch                        |
| ----------------------------------- | ----------------------------- | ----------------------------- |
| Interactive main agent              | Primary checkout (repo root)  | Feature branch (never `main`) |
| `/harness-plugin:loop` (autonomous) | `.claude/worktrees/<branch>/` | Feature branch                |
| Dispatched parallel subagents       | `.claude/worktrees/<branch>/` | Feature branch                |
| Read-only research                  | Primary checkout              | `main` is fine                |

## Worktree Location

All subagent/harness worktrees live under `.claude/worktrees/` (gitignored, local-only):

```
Vimeflow/                          ← primary checkout (main agent works here on feat/* branch)
├── .claude/
│   ├── skills/                    ← tracked in git (pushed to repo)
│   └── worktrees/                 ← gitignored (local-only)
│       ├── feat-harness-retry/    ← harness loop's full checkout
│       └── refactor-parallel-a/   ← dispatched subagent's full checkout
├── src/
└── ...
```

Each worktree is a complete working directory with its own `src/`, `node_modules/`, etc. They share only the `.git` object database with the primary checkout.

## Lifecycle

### Main agent (interactive) — feature branch in primary checkout

```bash
# From the primary checkout, starting on main
git checkout -b feat/<name>
# edit, commit, push, create PR — all from the primary checkout
```

Do **not** run `EnterWorktree` reflexively at the start of an interactive task. Check out a feature branch instead so the user's diff viewer reflects your live edits.

### Subagent / harness — dedicated worktree

```bash
# From the primary checkout
git worktree add .claude/worktrees/<branch-name> -b <branch-name>
cd .claude/worktrees/<branch-name>
npm install
```

Or use Claude Code's built-in: `EnterWorktree` (creates under `.claude/worktrees/` by default). This path applies to `/harness-plugin:loop` and any parallel dispatched agents.

### ACTIVE

Agent works normally — edit, commit, push, create PR. Whether this happens in the primary checkout (main agent) or a linked worktree (subagent), the PR lifecycle is the same.

**Once a PR is created, the agent stays on that branch (or in that worktree) until the PR is resolved.** Do not switch back to `main` between creating the PR and the PR being merged or closed. This ensures review-fix cycles (`/harness-plugin:github-review`) happen in the correct working directory without branch switching.

The PR lifecycle within a worktree:

```
create PR → wait for review → fix findings → push → wait for review → ... → merged/closed
```

Only the **user** decides when a PR is merged. Agents do not merge PRs unless explicitly instructed.

### CLEANUP

After the user merges or closes the PR:

**Main agent (feature branch in primary checkout):**

```bash
git checkout main
git pull
git branch -D <branch-name>       # squash-merge: -D is always required; -d would fail
```

**Subagent / harness (linked worktree):**

```bash
# From the primary checkout
git worktree remove .claude/worktrees/<branch-name>
git branch -D <branch-name>       # squash-merge: -D is always required; -d would fail
git worktree prune                 # clean up stale worktree metadata
```

> **Why `-D` not `-d`:** Because this repo mandates squash-and-merge, the feature branch's individual commits never become ancestors of `main` — only the single squash commit does. `git branch -d` refuses to delete a branch it considers "not fully merged" and will fail on every normal cleanup. Use `-D` unconditionally.

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

| Hook               | Type        | Script                               | Purpose                                                                               |
| ------------------ | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Block main commits | PreToolUse  | `scripts/hooks/block-main-commit.sh` | Prevents `git commit`/`git push` when the `main` branch is checked out (any worktree) |
| Post-push review   | PostToolUse | `scripts/hooks/post-push-review.sh`  | After `git push` or `gh pr create`, triggers `/harness-plugin:github-review`          |

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
