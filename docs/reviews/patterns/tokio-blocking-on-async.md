---
id: tokio-blocking-on-async
category: backend
created: 2026-05-04
last_updated: 2026-05-17
ref_count: 1
---

# Tokio Blocking On Async Worker

## Summary

`#[tauri::command] pub async fn` runs on a tokio worker thread. Any
`std::thread::sleep`, blocking filesystem I/O (`std::fs::canonicalize`,
`std::fs::read_to_string` against large files), CPU-bound loops, or
synchronous SQLite queries inside that command body block the worker
until they return — starving every other future scheduled on the same
thread. The repo's git-watcher command demonstrates the correct shape:
keep the synchronous "inner" function but call it from the async outer
via `tokio::task::spawn_blocking(move || inner(...))`. When wrapping
sync work for an async Tauri command, prefer cloning `&State<T>` /
`AppHandle<R>` references into owned values BEFORE the move, then
threading them into the blocking closure.

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
