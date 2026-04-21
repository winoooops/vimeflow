---
name: loop
description: Launch the VIBM autonomous development harness — gathers requirements, brainstorms spec, generates app_spec.md, and starts the agent loop
tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Agent
---

# /harness-plugin:loop — Autonomous Development Harness

Launch the VIBM autonomous development harness. Gathers feature requirements, brainstorms the spec, generates `app_spec.md`, and starts the agent loop.

## Step 0: Branch & Environment (MANDATORY — do this FIRST)

The harness creates commits on behalf of the user. It must never commit to `main`.

### 0a. Put yourself on a feature branch in the primary checkout

Per `rules/common/worktrees.md` §Principles, the **main agent works on a feature branch in the primary checkout** and **does not** enter a worktree. The user runs `npm run tauri:dev` and watches the diff viewer from the primary checkout — edits inside `.claude/worktrees/` are invisible to both.

Check the current branch:

```bash
git branch --show-current
```

- If it says `main`, create and check out a feature branch **in the primary checkout**:
  ```bash
  git checkout -b <branch-name>
  ```
- If you're already on a feature branch, stay put.

**Do NOT call `EnterWorktree`.** The `EnterWorktree` instruction that appeared in earlier revisions of this skill is obsolete — it conflicts with `rules/common/worktrees.md`. Worktrees are only for the harness's per-feature Coder subprocesses (future architecture) and for dispatched parallel subagents, not for the main agent driving this skill.

The harness Python orchestrator itself runs in your primary checkout alongside you, commits land on your current branch, and the `block-main-commit.sh` PreToolUse hook enforces the "no commits on main" guard regardless.

### 0b. Environment sanity

The default `cli` backend inherits your existing `claude` CLI auth, so **no `ANTHROPIC_API_KEY` is needed** for normal runs. Only verify:

1. **Codex CLI authenticated** (required for Phase 2 local review and Phase 3 cloud review):
   ```bash
   test -f ~/.codex/auth.json && echo "codex authed" || echo "run: codex login"
   ```
2. **`gh` CLI authenticated** (required for Phase 3 push + PR):
   ```bash
   gh auth status 2>&1 | head -2
   ```

If either is missing and the user wants the corresponding phase, stop and tell them what to run.

**SDK fallback only:** if the user explicitly asked for `--client sdk` (e.g. custom `ANTHROPIC_BASE_URL`), they need `ANTHROPIC_API_KEY` set — in that case source `.env` from the project root first. Otherwise skip this.

## Step 1: Gather Requirements

Use the `AskUserQuestion` tool to ask the user TWO questions:

**Question 1** — "What feature(s) do you want to build? Describe the functionality, screens, and user flows."

- Header: "Feature"
- Options:
  - "Full VIBM app" — Build the complete conversation manager (all screens, data model, IPC layer)
  - "Specific feature" — Build one feature or module (user will describe in the text input)
- multiSelect: false

**Question 2** — "How many harness iterations should we run?"

- Header: "Iterations"
- Options:
  - "3 (quick test)" — Good for validating the harness works
  - "10 (one session)" — Enough for scaffolding + a few features
  - "Unlimited" — Run until all features are done or you stop it
- multiSelect: false

## Step 2: Brainstorm the Spec

Invoke the `superpowers:brainstorming` skill using the Skill tool:

```
skill: "superpowers:brainstorming"
```

When brainstorming, focus on producing a **product specification** for the harness, NOT an implementation plan. The brainstorming output should cover:

- **Overview** — What the feature/app does in 2-3 sentences
- **Tech Stack** — Tauri 2, React 19 + TypeScript, Rust, Vitest, Testing Library, ESLint, Prettier, CSpell, Storybook
- **Core Features** — Bulleted list of every feature with brief description
- **Data Model** — TypeScript interfaces and matching Rust structs for all entities
- **IPC Commands** — List of `#[tauri::command]` handlers with argument/return types
- **UI Screens** — Description of each screen/view and its components
- **User Flows** — Step-by-step flows for key interactions

