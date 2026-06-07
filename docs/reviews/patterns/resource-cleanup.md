---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-06-07
ref_count: 4
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
