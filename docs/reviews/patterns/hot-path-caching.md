---
id: hot-path-caching
category: backend
created: 2026-06-09
last_updated: 2026-06-28
ref_count: 2
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

### 3. Stale active snapshot returned when detection returns null

- **Source:** github-codex-connector (P2) | PR #459 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/utils/statusRefreshCoordinator.ts`
- **Finding:** When `detect_agent_in_session` returned `null` for a pane with a cached active snapshot, the coordinator returned the stale snapshot unchanged. Switching back to that pane restored `isActive: true` until the primary polling hook caught up.
- **Fix:** Changed the null-detection branch to write a default inactive snapshot instead of returning the previous one, so hot-loaded panes never display a dead agent as active.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Opencode models cache cached an empty first read forever

- **Source:** github-codex-connector | PR #599 round 1 | 2026-06-21
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/model_catalog.rs`
- **Finding:** `catalog` used `OnceLock::get_or_init` with `Catalog::new()` on missing, unreadable, malformed, or empty `models.json`. If Vimeflow decoded opencode before opencode finished refreshing the cache, every later `context_window` lookup returned the unknown sentinel until restart.
- **Fix:** Split disk loading from cache initialization and populate the `OnceLock` only after a non-empty successful parse. Added regression tests proving missing, empty, and malformed first reads remain retryable and a later valid cache is used.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Helper stdout parser copied the accumulated buffer on every chunk

- **Source:** github-claude | PR #630 round 3 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** `appendStdout` appended each helper stdout chunk with `Buffer.concat([previous, chunk])`, turning large replay streams into quadratic buffer-copy work on the Electron main process.
- **Fix:** Store pending stdout chunks and byte length separately, scan for the frame header delimiter across chunks, and concatenate only after a complete frame is available. Added regression coverage for frame headers split across stdout chunks.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Per-event dispatch table allocated a Map for every helper event

- **Source:** github-claude | PR #630 round 3 | 2026-06-28
- **Severity:** LOW
- **File:** `electron/ghostty-native-helper.ts`
- **Finding:** `handleHelperEvent` constructed a two-entry `Map` on every PTY input or resize event, adding avoidable allocation to a high-frequency helper event path.
- **Fix:** Replaced the per-call `Map` with a `switch` over the known helper event names.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Partial native bridge loads were cached as ready

- **Source:** github-codex-connector | PR #630 round 4 | 2026-06-28
- **Severity:** HIGH
- **File:** `native/ghostty-parent/ghostty_native_parent.cc`
- **Finding:** The native Ghostty parent cached the `dlopen` handle before all `dlsym` calls succeeded and used that handle as the readiness sentinel. A mismatched dylib could fail one symbol lookup, then the next native call would skip symbol loading and call a null function pointer.
- **Fix:** Added a bridge reset path that `dlclose`s the library and clears every cached function pointer when any symbol lookup fails, so only a fully loaded bridge remains cached.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Missing Ghostty parent addon retried filesystem checks on every IPC call

- **Source:** github-claude | PR #630 round 5 | 2026-06-28
- **Severity:** HIGH
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** `getAddon()` used nullish assignment to cache successful addon loads, but a missing native addon made `loadAddon()` throw before assignment. Every later parent update/data/focus/destroy IPC call retried synchronous artifact checks and exception allocation while the feature flag was enabled.
- **Fix:** Added an addon-load failure sentinel checked by `getOptionalAddon()` before entering the loader path, so a controller attempts the native artifact load once and later hot-path calls return disabled immediately.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
