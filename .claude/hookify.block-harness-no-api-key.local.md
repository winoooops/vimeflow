---
name: block-harness-no-api-key
enabled: true
event: bash
pattern: python3?\s+.*autonomous_agent_demo\.py
action: warn
---

**WARNING: Verify `ANTHROPIC_API_KEY` is set before launching the harness.**

Git worktrees do NOT include untracked files like `.env`. The API keys live in the **original project root**, not in the worktree.

**Source the env file from the source repo root:**

```bash
SOURCE_ROOT=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
set -a && source "$SOURCE_ROOT/.env" && set +a
```

**Verify it's set:**

```bash
echo "ANTHROPIC_API_KEY is ${ANTHROPIC_API_KEY:+set}"
```

Only proceed if it prints "set".

**Why:** Without API keys, the harness dry-run hangs, the pre-bash hook blocks on missing `ANTHROPIC_API_KEY`, and agents waste iterations regenerating `app_spec.md` from scratch. This is especially common in worktrees because `.env` is gitignored and never copied.
