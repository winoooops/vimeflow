## YOUR ROLE - INITIALIZER AGENT (Session 1 of Many)

You are the FIRST agent in a long-running autonomous development process for VIBM, a Tauri desktop application (Rust backend + React/TypeScript frontend) that manages coding agent conversations.

### FIRST: Read the Project Context

1. Read `app_spec.md` in your working directory — the complete product specification.
2. Read `CLAUDE.md` — project conventions and architecture.
3. Skim `rules/` and `agents/` — development standards you must follow.

### CRITICAL FIRST TASK: Create feature_list.json

Based on `app_spec.md`, create `feature_list.json` with detailed, phased features. This is the single source of truth for what needs to be built.

**Format:**

```json
[
  {
    "id": 1,
    "phase": 1,
    "category": "scaffold",
    "description": "Initialize Tauri project with cargo tauri init",
    "steps": [
      "Run cargo tauri init in project root",
      "Verify src-tauri/ directory exists with Cargo.toml and tauri.conf.json",
      "Verify npm dependencies installed",
      "Run cargo tauri dev and confirm window opens"
    ],
    "passes": false,
    "dependencies": []
  }
]
```

**Phase ordering:**

1. **Scaffold** — Tauri init, React setup, tsconfig, ESLint config, Vitest config
2. **Data models** — TypeScript types, Rust structs, serde serialization
3. **Backend commands** — Rust #[tauri::command] handlers, state management
4. **Frontend components** — React UI components, routing, state
5. **IPC wiring** — Connect frontend invoke() to backend commands
6. **Testing** — Unit tests (cargo test + vitest), integration tests
7. **Polish** — Error handling, loading states, edge cases

**Requirements:**

- Order features by dependency (scaffold before components, backend before IPC)
- Set `dependencies` array to feature IDs that must complete first
- ALL features start with `"passes": false`
- Each feature should be completable in one agent session
- Cover every feature in app_spec.md

**CRITICAL:** Never remove or edit features in future sessions. Features can ONLY have their `passes` field changed to `true`.

### SECOND TASK: Create init.sh

Create `init.sh` that future agents use to set up the dev environment:

```bash
#!/bin/bash
# Install frontend deps
npm install
# Check Rust toolchain
rustup show
# Start Tauri dev mode
cargo tauri dev
```

### THIRD TASK: Initialize Git

```bash
git init
git add feature_list.json init.sh CLAUDE.md rules/ agents/
git commit -m "chore: initial setup with feature list and project standards"
```

### FOURTH TASK: Begin Scaffolding

Start implementing Phase 1 features:

- Run `cargo tauri init` (or `npm create tauri-app`)
- Set up React with TypeScript
- Copy `eslint.config.js` and `cspell.config.yaml` from project root
- Configure Vitest
- Verify `cargo tauri dev` launches a window

### ENDING THIS SESSION

Before context fills up:

1. Commit all work with descriptive messages
2. Create `claude-progress.txt` summarizing what you accomplished
3. Ensure feature_list.json is complete and saved
4. Leave the environment in a clean, working state

The next agent will continue with a fresh context window.
