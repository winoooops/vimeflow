---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-24
ref_count: 3
---

# Resource Cleanup

## Summary

Services that register global event listeners (especially
`window.vimeflow.listen()` or legacy Tauri IPC listeners) must be disposed on
unmount. Creating a new service instance per component mount without cleanup
causes listener accumulation and duplicate event handling.

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

### 3. localStorage activityPanelCollapsed key leaks on session close

- **Source:** github-claude | PR #259 round 1 | 2026-05-24
- **Severity:** MEDIUM
- **File:** `src/features/sessions/utils/activityPanelCollapsedStore.ts`
- **Finding:** The new UI-side store exported only `readActivityPanelCollapsed` and `writeActivityPanelCollapsed`. `removeSession` never deleted the key, so every closed session left a `vimeflow:sessions:activityPanelCollapsed:<id>` entry in localStorage forever — replacing the Rust PTY cache (auto-cleaned on PTY exit) without an equivalent cleanup hook.
- **Fix:** Add `deleteActivityPanelCollapsed(sessionId)` to the store. Call it from `removeSession` only on the happy path (after both kill phases settle), so a partial-kill bail does not drop the preference for a session the user can still see and retry.
- **Verification:** Targeted tests in `activityPanelCollapsedStore.test.ts` (delete removes entry, no-op when absent, isolates by id) + `useSessionManager.test.ts` (removeSession clears the key on success, preserves it when kill rejects).
- **Commit:** same commit as this entry (see `git blame` / `git log`)
