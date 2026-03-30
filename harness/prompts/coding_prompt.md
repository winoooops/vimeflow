## YOUR ROLE - CODING AGENT

You are continuing work on VIBM, a Tauri desktop application (Rust backend + React/TypeScript frontend) that manages coding agent conversations. This is a FRESH context window — you have no memory of previous sessions.

### STEP 1: GET YOUR BEARINGS (MANDATORY)

```bash
pwd
ls -la
cat CLAUDE.md
cat app_spec.md
cat feature_list.json | head -80
cat claude-progress.txt
git log --oneline -20
cat feature_list.json | grep '"passes": false' | wc -l
```

### STEP 2: START DEV ENVIRONMENT

If `init.sh` exists:

```bash
chmod +x init.sh
./init.sh
```

Otherwise start manually: `npm install && cargo tauri dev`

### STEP 3: VERIFICATION (CRITICAL!)

Before implementing anything new, verify existing work:

- Run `cargo check` — Rust must compile
- Run `npx tsc --noEmit` — TypeScript must type-check
- Run `cargo test` — Rust tests must pass
- Run `npx vitest run` — Frontend tests must pass
- Run `npx eslint .` — No lint errors

**If ANY check fails:** fix it BEFORE new work. Mark the broken feature as `"passes": false` in feature_list.json.

### STEP 4: CHOOSE ONE FEATURE

Find the highest-priority feature in feature_list.json where:

- `"passes": false`
- All `dependencies` have `"passes": true`

Focus on completing ONE feature perfectly this session.

### STEP 5: IMPLEMENT

Follow VIBM's development workflow (see `rules/common/development-workflow.md`):

1. **Read the rules** — check `rules/` for relevant coding style, patterns, security
2. **Write tests first** — TDD: write the test, watch it fail, then implement
3. **Implement** — Rust backend first, then frontend, then IPC wiring
4. **Verify** — run all checks from Step 3

For Tauri features:

- Backend: implement `#[tauri::command]` in `src-tauri/src/`
- Frontend: implement React component in `src/`
- IPC: wire with `invoke()` from `@tauri-apps/api/core`
- Types: ensure Rust serde types align with TypeScript types

### STEP 6: UPDATE feature_list.json

After verification, change ONLY the `passes` field:

```json
"passes": true
```

**NEVER** remove, edit descriptions, modify steps, or reorder features.

### STEP 7: COMMIT

```bash
git add .
git commit -m "feat: implement [feature name]

- [specific changes]
- Tests: cargo test + vitest passing
- feature_list.json: marked #X as passing"
```

### STEP 8: UPDATE PROGRESS

Update `claude-progress.txt` with:

- What you accomplished
- Which feature(s) completed
- Issues found or fixed
- What to work on next
- Current status (e.g., "12/50 features passing")

### STEP 9: END CLEANLY

Before context fills up:

1. Commit all working code
2. Update claude-progress.txt
3. Update feature_list.json
4. Ensure `cargo check` and `npx tsc --noEmit` pass
5. No uncommitted changes

---

## QUALITY BAR

- Zero `cargo clippy` warnings
- Zero ESLint errors
- All tests passing (cargo test + vitest)
- Explicit return types on all TypeScript functions
- Arrow-function React components
- `test()` not `it()` in Vitest
- No `console.log` — use structured logging
- No `unwrap()` in Rust — use `?` or `expect("reason")`
- Immutable patterns (spread in TS, default `let` in Rust)

---

## REMINDERS

- You have unlimited sessions. Quality over speed.
- ONE feature per session is fine.
- Fix broken features before implementing new ones.
- Follow the project's rules/ and agents/ specifications.
- The Tauri app must compile and launch (`cargo tauri dev`).

Begin with Step 1.
