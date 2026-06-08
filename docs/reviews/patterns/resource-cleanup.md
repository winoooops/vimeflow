---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-06-08
ref_count: 10
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

### 4. Sequential signal-then-join in a multi-thread teardown made the two ~500ms sleeps accumulate; parallel signal-then-join cuts Drop latency in half

- **Source:** github-claude | PR #302 round 6 | 2026-05-30
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` L110-121 (`WatcherHandle::Drop`)
- **Finding:** `WatcherHandle::Drop` ran the teardown of its two background threads sequentially — signal poll-stop → join poll-thread → signal session_index-stop → join session_index-thread. Each thread's exit is bounded by a ~500ms poll sleep (`POLL_INTERVAL / INTERRUPT_SLICES`), so the worst-case Drop time was the SUM (~1s) instead of the MAX (~500ms). The bug wasn't a correctness issue — Drop runs outside the watchers mutex so it doesn't block concurrent readers — but it directly impacted `stop_agent_watcher` IPC response time and watcher-restart latency seen by the caller. The pattern was easy to miss because the file already had `_watcher → poll_stop → join_handle` in this sequential shape (notify + poll pair), and the codex `session_index` fields were ADDED at the end of Drop as "the next thing to tear down" — pattern-matching the existing structure carried the inefficiency forward.
- **Fix:** Hoist the `session_index_stop.store(true, ...)` call BEFORE the poll-thread `.join()`. Now both threads receive their stop signals in rapid succession; the subsequent two `.join()` calls block on threads that are ALREADY racing toward exit in parallel. Total time is bounded by `max(poll_sleep, session_index_sleep)` ~ 500ms. The fix is one line moved; the comment around it explains the parallelism rationale so a future contributor adding a THIRD background thread knows to put its stop-signal in the same upper block (not as a "signal-join pair" tacked onto the end). Code-review heuristic: in any Drop / shutdown sequence that tears down N independent threads, the pattern is "signal all N → join all N" (max latency = slowest), NOT "signal-join, signal-join, …" (sum latency = total). The pair-by-pair shape is correct only when joins are causally ordered (e.g., thread B can't exit cleanly until thread A is gone). Independent threads are the common case; check whether the joins actually need ordering before defaulting to the sequential shape.
- **Commit:** same commit as this entry

### 5. Close handler async IIFE missing try/finally leaves window stranded when flush rejects

- **Source:** github-claude | PR #387 round 1 | 2026-06-07
- **Severity:** HIGH
- **File:** `electron/main.ts` L289-302
- **Finding:** The `close` event handler defers window close by calling `event.preventDefault()`, then launches an async IIFE that awaits `workspaceTeardown?.flushOnce()` before setting `closeFlushed = true` and re-issuing `win.close()`. If `flushOnce()` rejects (I/O error, writer not ready, etc.), the rejection propagates out of the unguarded await and skips both statements. The window is stuck because `event.preventDefault()` already fired and `closeFlushed` was never set. A second close attempt succeeds immediately because `WorkspaceTeardown.flushOnce()` sets its internal `flushed` guard _before_ calling `flush()`, so the once-guard fires and the second close skips persistence entirely — silently dropping the workspace snapshot.
- **Fix:** Wrap the `await workspaceTeardown?.flushOnce()` in a `try` block and move `closeFlushed = true; win.close()` into the `finally` block. This mirrors the already-correct `before-quit` path which uses `try { await flushOnce() } finally { app.exit(0) }`.
- **Commit:** _(see git log for PR #387 upsource cycle 1 fix commit)_

### 6. Hydration release in voided async IIFE can reject and become unhandled

- **Source:** github-claude | PR #396 round 1 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts` L274-280
- **Finding:** The restore effect launches a voided async IIFE that calls `await beginWorkspaceHydration()` and later awaits `await endWorkspaceHydration()` inside the `finally` block. Because the IIFE is discarded with `void`, any rejection from `endWorkspaceHydration()` — which delegates to renderer IPC and can fail during teardown, reload, or backend disruption — escapes as an unhandled Promise rejection. It also means the release command may never land, leaving main's hydration guard pinned open and persistence writes suppressed.
- **Fix:** Wrap the `await endWorkspaceHydration()` call in a nested `try/catch` inside the `finally` block. On rejection, log the error via the module logger and swallow it, so the voided IIFE always settles cleanly and the guard is released as best-effort.
- **Commit:** same commit as this entry

