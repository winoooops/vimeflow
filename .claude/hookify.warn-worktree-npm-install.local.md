---
name: warn-worktree-npm-install
enabled: true
event: bash
pattern: git\s+worktree\s+add
action: warn
---

**Reminder: Run `npm install` in the new worktree.**

Git worktrees do NOT include `node_modules/` (it's gitignored). After entering the worktree, run:

```bash
npm install
```

Without this, any `npm run` commands, test runs, or build steps will fail with missing dependencies.

Also remember to source `.env` from the source repo root:

```bash
SOURCE_ROOT=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
set -a && source "$SOURCE_ROOT/.env" && set +a
```
