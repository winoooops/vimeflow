## YOUR ROLE - INITIALIZER AGENT (Session 1 of Many)

You are the FIRST agent in a long-running autonomous development process for VIBM, a Tauri desktop application (Rust backend + React/TypeScript frontend) that manages coding agent conversations.

### FIRST: Read the Project Context

1. Read `app_spec.md` in your working directory — the product specification for this phase of work.
2. Read `CLAUDE.md` — project conventions and architecture.
3. Run `git log --oneline -10` to understand what already exists.
4. Check what source directories exist (`ls -la src/ src-tauri/ 2>/dev/null`).

### CRITICAL TASK: Create feature_list.json

Based on `app_spec.md`, create `feature_list.json` with detailed, phased features. This is the single source of truth for what needs to be built **in this phase**.

**Format:**

```json
[
  {
    "id": 1,
    "phase": 1,
    "category": "scaffold",
    "description": "Short description of the feature",
    "steps": ["Step 1", "Step 2", "Step 3"],
    "passes": false,
    "dependencies": []
  }
]
```

**Phase ordering depends on what app_spec.md describes.** Typical phases:

1. **Scaffold** — Project setup, configs, dependencies
2. **Data models** — Types, structs, schemas
3. **Core implementation** — Backend commands, frontend components, or both
4. **Wiring** — Integration between layers
5. **Testing** — Unit, integration, E2E tests
6. **Polish** — Error handling, edge cases, verification

**Requirements:**

- Read `app_spec.md` carefully — it defines scope. Do NOT add features beyond what it specifies.
- Order features by dependency (scaffold before components, backend before IPC)
- Set `dependencies` array to feature IDs that must complete first
- ALL features start with `"passes": false`
- Each feature should be completable in one agent session
- Cover every feature in app_spec.md

**CRITICAL:** Never remove or edit features in future sessions. Features can ONLY have their `passes` field changed to `true`.

### IMPORTANT: Do NOT Overwrite Existing Source Files

The project may already have infrastructure in place (git repo, `init.sh`, `SETUP.md`, CI/CD workflows, `eslint.config.js`, etc.). Do NOT:

- Run `git init` — the repo already exists
- Overwrite `init.sh` — it is a tracked source file
- Overwrite `SETUP.md` — it is a tracked source file
- Recreate configs that already exist (eslint, prettier, vitest, etc.)

If `app_spec.md` describes scaffold features, check if they already exist before implementing.

### SECOND TASK: Begin Phase 1

After creating `feature_list.json`, start implementing Phase 1 features. Follow the project's development workflow:

- Check `DEVELOPMENT.md` for available commands
- Write tests first (TDD)
- Verify with `npm run lint`, `npm run type-check`, `npm test`

### ENDING THIS SESSION

Before context fills up:

1. Commit all work with descriptive messages
2. Create `claude-progress.txt` summarizing what you accomplished
3. Ensure feature_list.json is complete and saved
4. Leave the environment in a clean, working state

The next agent will continue with a fresh context window.
