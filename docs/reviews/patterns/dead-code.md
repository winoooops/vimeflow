---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-06-21
ref_count: 3
---

# Dead Code

## Summary

Unreachable or obsolete code paths add maintenance surface, mislead future
refactors, and can mask API-contract bugs. When every call site satisfies a
stricter precondition, fallback branches that were once necessary become dead
code and should be removed.

## Findings

### 1. Label-matching fallback in actionIdFor is unreachable

- **Source:** github-claude | PR #444 round 1 | 2026-06-13
- **Severity:** LOW
- **File:** `src/features/workspace/components/panels/FileExplorer.tsx`
- **Finding:** All entries in `contextMenuActions` carried explicit `id` fields, so the early `return action.id` made the subsequent `switch (action.label)` block unreachable. The dead code risked misleading maintainers into thinking new actions could rely on label matching.
- **Fix:** Removed the unreachable `switch` fallback; `actionIdFor` now returns `action.id ?? null` directly.
- **Commit:** see `git blame` / `git log` on this line

### 2. VITE_TERMINAL_RENDERER assignment in E2E onPrepare is dead code

- **Source:** github-claude | PR #524 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `tests/e2e/ghostty/wdio.conf.ts` L31-34
- **Finding:** `process.env.VITE_TERMINAL_RENDERER = 'ghostty'` in the WDIO `onPrepare` hook has no effect on the Electron renderer because `VITE_*` variables are baked into the renderer bundle by Vite at build time. The same variable is already injected by the `test:e2e:ghostty:run` script via `cross-env`, making the assignment doubly redundant.
- **Fix:** Removed the `VITE_TERMINAL_RENDERER` assignment from `onPrepare`; kept `VIMEFLOW_DISABLE_AGENT_DETECTION`, which is a genuine runtime env var.
- **Commit:** same commit as this entry

### 3. Cursor scroll helper kept an unreachable scroll-up branch

- **Source:** github-claude | PR #571 round 2 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts` L810-822
- **Finding:** `applyScrollMode` reset `root.scrollTop` to `0` before calling `scrollCursorRowIntoView`, so the helper's `cursorTop < viewportTop` branch could never execute. The extra branch suggested a bidirectional scroll contract the only caller did not provide.
- **Fix:** Simplified the helper to the actual caller contract: return when the cursor already fits in the top viewport, otherwise scroll down to reveal the cursor bottom.
- **Commit:** same commit as this entry

### 4. Vite build-time variables in an E2E run script are no-ops

- **Source:** github-claude | PR #578 round 1 | 2026-06-20
- **Severity:** LOW
- **File:** `package.json`
- **Finding:** `test:e2e:ghostty:native:run` set `VITE_E2E`, `VITE_TERMINAL_RENDERER`, and `VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER` even though the Electron bundle had already been built. The runtime assignments could mislead developers into thinking renderer mode changes apply without rebuilding.
- **Fix:** Removed the build-time `VITE_*` variables from the native Ghostty run script; the build script remains the place where Vite consumes those values.
- **Commit:** same commit as this entry

### 5. Repeated regex guards can become dead branch signals

- **Source:** github-claude | PR #591 round 6 | 2026-06-21
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/terminalTextSurface.ts` L963-L974
- **Finding:** `createTextNode` evaluated `BLOCK_ELEMENT_PATTERN.test(text)` twice on the same string. The second call was reachable only after the first had already established that block glyphs exist, making the repeated predicate a dead branch signal for future readers.
- **Fix:** Hoisted the regex result into `hasBlockGlyphs` and reused it in both branches, keeping the branch contract explicit.
- **Commit:** same commit as this entry

### 6. Precomputed bridge fields should be deleted when callers reject them

- **Source:** github-claude | PR #591 round 8 | 2026-06-21
- **Severity:** LOW
- **File:** `electron/ghostty-render-state-main.ts` L1019-L1026
- **Finding:** The Electron bridge computed and transmitted `cursor.textOffset`, but the renderer deliberately recomputed cursor offsets from `columnOffset` and the current cell map. The field was dead API surface and could invite future callers to trust a stale main-process offset.
- **Fix:** Removed `textOffset` from the Electron bridge, preload type, renderer-side native bridge normalizer, and VT snapshot cursor type. Updated tests to assert only the live `rowIndex`, `columnOffset`, and visibility contract.
- **Commit:** same commit as this entry
