---
name: block-harness-on-main
enabled: true
event: bash
pattern: python3?\s+.*autonomous_agent_demo\.py
action: block
---

**BLOCKED: Harness must run in a git worktree, not on `main`.**

Before launching the harness, you MUST be on a feature branch inside a git worktree.

**Check your branch:**

```bash
git branch --show-current
```

If it says `main`, STOP and create a worktree first:

```
EnterWorktree(name="harness-<feature-name>")
```

Or manually:

```bash
git worktree add .claude/worktrees/harness-<feature-name> -b feat/<feature-name>
cd .claude/worktrees/harness-<feature-name>
npm install
```

**Why:** The harness creates commits and pushes code. Running on `main` would commit directly to the main branch, violating the project's branch protection policy. Worktree isolation keeps all harness work on a feature branch, ready for PR and squash-merge.
