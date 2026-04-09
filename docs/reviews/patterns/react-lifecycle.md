---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# React Lifecycle

## Summary

React effects with async work or subscriptions must handle cleanup and guard
against state updates after unmount. Effect dependency arrays must be minimal
to avoid unintended re-runs (e.g., PTY respawning on every cwd change).

## Findings

### 1. PTY respawns on every cwd update via OSC 7

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** PTY spawn effect depends on `cwd`, so any directory change kills the running session and spawns a new one
- **Fix:** Decoupled spawning from cwd — treat cwd as initial spawn parameter stored in a ref
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 2. State updates after unmount in PTY spawn flow

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** `setDebugInfo()` called even when `isMountedRef.current` is false, triggering React warnings
- **Fix:** Gated all state updates (including debug) behind `isMountedRef` guard
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`
