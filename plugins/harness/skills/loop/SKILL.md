---
name: loop
description: Launch the VIBM autonomous development harness — gathers requirements, brainstorms spec, generates app_spec.md, and starts the agent loop
tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Agent
---

# /harness-plugin:loop — Autonomous Development Harness

Launch the VIBM autonomous development harness. Gathers feature requirements, brainstorms the spec, generates `app_spec.md`, and starts the agent loop.

## Step 0: Worktree & Environment (MANDATORY — do this FIRST)

The harness creates commits and pushes code. It **MUST** run inside a git worktree, never on `main`.

### 0a. Create or enter a worktree

Check the current branch:

```bash
git branch --show-current
```

If it says `main`, you MUST create a worktree before proceeding. Use the `EnterWorktree` tool:

```
EnterWorktree(name="harness-<feature-name>")
```

Or create one manually:

```bash
git worktree add .claude/worktrees/harness-<feature-name> -b feat/<feature-name>
cd .claude/worktrees/harness-<feature-name>
npm install
```

**DO NOT skip this step.** If you are already in a non-main branch/worktree, you may proceed.

### 0b. Source `.env` from the source repo

Git worktrees do NOT include untracked files like `.env`. The API keys live in the **original project root**, not in the worktree. Find the source repo root and source from there:

```bash
SOURCE_ROOT=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
set -a && source "$SOURCE_ROOT/.env" && set +a
```

Verify the key is set:

```bash
echo "ANTHROPIC_API_KEY is ${ANTHROPIC_API_KEY:+set}"
```

If it prints "set", proceed. If not, STOP — the harness will fail without API keys.

**Why this matters:** Without this step, the harness dry-run hangs, the pre-bash hook blocks on missing `ANTHROPIC_API_KEY`, and agents waste iterations regenerating `app_spec.md` from scratch.

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

**Pre-flight check:** Confirm you are NOT on `main` and that `ANTHROPIC_API_KEY` is set (both from Step 0). If either is missing, go back to Step 0.

Run the harness using Bash:

```bash
cd harness && pip install -r requirements.txt 2>/dev/null && python autonomous_agent_demo.py --max-iterations <N>
```

Where `<N>` is the iteration count from Step 1. If "Unlimited", omit the `--max-iterations` flag entirely.

Notes:

- On **WSL2 only**, add `--no-sandbox` (the OS-level sandbox is unreliable on WSL2). On macOS/Linux, omit it to keep sandbox isolation enabled.
- The env vars from Step 0b are inherited by the subprocess automatically

**IMPORTANT:** This command will run for a long time. Use `run_in_background: true` on the Bash tool so the user isn't blocked. Tell the user the harness is running and they can check progress with:

- `cat feature_list.json | grep '"passes": true' | wc -l` — count completed features
- `cat claude-progress.txt` — read the latest progress notes
- `git log --oneline -10` — see recent commits from the agent
