---
id: terminal-render-state-driver-contract
category: terminal
created: 2026-06-19
last_updated: 2026-06-20
ref_count: 1
---

# Terminal Render-State Driver Contract

## Summary

Future native terminal render-state drivers (e.g. a libghostty-vt bridge) receive
PTY bytes through a `writeBytes` callback and report side effects such as OSC-7
cwd changes via an `effects` object. Because the adapter that wraps these drivers
uses a stack-scoped guard (`activeInput`) that is cleared as soon as `writeBytes`
returns, any effect callback that fires asynchronously after the call completes
will be silently dropped. The driver interface contract must therefore be
documented explicitly: effect callbacks must be invoked synchronously inside the
`writeBytes` call.

## Findings

### 1. writeBytes JSDoc omits synchronous-effects calling contract

- **Source:** github-claude | PR #558 round 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/ghosttyVtRenderStateDriver.ts` L15-22
- **Finding:** `GhosttyVtRenderStateDriver.writeBytes` docs told native implementors to keep OSC effects inside the driver boundary but did not state that `effects` callbacks (e.g. `onCwdChange`) must fire synchronously before `writeBytes` returns. The wrapping `GhosttyVtByteParserAdapter` clears `activeInput` immediately after the call, so an asynchronous native callback would silently drop cwd events.
- **Fix:** Added a paragraph to the `writeBytes` JSDoc stating that `effects` callbacks must be invoked synchronously within the call, because the adapter path clears active input after `writeBytes` and drops asynchronously dispatched events.
- **Commit:** same commit as this entry

### 2. Render-state parser engine inherits Ghostty text fallback

- **Source:** github-codex-connector | PR #559 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/ghosttyVtRenderStateDriver.ts` L78
- **Finding:** `createGhosttyVtRenderStateParserEngine` wrapped the render-state driver in the generic Ghostty parser engine, which falls back to the text parser and resets the byte adapter when a chunk arrives without `bytesBase64`. During restore, `useTerminal` synthesizes replay chunks as text, so the VT driver was reset before later byte chunks arrived; subsequent replace snapshots were generated from driver state that never saw the replayed bytes.
- **Fix:** Added a `byteOnly` option to `GhosttyParserEngineOptions` and enabled it for VT render-state engines. Text-mode input now throws instead of falling back to the text parser, keeping the driver byte-only until restore supplies byte-preserving replay data.
- **Commit:** same commit as this entry

### 3. Bypass byte-only parser for direct terminal status writes

- **Source:** github-codex-connector | PR #559 round 1 | 2026-06-19
- **Severity:** HIGH
- **File:** `src/features/terminal/components/TerminalPane/ghosttyInstance.ts` L58-L62
- **Finding:** `GhosttyTerminalModel` wired `TerminalTextSurface.transformOutput` to `parserEngine.parseText` for every raw `terminal.write` call. With a VT render-state driver, the parser engine is configured as `byteOnly`, so `parseText` throws on synthetic status strings such as PTY exit/error messages instead of rendering them.
- **Fix:** Added an `acceptsTextInput` flag to `TerminalParserEngine` and set it to `false` for byte-only Ghostty engines. `GhosttyTerminalModel.transformOutput` now returns plain `{ visibleText: data }` when the engine does not accept text input, bypassing the byte-only parser for direct terminal status writes.
- **Commit:** same commit as this entry

### 4. reset() can leave the driver live while holding a disposed native terminal

- **Source:** github-claude | PR #571 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `electron/ghostty-render-state.ts` L307-318
- **Finding:** `GhosttyRenderStateBridgeDriver.reset()` disposed the current native terminal and reset scanner state before recreating the terminal. If `createTerminal` threw, `disposed` stayed `false` and `terminal` still referenced the disposed native object, so later calls passed `assertActive()` and hit a disposed native handle.
- **Fix:** Wrapped terminal recreation in a try/catch. On failure, set `disposed = true` before rethrowing so the driver fails closed.
- **Commit:** same commit as this entry

### 5. Cursor row is not bounded to the snapshot rows

- **Source:** github-claude | PR #571 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `electron/ghostty-render-state.ts` L263-282, `src/features/terminal/components/TerminalPane/ghosttyNativeRenderStateBridge.ts` L74-98
- **Finding:** The native bridge validated `visibleLines` row indices against the snapshot row count, but accepted `cursorRow`/`rowIndex` values beyond the available rows. A snapshot produced during resize or malformed native output could reach rendering with an out-of-bounds cursor.
- **Fix:** Added upper-bound checks: `cursorRow >= snapshot.rows` is rejected in the preload normalizer, and `rowIndex >= rows.length` is rejected in the renderer-side normalizer.
- **Commit:** same commit as this entry
