---
id: generated-artifacts
category: code-quality
created: 2026-04-14
last_updated: 2026-05-04
ref_count: 0
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