### 7. Atomic write helper leaves orphaned .tmp file on mid-write failure

- **Source:** github-claude | PR #389 round 1 | 2026-06-08
- **Severity:** LOW
- **File:** `crates/backend/src/terminal/bridge.rs` L41-52 (`write_executable_script`)
- **Finding:** `write_executable_script` creates a `.tmp` sibling file, writes content, syncs, renames to target, and sets permissions. Every intermediate step uses `?` for early return on error. If `write_all`, `sync_all`, or `rename` fails, the function returns before the `.tmp` file is removed. The name is fixed (same `.tmp` extension for every call), so repeated failures don't accumulate many files — but a single persistent error (e.g. disk full) leaves the orphan until the session directory is cleaned up.
- **Fix:** Wrapped the write→rename→permissions sequence in a closure, stored the `Result`, and called `let _ = std::fs::remove_file(&tmp_path)` whenever the result is `Err`. The `remove_file` no-op on a non-existent path (e.g. if `rename` already succeeded but `set_permissions` failed) is harmless.
- **Commit:** same commit as this entry

### 8. Atomic write helper fails spawn after successful rename when directory fsync errors

- **Source:** github-claude | PR #389 round 6 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `crates/backend/src/terminal/bridge.rs` L49-55 (`write_executable_script`)
- **Finding:** After `std::fs::rename(&tmp_path, path)` succeeds, the script exists at its final executable path. If the subsequent parent-directory `sync_all()` fails, `write_executable_script` returns an error, `generate_bridge_files` reports a failed script write, and the PTY spawn path can abort even though the script was written correctly. This is rare on common local Linux filesystems, but plausible on some mounted or unusual filesystems and affects the core session-spawn path when the agent bridge is enabled.
- **Fix:** Demoted the directory `fsync` to best-effort using `let _ = std::fs::File::open(parent).and_then(|dir| dir.sync_all());` so a failed directory sync no longer aborts the spawn after a successful rename.
- **Commit:** same commit as this entry

### 9. Reset cleared an in-flight workspace flush during macOS reopen

- **Source:** github-claude | PR #404 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/workspace-teardown.ts`
- **Finding:** `WorkspaceTeardown.reset()` cleared `inFlight` unconditionally. If a user closed the last window, reopened before the close flush completed, then closed again, the second close could start a concurrent flush instead of sharing the first in-flight teardown transaction.
- **Fix:** Initially kept `inFlight` intact during reset; later refined in finding #11 to track teardown generations so same-generation callers share the flush while a new teardown still persists its own final shape.
- **Commit:** same commit as this entry

### 10. Process-global IPC handler registration should be idempotent at setup boundaries

- **Source:** github-claude | PR #404 round 3 | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/main.ts`
- **Finding:** Electron `ipcMain.handle()` channels are process-global and throw when registered twice. Even when a setup path is intended to run once, controller installation should dispose any previous handler owner before installing a replacement so lifecycle drift or future setup re-entry cannot wedge the main process with duplicate handlers.
- **Fix:** Dispose and clear the previous browser-pane and workspace-layout IPC controller owners immediately before installing replacements.
- **Commit:** same commit as this entry

### 11. Reused in-flight workspace flush skipped a new teardown epoch

- **Source:** github-claude | PR #404 round 4 | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/workspace-teardown.ts`
- **Finding:** Keeping one global `inFlight` promise across `reset()` avoided duplicate flushes, but a new window that opened and closed while the old flush was still running would return the old promise and never drain or persist the new window's final shape.
- **Fix:** Track a teardown generation. Same-generation callers still share the in-flight flush, but `reset()` advances the generation and a new teardown queues its own flush behind any older flush still running.
- **Commit:** same commit as this entry