**IMPORTANT:** After brainstorming, do NOT invoke `writing-plans`. Instead, proceed to Step 3.

## Step 3: Generate app_spec.md

Take the brainstormed spec and write it to `harness/prompts/app_spec.md` using the Write tool. The file should be a clean markdown document that the harness initializer agent can read to generate a `feature_list.json`.

Structure the file as:

```markdown
# VIBM — App Specification

## Overview

[from brainstorming]

## Tech Stack

- Framework: Tauri 2
- Frontend: React 19 + TypeScript (arrow-function components)
- Backend: Rust (Tauri commands, managed state)
- Testing: Vitest + Testing Library (frontend), cargo test (backend)
- Linting: ESLint flat config, cargo clippy
- Formatting: Prettier, cargo fmt

## Core Features

[from brainstorming — bulleted list]

## Data Model

[from brainstorming — TypeScript interfaces + Rust structs]

## IPC Commands

[from brainstorming — command table with args/returns]

## UI Screens

[from brainstorming — screen descriptions]

## User Flows

[from brainstorming — step-by-step flows]
```

## Step 4: Launch the Harness

**Pre-flight:** confirm current branch is NOT `main` (per Step 0a) and that Codex / `gh` are authenticated if the corresponding phase will run (per Step 0b). If anything is missing, go back to Step 0.

### Launch command — use this exact shape

```bash
cd harness && exec python3 -u autonomous_agent_demo.py --max-iterations <N> --skip-relay
```

- `exec` — replaces the shell wrapper with the Python process so Claude's task runner sees the real PID and output.
- `-u` — unbuffered stdout so the log streams live instead of buffering inside Python.
- `--max-iterations <N>` — the number from Step 1. Omit the flag entirely for "Unlimited".
- `--skip-relay` — **default on**. Phase 3 (push + PR + cloud review) should only run after the user explicitly confirms the Phase 2 feature loop produced acceptable output. Drop the flag only if the user has asked for a fully-autonomous end-to-end run.

Invoke this via the Bash tool with **`run_in_background: true`**. Do **not** wrap with `nohup`, `&`, or any other shell backgrounding — those detach the process from Claude's task runner and you lose the ability to monitor output, which will cost you a retry cycle when something hangs.

### Platform flags

- **WSL2 only:** add `--no-sandbox` (OS-level sandbox is unreliable on WSL2). On macOS/Linux, leave it off.
- **SDK fallback:** if the user asked for `--client sdk`, source `.env` first (see Step 0b) so `ANTHROPIC_API_KEY` is in the inherited environment. The default CLI backend doesn't need this.

### Phase 3 (cloud review) — gated by user confirmation

After Phase 2 completes, **pause and show the user**:

- `jq '[.[] | {id, passes}]' feature_list.json` — feature pass state.
- `git log --oneline <base>..HEAD` — the commits that landed.
- Any uncommitted state from `git status --short`.

Ask: _"Phase 2 complete — run Phase 3 (push branch + open PR + cloud Codex review) now?"_ If yes, relaunch the harness with **`--phase-3 auto`** (NOT just "drop `--skip-relay`" — because `--phase-3` defaults to `confirm` and a `run_in_background: true` relaunch has no tty, so confirm-mode auto-skips Phase 3 and the user's "yes" is silently ignored). Alternative: drive Phase 3 manually with `git push -u origin <branch>` + `gh pr create`.

**Never push without confirmation.** A push is user-visible, a PR open is user-visible, and both are cheap to regret.

### Monitoring while it runs

Tell the user they can check progress with:

- `jq '[.[] | {id, passes}] | .[0:5]' feature_list.json` — feature pass state
- `tail -f harness-run.log` — **only** if the user launched with explicit redirection (`… > harness-run.log 2>&1`). When launched via Claude's `run_in_background: true`, output goes to the task runner's internal buffer, not to a file; use the task runner's own monitoring instead (you'll see streamed output on each check-in).
- `git log --oneline -10` — commits the coder has made
