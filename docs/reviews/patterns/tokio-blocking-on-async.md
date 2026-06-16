---
id: tokio-blocking-on-async
category: backend
created: 2026-05-04
last_updated: 2026-06-14
ref_count: 2
---

# Tokio Blocking On Async Worker

## Summary

Async sidecar command handlers run on Tokio worker threads. Any
`std::thread::sleep`, blocking filesystem I/O (`std::fs::canonicalize`,
`std::fs::read_to_string` against large files), CPU-bound loops, or synchronous
SQLite queries inside that async body block the worker until they return —
starving every other future scheduled on the same thread. Keep synchronous
`*_inner` work isolated and call it via `tokio::task::spawn_blocking(move ||
inner(...))` when it cannot be made async. Older findings below preserve their
original Tauri command wording.

## Findings

### 1. `start_agent_watcher` blocked tokio worker via std::thread::sleep retry loop

- **Source:** github-claude | PR #154 round 1 | 2026-05-04
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/mod.rs`
- **Finding:** `agent::adapter::base::resolve_status_source_with_retry` issued `std::thread::sleep(100 ms)` up to 5 times inside the synchronous `adapter.start(...)` call made from the async `start_agent_watcher` Tauri command. Worst case: 500 ms blocking the tokio worker thread. The retry was added in cycle 7 of the codex-adapter Stage 2 implementation as a cheap way to ride out the cold-start race where Codex hasn't yet committed its first `logs` row — but writing it as a synchronous loop ignored the tokio context. The same codebase already uses `tokio::task::spawn_blocking` correctly for the git-watcher command (`src-tauri/src/git/watcher.rs:399`), creating a trap for future contributors who'd see two divergent patterns and not know which to follow.
- **Fix:** Wrap `adapter.start(...)` in `tokio::task::spawn_blocking(move || ...)` inside `start_agent_watcher`. The inner `start_for` retry loop stays synchronous (it doesn't need to change shape; the only requirement was getting it OFF the async worker). Clone `(*state).clone()` into `owned_state` and `PathBuf::from(cwd)` into `cwd_path` before the move so the closure owns its inputs. Mirrors the git-watcher pattern verbatim. The lesson: for any `#[tauri::command] pub async fn`, treat the body as if it ran on a thread that's also serving 100 other futures — even brief blocking calls (filesystem walks, sleep, sqlite queries) need `spawn_blocking`. Code-review heuristic: any sync-named call (`fs::*`, `thread::sleep`, `Connection::*`, `read_to_string`) inside an `async fn` body that isn't `.await`-driven is suspect; either route through `spawn_blocking` or rewrite to use a tokio-aware async equivalent (`tokio::time::sleep`, `tokio::fs::*`).
- **Commit:** _(see git log for the round-1 fix commit on PR #154)_

### 2. Timeout cleanup spawned a blocking Windows kill process on a Tokio worker

- **Source:** github-claude | PR #214 | 2026-05-17
- **Severity:** MEDIUM
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** `run_git_with_timeout` used synchronous `Command::new("taskkill").status()` in the async timeout branch. On Windows, `taskkill.exe` can block long enough to hold a Tokio worker thread while the timed-out git child is being cleaned up.
- **Fix:** Wrap the Windows `taskkill` subprocess in `tokio::task::spawn_blocking` and detach the handle, matching the existing fire-and-forget Unix kill semantics without blocking the async worker.
- **Commit:** _(see git log for the PR #214 Windows timeout cleanup review-fix commit)_

### 3. `session_created_at` reads the full `wire.jsonl` and runs even when the timestamp cannot be used

- **Source:** github-claude | PR #447 round 2 | 2026-06-14
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs`
- **Finding:** `try_resolve_from_index` called `session_created_at` for every cwd-matching index entry before knowing whether the value would be used. On macOS `process_start` is `None`, so the returned timestamp was discarded, yet the helper still used `std::fs::read_to_string` over the whole `wire.jsonl` even though the `metadata` record is expected at the start. For long-running projects with multiple same-cwd sessions, attach synchronously read multiple large transcript files before the watcher started.
- **Fix:** Moved the `session_created_at` call behind a `process_start.is_some()` guard and rewrote the helper to open the wire file once and iterate with `BufReader::lines()`, returning as soon as the first `metadata` line is parsed. This makes the I/O O(metadata line size) instead of O(transcript size) and skips it entirely on platforms without `/proc`.
- **Commit:** same commit as this entry

### 4. `KimiLocator::locate` used `std::thread::sleep` inside the async watcher startup retry loop

- **Source:** github-codex-connector | PR #447 round 1 | 2026-06-14
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs`
- **Finding:** `KimiLocator::locate()` retried proc-fd/index resolution up to five attempts and called `std::thread::sleep(100 ms)` between misses. The locator was invoked from the async session lifecycle / watcher startup path, so a fresh Kimi attach where the index row or proc-fd was not yet visible could park the async worker thread for up to ~400 ms, freezing unrelated IPC work on a single-thread runtime and reducing worker capacity on a multi-thread runtime.
- **Fix:** Removed the retry loop and synchronous sleep from `KimiLocator::locate` so it performs a single locate attempt. Moved the retry loop into `SessionLifecycle::locate_async`, which dispatches each attempt via `tokio::task::spawn_blocking` and uses `tokio::time::sleep` between attempts so the async task yields instead of parking a thread. Added `Clone` to `AgentBindings` so the async retry wrapper can own the bindings across spawned attempts.
- **Commit:** same commit as this entry
