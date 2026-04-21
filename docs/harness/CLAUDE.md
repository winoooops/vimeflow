# Harness — Overview and Links

🇺🇸 English | [🇨🇳 简体中文](./CLAUDE.zh-CN.md)

A short, bilingual landing page that points both humans and agents at the right file for each task. The authoritative runbook lives at [`harness/CLAUDE.md`](../../harness/CLAUDE.md); this doc is an index, not a reference — don't inline anything from the linked pages back here.

## What the harness is

`harness/` is the project's autonomous development loop. A Python coordinator spawns Claude Code sessions, drives them through a three-phase workflow (Initializer → Coder + Reviewer → Cloud Relay), and commits the resulting work to a feature branch. It's the same loop that built the CI/CD, the design system, and the layout shell of this project.

**Default backend**: `claude -p` subprocess per role. The harness inherits your local `claude` CLI login — **no `ANTHROPIC_API_KEY` required on the default path**.

**Fallback backend**: `claude_code_sdk` Python package via `--client sdk`. Requires `ANTHROPIC_API_KEY`. Use only when the CLI is unavailable.

## Quickstart

```bash
# Install the Claude Code CLI (one time) and log in.
# `claude /login` is the in-REPL slash-command; from a shell, use the
# subcommand form:
npm install -g @anthropic-ai/claude-code
claude auth login

# Create a worktree (MANDATORY — harness never runs on main)
git worktree add .claude/worktrees/feat-<name> -b feat/<name>
cd .claude/worktrees/feat-<name>
npm install

# Run a one-iteration dry-run first
cd harness && python3 autonomous_agent_demo.py --max-iterations 1 --skip-review --skip-relay
```

## Where to go next

| You want to…                                            | Read                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the harness, configure it, understand safety layers | [`harness/CLAUDE.md`](../../harness/CLAUDE.md) — authoritative                                                                                                                           |
| Install the plugin (`/harness-plugin:loop` etc.)        | [`README.md`](../../README.md#harness-plugin-setup)                                                                                                                                      |
| Understand the security model rationale                 | [`docs/reviews/patterns/policy-judge-hygiene.md`](../reviews/patterns/policy-judge-hygiene.md), [`docs/reviews/patterns/fail-closed-hooks.md`](../reviews/patterns/fail-closed-hooks.md) |
| See the design spec for the current architecture        | [`docs/superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md`](../superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md)                                                 |
| See the timeline of changes                             | [`CHANGELOG.md`](../../CHANGELOG.md)                                                                                                                                                     |
| Review patterns touching the harness                    | [`docs/reviews/CLAUDE.md`](../reviews/CLAUDE.md)                                                                                                                                         |
| Edit security hooks or allowlist                        | [`harness/security.py`](../../harness/security.py), [`harness/hooks.py`](../../harness/hooks.py), [`harness/policy_judge.py`](../../harness/policy_judge.py)                             |
| Extend the local allowlist without a code change        | Copy [`harness/.policy_allow.local.sample`](../../harness/.policy_allow.local.sample) to `.policy_allow.local`                                                                           |

## For agents editing the harness

Before modifying any file under `harness/`, consult the relevant review pattern(s) below — they encode 12 rounds of lessons from cloud code review on PR #73:

| If you're touching…                       | Read first                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `policy_judge.py`, `security.py`          | [`policy-judge-hygiene.md`](../reviews/patterns/policy-judge-hygiene.md)   |
| `hook_runner.py`, any PreToolUse bridge   | [`fail-closed-hooks.md`](../reviews/patterns/fail-closed-hooks.md)         |
| `cli_client.py`, subprocess I/O           | [`async-race-conditions.md`](../reviews/patterns/async-race-conditions.md) |
| `client.py` hook-command wiring           | [`command-injection.md`](../reviews/patterns/command-injection.md)         |
| `autonomous_agent_demo.py` startup checks | [`preflight-checks.md`](../reviews/patterns/preflight-checks.md)           |

When you learn a new lesson from a review-fix cycle, append a finding to the matching pattern file (or create a new one) and bump its `ref_count` per the convention in [`docs/reviews/CLAUDE.md`](../reviews/CLAUDE.md).

## Directory shape (as of PR #73)

```
harness/
├── autonomous_agent_demo.py    # CLI entry — argparse, asyncio, phase orchestration
├── agent.py                    # Core loop — Coder + Reviewer iterations, cloud relay
├── cli_client.py               # Default backend: claude -p subprocess + stream-JSON parser
├── client.py                   # Shared settings helpers + CLI factory (create_client)
├── sdk_client.py               # Opt-in SDK fallback (create_client mirror)
├── hook_runner.py              # Bridge: CLI settings.json hooks → Python security layer
├── security.py                 # Bash allowlist + pkill/chmod/rm/gh validators
├── hooks.py                    # Feature-list integrity guard
├── policy_judge.py             # Deny-by-default LLM fallback (opt-in ask/explain)
├── review.py                   # Local + cloud Codex review integration
├── prompts.py, progress.py     # Prompt loading + feature-list progress renderer
├── prompts/                    # Agent system prompts (initializer/coding/reviewer)
├── fixtures/                   # Captured stream-JSON for parser tests
├── scripts/dry_run_smoke.py    # End-to-end smoke on a throwaway git repo
└── test_*.py                   # 77 pytest tests covering parser, hooks, policy judge, etc.
```
