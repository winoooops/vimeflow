---
id: guard-branch-correctness
category: correctness
created: 2026-06-11
last_updated: 2026-06-26
ref_count: 0
---

# Guard Branch Correctness

## Summary

A conditional guard that does not change the outcome between its branches is dead code and a correctness trap: it signals to readers that the condition matters, but the value produced is identical either way. Worse, the "safe" branch is often intended to provide a fallback (sentinel value, error path, or sanitized output), so the no-op branch silently lets invalid inputs propagate instead of handling them. When the guarded value crosses an external boundary — a URL, a command argument, a file path, or an API payload — the result is typically a runtime failure or misleading output rather than a compile error.

Review every branch whose two arms return the same expression. Either remove the guard if the distinction is truly unnecessary, or make the fallback branch do the work the condition implies (return a sentinel, throw, route to an error handler, etc.). Add a regression test that exercises the previously-unhandled input.

## Findings

### 1. KNOWN_SHELLS guard returns the same value for unknown shells

- **Source:** github-claude | PR #421 round 3 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/AgentStatusCard.tsx` L81-85
- **Finding:** `normalizeShellName` branched on `KNOWN_SHELLS.has(stripped)` but both the `true` and `false` arms returned `stripped`. Unknown shells such as `nushell` or a company wrapper were passed directly to `shellCheatsheetUrl`, producing a `https://cheat.sh/<name>` link for a topic cheat.sh does not populate.
- **Fix:** Changed the fallback arm to return the `'shell'` sentinel, which `CHEATSHEET_TOPIC` maps to the populated POSIX `sh` cheatsheet topic. Added a regression test for an unknown shell path.
- **Commit:** same commit as this entry

### 2. Workspace-source auto-shrink guard implicitly includes zero panes

- **Source:** github-claude | PR #546 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/terminal/layout-registry/layoutRegistry.ts` L77-82
- **Finding:** `autoShrinkLayoutFor` returned the current custom layout for every `nextPaneCount <= current.capacity`, including `0`. The builtin `nextPaneCount <= 1 -> 'single'` guard ran only after the workspace early-return, so a caller relying on `autoShrinkLayoutFor(0, 'custom:X')` returning `'single'` would silently get the custom id instead.
- **Fix:** Changed the workspace early-return condition to `nextPaneCount >= 1 && nextPaneCount <= current.capacity` so the zero-pane case falls through to `'single'` explicitly. Added a regression test for `autoShrinkLayoutFor(0, 'custom:grid-2x2')`.
- **Commit:** same commit as this entry

### 3. Experimental renderer flag defaulted to enabled instead of opt-in

- **Source:** github-claude | PR #626 round 1 | 2026-06-26
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/terminalRendererMode.ts`
- **Finding:** `resolveDefaultTerminalRendererMode` treated unset or unexpected `VITE_RENDERER_GHOSTTY_WASM` values as `ghostty-wasm`, so production builds enabled the experimental renderer by default while the documented smoke-test flag was effectively an opt-out.
- **Fix:** Made Ghostty WASM explicitly opt-in with only `1` or `true`, defaulting all unset, false, or unexpected values to `xterm`. Added tests for unset, disabled, enabled, and unexpected flag values.
- **Commit:** same commit as this entry
