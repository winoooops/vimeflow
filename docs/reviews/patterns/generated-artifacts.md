---
id: generated-artifacts
category: code-quality
created: 2026-04-14
last_updated: 2026-06-12
ref_count: 3
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

### 5. `generate:bindings` dropped stale-file cleanup, risking stale TypeScript bindings locally

- **Source:** github-claude | PR #440 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `package.json` L28
- **Finding:** The `generate:bindings` npm script was rewritten to skip the previous `npm run clean:bindings` pre-step. CI still cleaned before regeneration, but the canonical local command no longer deleted stale `.ts` files in `src/bindings/`. If a Rust type was renamed or removed, the old binding persisted alongside the new one, making local type-checks and imports appear valid until `git status` or the `bindings-check` CI job caught the stale file.
- **Fix:** Restored the `clean:bindings` script (`mkdir -p src/bindings && find src/bindings -name '*.ts' ! -name 'index.ts' -delete`) and re-added `npm run clean:bindings &&` to the start of `generate:bindings`, preserving the committed `src/bindings/index.ts` re-export.
- **Verification:** `npx prettier --check package.json`; codex verify on the staged diff (findings: [], `overall_correctness`: "patch is correct").
- **Commit:** same commit as this entry
