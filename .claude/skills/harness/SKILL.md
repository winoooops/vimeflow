---
name: harness
description: Autonomous development harness — build features (/harness:loop), run local Codex review (/harness:review), or fix cloud PR review findings (/harness:github-review)
tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Agent
---

# /harness — Autonomous Development Harness

The harness namespace provides three commands for the VIBM development cycle:

| Command                  | Purpose                                | When to Use                          |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| `/harness:loop`          | Launch the autonomous coder agent loop | Building new features from a spec    |
| `/harness:review`        | Run local Codex code review            | Before creating a PR, quick feedback |
| `/harness:github-review` | Fix cloud Codex PR review findings     | After pushing / creating a PR        |

## Quick Reference

- **Building a feature?** → `/harness:loop`
- **Want a local review before PR?** → `/harness:review`
- **PR has Codex review comments?** → `/harness:github-review`

## Plugin

Sub-skills are provided by the `harness` plugin at `.claude/plugins/harness/`. Load with:

```bash
claude --plugin-dir .claude/plugins/harness
```

Or register in `~/.claude/plugins/installed_plugins.json` for persistent access.

## Worktree Requirement

All harness commands that produce commits **must** run inside a git worktree, never on `main`. See `rules/common/worktrees.md` and `harness/CLAUDE.md` for details.
