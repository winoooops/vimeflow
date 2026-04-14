---
id: generated-artifacts
category: code-quality
created: 2026-04-14
last_updated: 2026-04-14
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
