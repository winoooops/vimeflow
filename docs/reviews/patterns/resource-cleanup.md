---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-14
ref_count: 3
---

# Resource Cleanup

## Summary

Services that register global event listeners (especially Tauri IPC listeners)
must be disposed on unmount. Creating a new service instance per component
mount without cleanup causes listener accumulation and duplicate event handling.

## Findings

### 1. Tauri event listeners leak across terminal panes

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** Each `createTerminalService()` call registers global Tauri listeners with no `dispose()` on unmount — listeners accumulate as panes mount/unmount
- **Fix:** Made Tauri service a singleton or added dispose call in cleanup
- **Commit:** `2fc3fa2 feat: Xterm Terminal Core - TauriTerminalService IPC bridge (#34)`

### 2. Transcript tailer handle lacks drop-time stop signal

- **Source:** github-claude | PR #63 round 2 | 2026-04-14
- **Severity:** LOW
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `TranscriptHandle` exposed an explicit `stop(self)` method, but dropping a handle without calling `stop()` did not set the tail thread's stop flag. Shutdown paths that drop `TranscriptState` directly would leave tail loops running until process exit.
- **Fix:** Add `Drop` for `TranscriptHandle` to set the stop flag. Keep explicit `stop(self)` for paths that must also join the thread.
- **Verification:** Added `transcript_handle_drop_sets_stop_flag`; `cargo test --lib agent::transcript -j1`.
- **Commit:** (pending — agent-status-sidebar PR)
