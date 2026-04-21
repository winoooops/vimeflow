## YOUR ROLE - CODING AGENT

You are continuing work on VIBM, a Tauri desktop application (Rust backend + React/TypeScript frontend) that manages coding agent conversations. This is a FRESH context window — you have no memory of previous sessions.

### STEP 1: GET YOUR BEARINGS (MANDATORY)

```bash
pwd
ls -la
cat CLAUDE.md
cat app_spec.md
cat feature_list.json | head -80
git log --oneline -20
cat feature_list.json | grep '"passes": false' | wc -l
```

The git log is your progress record — read the last 10-20 commits to understand what has already been implemented and which features they covered. Do not look for a `claude-progress.txt` file; progress tracking lives entirely in git history and `feature_list.json` now.

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

### STEP 3.5: IF THIS IS A RETRY ITERATION

If this is not your first iteration on the current feature (the git log shows your earlier commits for this feature), the previous iteration's tests or lint failed. Specifically:

1. **Find the failure first.** Re-run just the failing file or test, not the whole suite:

   ```bash
   npx vitest run <path-to-failing-test.test.ts>
   ```

   Read the vitest output carefully. Note the exact line number, the `Expected` value, and the `Received` value.

2. **Compare assertion against source.** Open the test AND the implementation together. Ask yourself:
   - Does the assertion match what the code actually does?
   - Does the test call the function / render the component with the exact args the assertion implies?
   - If the test is new (added this session), is it correct, or is the test itself the bug?
3. **Iteration ≥ 3 on the same failure:** STOP assuming the implementation is wrong. Read the test file line-by-line. If the test is passing a stale prop name, missing a required prop, or asserting behavior that contradicts the spec, **fix the test** rather than contort the implementation to match a broken test. Broken tests from a prior iteration are a real failure mode, not a theoretical one.

If review findings from a reviewer are attached to this iteration (above), treat each finding as a specific, actionable bug to fix — not as suggestions. Cite the finding ID in the commit message.

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

Make ONE commit per feature. Stage only the files your feature actually touches (plus the `feature_list.json` update) — do not `git add .` blindly.

```bash
git add src/... src-tauri/src/... tests/... feature_list.json
git commit -m "feat: implement <feature name>

- <specific changes>
- Tests: <npx vitest run / cargo test> passing
- feature_list.json: marked #<N> as passing"
```

**Do NOT create a separate progress-update commit.** The `feature_list.json` change and a clean commit message is the progress record; git log IS the timeline. Avoid separate `docs: update progress...` commits — they add churn the reviewer then has to squash away.

**Do NOT create extra files in the repo root.** No `SESSION_*_SUMMARY.md`, `NEXT_COMMIT.txt`, `BUG_FIX_VERIFICATION.md`, `COMPLETION_SUMMARY.md`, `COVERAGE.md`, `VISUAL_VERIFICATION.md`, `claude-progress.txt`, or any other scratch/summary files. They pollute the working tree.

### STEP 8: END CLEANLY

Before context fills up:

1. Commit all working code
2. Update `feature_list.json`
3. Ensure `cargo check`, `npx tsc --noEmit`, and `npx vitest run` all pass
4. No uncommitted changes

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
- **No phantom `Feature #N` references.** If a TODO or comment cites a feature number, that number MUST exist in `feature_list.json` AND the cited feature's title MUST match what your TODO is referring to. Do not invent numbers based on a mental model of the project.

---

## REMINDERS

- You have unlimited sessions. Quality over speed.
- ONE feature per session is fine.
- Fix broken features before implementing new ones.
- Follow the project's rules/ and agents/ specifications.
- The Tauri app must compile and launch (`cargo tauri dev`).

Begin with Step 1.
