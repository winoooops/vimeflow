---
id: hot-path-caching
category: backend
created: 2026-06-09
last_updated: 2026-06-16
ref_count: 0
---

# Hot-Path Caching

## Summary

Status-polling and decode hot paths must not repeat expensive I/O or
computation whose inputs are stable for the session lifetime. A
`read_dir` + per-file SQLite schema probe, a network discovery call, or a
heavy derivation that runs on every tick accumulates avoidable latency
and degrades the user-visible refresh rate. When the looked-up value is
stable (a database path, a configuration root, a capability flag), cache
it after the first successful resolution and reuse it for the remainder
of the session. Cache misses must remain retryable so that early
polling before a resource is ready does not permanently freeze the
feature.

## Findings

### 1. `discover_db` directory scan runs on every `decode()` call

- **Source:** github-claude | PR #408 round 2 | 2026-06-09
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/locator.rs`
- **Finding:** `latest_account_rate_limits` called `discover_db(&self.codex_home, "logs")` on every invocation. `discover_db` does `std::fs::read_dir(codex_home)`, then opens a read-only SQLite connection for each `.sqlite` file and queries `sqlite_master` to check if the target table exists. Over a busy session this accumulates repeated directory reads and SQLite open/close cycles for every decoded status event.
- **Fix:** Added a `logs_db_cache: std::sync::OnceLock<PathBuf>` field to `CompositeLocator`. `latest_account_rate_limits` checks the cache first; on a miss it runs `discover_db`, stores the result only on success, and retries on subsequent calls if the earlier discovery returned `None`. This eliminates repeated filesystem I/O without changing per-call read-query behavior.
- **Commit:** same commit as this entry

### 2. Kimi supervisor reparses full transcript on every idle poll

- **Source:** github-codex-connector | PR #481 round 1 | 2026-06-16
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/transcript.rs`
- **Finding:** `run_session_supervisor` calls `emit_session_status` every 750 ms, which unconditionally calls `parse_session_aggregate` and `main_settled_turn_count`. Both helpers read and parse the full main and active `wire.jsonl` files before deduping. For long-running sessions the transcripts grow large, so leaving a Kimi pane open keeps doing full-file I/O and JSON parsing indefinitely.
- **Fix:** Added a cheap `session_source_mtime` metadata walk over `state.json` and every known agent wire. `emit_session_status` now caches the parsed `StatusSnapshot` and the settled turn count; when the source mtimes are unchanged it reuses the cached snapshot and still calls `maybe_refresh_usage` every poll so consent/retry flows are not starved. The expensive reparse is skipped only when the inputs have not changed.
- **Commit:** same commit as this entry
