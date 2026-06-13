---
id: generated-artifacts
category: code-quality
created: 2026-04-14
last_updated: 2026-06-12
ref_count: 5
---

# Generated Artifacts

## Summary

Generated files must be committed in the same shape CI expects. Run the
generator and formatter together so checked-in artifacts do not fail format
checks or leave a regeneration diff.

## Findings

### 1. Generated TypeScript bindings left unformatted

- **Source:** local-codex | feat/agent-status-sidebar | 2026-04-14
- **Severity:** P2
- **File:** `src/bindings/AgentDetectedEvent.ts`
- **Finding:** The generated `src/bindings/*.ts` files had raw ts-rs formatting with trailing whitespace. `npm run format:check` and `git diff --check` failed, and the binding generation job would have left a diff after running Prettier.
- **Fix:** Regenerate bindings through the narrower `cargo test --lib export_bindings -j1` path in this environment, then run `npx prettier --write src/bindings/`.
- **Verification:** `cargo test --lib export_bindings -j1`, `npm run format:check`, `git diff --check`.
- **Commit:** (pending — agent-status-sidebar PR)

---

### 2. ts-rs `cfg_attr(test, ts(optional))` produced misleading `?: number` for `Option<f64>`

- **Source:** github-claude | PR #154 round 1 | 2026-05-04
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/types.rs`
- **Finding:** `CostMetrics.total_cost_usd: Option<f64>` carried `#[cfg_attr(test, ts(optional))]`, which makes ts-rs emit `totalCostUsd?: number` (may be undefined). But serde always serializes `Option::None` as JSON `null` — never as an absent field. So consumers of `bindings/CostMetrics.ts` saw `?: number` while the runtime delivered `null`. A strict-mode check `cost.totalCostUsd === null` was typed as dead code; `=== undefined` was typed correctly but never true at runtime. The hook-level `?? null` and the local `CostMetrics` override in `agent-status/types/index.ts` papered over it, but any consumer importing directly from the binding inherited the wrong type.
- **Fix:** Drop the `cfg_attr(test, ts(optional))` annotation. ts-rs without it emits `totalCostUsd: number | null`, which matches what serde sends. Regenerate bindings via `npm run generate:bindings`. The frontend override in `agent-status/types/index.ts` remains in place for the bigint→number coercion of unrelated fields. The lesson: `ts(optional)` describes "field may be absent in the JSON object"; `Option<T>` without `skip_serializing_if` describes "field is present, value may be null". The two aren't interchangeable. Use `ts(optional)` only when paired with `#[serde(skip_serializing_if = "Option::is_none")]`, or omit it entirely.
- **Commit:** _(see git log for the round-1 fix commit on PR #154)_

---

### 3. Required nullable bindings need serialization tests when `Option<T>` fields stay present

- **Source:** github-claude | PR #263 follow-up review | 2026-05-25
- **Severity:** MEDIUM
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** A review flagged `FileDiff.old_path` / `new_path` as if serde omitted them while the binding declared required nullable fields. Inspection showed the current struct does **not** use `#[serde(skip_serializing_if = "Option::is_none")]`, so serde serializes `None` as `null` and `src/bindings/FileDiff.ts` is correctly `oldPath: string | null` / `newPath: string | null`.
- **Fix:** Kept `ts(optional)` off those fields, added an explicit serialization regression test proving absent rename/copy paths are emitted as JSON `null`, and documented the intentional required-nullable contract next to the Rust fields. Do not add `ts(optional)` unless the serde shape also omits the key.
- **Verification:** `cargo test --manifest-path crates/backend/Cargo.toml git::tests::test_file_diff_serializes_absent_paths_as_null_keys`, `npm run generate:bindings`, `git diff --check`.

### 4. Demo HTML/JSX prototypes should not ship in design-doc PRs

- **Source:** github-human | PR #421 round 3 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `docs/design/leftsidebar/Sidebar Chrome.html`
- **Finding:** The PR included a React/Babel HTML prototype and JSX demo files under `docs/design/` alongside migration markdown. These are hand-authored throwaway demos, not generated artifacts or application code, and add noise to the repository and review surface.
- **Fix:** Removed `docs/design/leftsidebar/Sidebar Chrome.html` and all JSX files under `docs/design/sidebar-toggle-handoff/src/`, keeping the markdown handoff documents.
- **Commit:** same commit as this entry

---

### 5. Ignored generated bindings must still be produced for clean-checkout entrypoints

- **Source:** github-codex-connector | PR #441 round 1 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `.gitignore`
- **Finding:** After adding `/src/bindings/*.ts` to `.gitignore`, a clean checkout contained only the tracked barrel `src/bindings/index.ts`, which re-exports generated modules such as `./PtySession`. Local dev and test scripts (`electron:dev`, `test`, `lint`) did not run `generate:bindings`, so any command that resolved those imports before `build`/`type-check` started from missing modules.
- **Fix:** Prepended `npm run generate:bindings` to the `electron:dev`, `test`, and `lint` npm scripts so the generated modules are produced before TypeScript-aware tooling needs them. This mirrors the existing pattern used by `build` and `type-check`.
- **Commit:** same commit as this entry

---

### 6. Unconditional binding generation in Node-only CI jobs

- **Source:** github-codex-connector | PR #441 round 2 | 2026-06-12
- **Severity:** P1 / HIGH
- **Files:** `package.json`, `.github/workflows/ci-checks.yml`
- **Finding:** After prepending `npm run generate:bindings` to `lint`, `test`, and related npm scripts in round 1, the `code-check` and `unit-test` CI jobs invoked `cargo test` even though they do not install Rust or the system dependencies required by the backend. `--ignore-scripts` does not suppress commands inside an npm script body, so the Node-only jobs failed.
- **Fix:** Added a `generate:bindings:if-missing` script (`scripts/generate-bindings-if-missing.mjs`) that regenerates bindings only when a module referenced by `src/bindings/index.ts` is missing. Routed `lint`, `lint:fix`, `test`, and `test:coverage` through this guard.
- **Verification:** With generated binding files present, `npm run generate:bindings:if-missing` exits without invoking cargo. With files absent, it falls back to `npm run generate:bindings`.

---

### 7. Node-only CI unit-test job could fall back to cargo through the guard script

- **Source:** github-claude | PR #441 round 2 | 2026-06-12
- **Severity:** HIGH
- **Files:** `scripts/generate-bindings-if-missing.mjs`
- **Finding:** The round-2 guard script change made `npm test` fall back to `npm run generate:bindings` when generated binding leaf files are absent. The `unit-test` CI job has no Rust toolchain, so a clean-checkout run would invoke `cargo test` and fail before vitest started.
- **Fix:** Added an early-exit branch in `generate-bindings-if-missing.mjs` that skips on-demand generation when `process.env.CI` is set. This makes the Node-only `unit-test` job run vitest directly without ever invoking cargo, while local checkouts still benefit from the guard.
- **Verification:** With `CI=true` set, `npm run generate:bindings:if-missing` exits without invoking cargo even when binding leaf files are absent.

---

### 8. `spawnSync('npm')` with `shell:false` fails silently on Windows

- **Source:** github-codex-connector | PR #441 round 3 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `scripts/generate-bindings-if-missing.mjs`
- **Finding:** The round-2 guard script calls `spawnSync('npm', ['run', 'generate:bindings'], { shell: false })`. On Windows, the executable for `npm` is normally `npm.cmd`; spawning `npm` without a shell fails to resolve the command when binding files are missing on a clean checkout. Because `result.error` was not surfaced, the failure produced an unhelpful exit with no diagnostic.
- **Fix:** Run the child process through the platform shell on Windows (`shell: process.platform === 'win32'`) and check `result.error` after `spawnSync`, writing `result.error.message` to stderr before exiting with code 1.
- **Verification:** `npm run lint` and `npm run test` still invoke the guard without error on POSIX; the Windows path now uses a shell so `npm.cmd` can be resolved.

---
