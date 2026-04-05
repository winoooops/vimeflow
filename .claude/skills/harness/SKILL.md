---
name: harness
description: Autonomous development harness — build features (/harness:loop), run local Codex review (/harness:review), or fix cloud PR review findings (/harness:github-review)
tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Agent
---

# /harness — Autonomous Development Harness

The harness namespace provides three commands for the VIBM development cycle:

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/harness:loop` | Launch the autonomous coder agent loop | Building new features from a spec |
| `/harness:review` | Run local Codex code review | Before creating a PR, quick feedback |
| `/harness:github-review` | Fix cloud Codex PR review findings | After pushing / creating a PR |

## Quick Reference

- **Building a feature?** → `/harness:loop`
- **Want a local review before PR?** → `/harness:review`
- **PR has Codex review comments?** → `/harness:github-review`

## Sub-Skill Files

Each command's full instructions live in a dedicated file in this directory:

- `loop.md` — Gathers requirements, brainstorms spec, generates `app_spec.md`, launches the agent loop
- `review.md` — Runs `npm run review` locally, parses findings, fixes issues
- `github-review.md` — Fetches cloud Codex review from PR, fixes findings, pushes, polls for next review

When the user invokes a sub-command (e.g., `/harness:loop`), read the corresponding file and follow its instructions.

## Worktree Requirement

All harness commands that produce commits **must** run inside a git worktree, never on `main`. See `rules/common/worktrees.md` and `harness/CLAUDE.md` for details.
