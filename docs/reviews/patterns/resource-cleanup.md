---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-05-31
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

### 4. Lock file fd leak and stale lock on writeSync failure

- **Source:** github-claude | PR #322 round 1 | 2026-05-31
- **Severity:** LOW
- **File:** `scripts/qa-runner/run.js`
- **Finding:** `openSync(lock, 'wx')` created the file, but if `writeSync` then
  threw (e.g. disk-full), `closeSync(fd)` was never called (leaked fd) and
  execution never reached the outer `try/finally` that unlinks the lock. The
  lock file persisted, permanently blocking future automation for that PR.
- **Fix:** Replaced the `openSync`/`writeSync`/`closeSync` trio with a single
  atomic `writeFileSync(lock, ..., { flag: 'wx' })` and added `unlinkSync(lock)`
  in the non-`EEXIST` catch path so write failures clean up the partially
  created lock before re-throwing.
- **Commit:** same commit as this entry (see `git blame` / `git log`)

### 5. Stream pipe() drops trailing partial line from console

- **Source:** github-claude | PR #322 round 1 | 2026-05-31
- **Severity:** LOW
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** The `pipe()` helper buffered child stdout/stderr line-by-line
  for console output, but only flushed when it found a `\n`. A final partial
  line (e.g. the last line of kimi's summary without a trailing newline) was
  silently dropped from the console, though it was still written to the log
  file.
- **Fix:** Added `stream.on('end', () => { if (buf) out(...) })` after the
  `'data'` handler to flush any remaining buffered text when the child stream
  closes.
- **Commit:** same commit as this entry (see `git blame` / `git log`)
