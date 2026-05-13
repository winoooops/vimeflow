---
id: pty-session-management
category: backend
created: 2026-04-09
last_updated: 2026-05-13
ref_count: 2
---

# PTY Session Management

## Summary

PTY sessions in Tauri must handle lifecycle carefully: validate IPC inputs,
prevent session ID reuse conflicts, avoid blocking async runtime threads, and
never log terminal input (may contain secrets).

## Findings

### 1. Unvalidated IPC input allows arbitrary shell execution

- **Source:** github-codex | PR #31 | 2026-04-06
- **Severity:** HIGH
- **File:** `src-tauri/src/terminal/commands.rs`
- **Finding:** `spawn_pty` trusts `request.shell`, `request.cwd`, `request.env` from webview without validation
- **Fix:** Validated shell against allowlist, cwd within workspace root, whitelisted env keys
- **Commit:** `ba395c7 feat: Phase 2 workspace layout shell with v2 design (#31)`

### 2. Duplicate session IDs overwrite active PTY without cleanup

- **Source:** github-codex | PR #31 | 2026-04-06
- **Severity:** HIGH
- **File:** `src-tauri/src/terminal/commands.rs`
- **Finding:** `spawn_pty` inserts new session without checking if ID exists — previous session's process leaked
- **Fix:** Check for existing session ID, kill/remove before replacing
- **Commit:** `ba395c7 feat: Phase 2 workspace layout shell with v2 design (#31)`

### 3. Session ID reuse causes stale reader to delete new session

- **Source:** github-codex | PR #31 | 2026-04-06
- **Severity:** HIGH
- **File:** `src-tauri/src/terminal/commands.rs`
- **Finding:** Old reader thread calls `state.remove(&session_id)` on EOF, removing the NEW session inserted with same ID
- **Fix:** Track per-session generation token, reader only removes if generation matches
- **Commit:** `ba395c7 feat: Phase 2 workspace layout shell with v2 design (#31)`

### 4. Blocking PTY read loop on async runtime thread

- **Source:** github-codex | PR #31 | 2026-04-06
- **Severity:** MEDIUM
- **File:** `src-tauri/src/terminal/commands.rs`
- **Finding:** Blocking `reader.read()` loop inside async task starves runtime worker threads
- **Fix:** Moved to `spawn_blocking` or dedicated thread
- **Commit:** `ba395c7 feat: Phase 2 workspace layout shell with v2 design (#31)`

### 5. PTY input logged verbatim (secret leakage)

- **Source:** github-codex | PR #31 | 2026-04-06
- **Severity:** MEDIUM
- **File:** `src-tauri/src/terminal/commands.rs`
- **Finding:** `write_pty` logs full terminal input via `log::debug!` — credentials and tokens exposed in logs
- **Fix:** Log only metadata (session ID, byte length), not payload
- **Commit:** `ba395c7 feat: Phase 2 workspace layout shell with v2 design (#31)`

### 6. Read loop's session-liveness side-channel removed without explicit cancellation, leaving ignore-SIGTERM children unreclaimed

- **Source:** github-claude (LOW) + github-codex-connector (P1) | PR #123 round 1 | 2026-05-02
- **Severity:** MEDIUM (matched at the higher of the two reviewer severities — Codex P1)
- **File:** `src-tauri/src/terminal/commands.rs`, `src-tauri/src/terminal/state.rs`
- **Finding:** PR #123's perf optimization decoupled `read_pty_output` from the global `sessions` map (`Arc<Mutex<RingBuffer>>` cloned out, no per-chunk lock). The implicit "break on `sessions.get(session_id) == None`" guard that came along for free with the old per-chunk lock was eliminated without a replacement. After `kill_pty` removes a session, the read thread keeps reading and emitting `pty-data` until eventual EOF — fine for SIGTERM-honoring children, but a process that ignores SIGTERM keeps the read thread, the ring `Arc`, and the event flow alive indefinitely. The frontend buffers unknown-session `pty-data` optimistically, so the post-removal flow becomes unbounded memory growth on the JS side too.
- **Fix:** Added `cancelled: Arc<AtomicBool>` to `ManagedSession` plus a `PtyState::set_cancelled(session_id)` method. `kill_pty` flips the flag AFTER the successful-kill / already-gone branches (NOT on the `KillError::KillFailed` path — flipping there would let a later read trip `remove_if_generation` and orphan a still-alive child from app state, breaking the retry contract). The read loop checks the flag at the TOP of the `Ok(n)` branch, BEFORE appending to the ring or emitting `pty-data` — checking after would leak one chunk per kill_pty. Codex verify caught both ordering bugs across two retry cycles before the third pass landed clean.
- **Commit:** _(see git log for the round-1 fix commit; v1→v2→v3 codex-verify retries documented in `.harness-github-review/cycle-1-verify-result-v{1,2,3}.json`)_

### 7. `addPane` orphan cleanup called `service.kill` BEFORE `dropAllForPty`, violating F6 tombstone-first invariant

- **Source:** github-claude | PR #204 round 2 | 2026-05-13
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** Step 5c-2's `addPane` has two orphan-cleanup branches: (a) `!fresh` (session vanished during spawn), (b) `!appended` (reducer rejected at commit). Branch (b) correctly tombstones first (`dropAllForPty(result.sessionId)` then `await service.kill(...)`); branch (a) used the inverse order (kill then drop), so during the kill IPC round-trip any `pty-data` event the orphan emitted would be accepted into `usePtyBufferDrain`'s `bufferedRef` / `pendingPanesRef` and only discarded once `dropAllForPty` ran. The F6 invariant in `usePtyBufferDrain.ts` is explicit: "tombstone FIRST so any racing pty-data event arriving between here and Rust's actual kill is dropped on the floor instead of re-populating bufferedRef." Copy-paste drift between the two branches.
- **Fix:** Swap the order in branch (a) so `dropAllForPty(result.sessionId)` runs BEFORE the `await service.kill(...)`. One-line move. Identical shape to branch (b); both branches now match the F6 contract. Code-review heuristic: any two cleanup branches in the same function that handle the same resource MUST share the same tombstone+kill ordering — any divergence is a copy-paste bug, not a deliberate design choice.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #204)_
