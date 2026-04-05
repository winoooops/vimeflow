---
name: harness:loop
description: Launch the VIBM autonomous development harness — gathers requirements, brainstorms spec, generates app_spec.md, and starts the agent loop
tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Agent
---

# /harness:loop — Autonomous Development Harness

Launch the VIBM autonomous development harness. Gathers feature requirements, brainstorms the spec, generates `app_spec.md`, and starts the agent loop.

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

Run the harness using Bash:

```bash
cd harness && pip install -r requirements.txt 2>/dev/null && python autonomous_agent_demo.py --max-iterations <N>
```

Where `<N>` is the iteration count from Step 1. If "Unlimited", omit the `--max-iterations` flag entirely.

**IMPORTANT:** This command will run for a long time. Use `run_in_background: true` on the Bash tool so the user isn't blocked. Tell the user the harness is running and they can check progress with:

- `cat feature_list.json | grep '"passes": true' | wc -l` — count completed features
- `cat claude-progress.txt` — read the latest progress notes
- `git log --oneline -10` — see recent commits from the agent
