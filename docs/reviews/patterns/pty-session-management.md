---
id: pty-session-management
category: backend
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
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
