# Agent Adapter Abstraction — Stage 2: Codex Adapter

**Date:** 2026-05-03
**Status:** Implemented (with documented scope expansion).
**Scope:** Implement `CodexAdapter` against the `AgentAdapter` trait introduced in Stage 1 (`docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md`, PRs #152, #153). Plus a deferred refactor pass to extract genuinely-shared parser helpers across both adapters once duplication is observed.
**Predecessor ADR:** `docs/decisions/2026-05-03-claude-parser-json-boundary.md` — explicitly defers cross-adapter helper promotion until "another adapter proves the abstraction is useful". Step 2 of this spec is that proof.
**Amended by:** `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` — the implementation expanded past three of this spec's locked rules (Codex transcript tailer, `/proc`-as-chooser, `BindContext.pid` semantics). Where this spec and that ADR conflict, the ADR wins for those three items only; the rest of this spec stands.
**Amended further by:** `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` — the trait signature change at "Architecture > Trait signature change" and the `start_for` retry rules at "Architecture > `start_for` retry loop" are superseded. The codex-adapter-internal retry, the `(cwd, sid)` trait method, and the `for_attach(agent_type, pid, pty_start)` factory replace those rules. Everything else in this spec stands.

---

## Context

Stage 1 landed the `AgentAdapter` trait and migrated Claude Code behind it. Detection (`src-tauri/src/agent/detector.rs:140`) already returns `AgentType::Codex` for codex PTYs, but the lookup in `<dyn AgentAdapter<R>>::for_type` falls through to a `NoOpAdapter` whose `parse_status` / `validate_transcript` / `tail_transcript` all return errors. Net effect today: a PTY running `codex` is detected, the agent badge appears in the sidebar, but the status panel stays empty because no adapter exists to read codex's session state.

This spec adds a real `CodexAdapter` that implements the `AgentAdapter` trait, so the existing watcher orchestration in `src-tauri/src/agent/adapter/base/` powers the status panel for codex sessions exactly as it does for Claude.

The user-visible goal is parity with Claude's behavior: when a fresh `codex` PTY starts, the status bar populates as turns occur; when `codex resume <id>` is invoked, the bar populates immediately from the rolled-up history of the resumed session.

## Goal

A `CodexAdapter` that:

1. Resolves the rollout JSONL file the codex process is appending to (its "status source", in the AgentAdapter vocabulary).
2. Folds the JSONL into the existing `AgentStatusEvent` IPC shape, with sensible mappings for codex-specific fields and explicit `None`/zero defaults for the fields codex doesn't expose.
3. Slots into the existing `base::start_for` watcher orchestration without bespoke orchestration code.
4. Operates against a published-but-undocumented codex CLI internal contract, with version-aware fallbacks and no hard-fail when the contract drifts.

A separate, deferred Step 2 captures the cross-adapter parser-helper refactor that becomes possible once two adapters live side by side.

## Non-Goals

- **No `codex app-server` JSON-RPC integration.** That is the right long-term path if Vimeflow ever wants to _launch_ codex itself, but our model is "user types `codex` into a PTY we host", so we observe — we don't drive. Noted as future direction; out of scope for this work.
- **~~No Codex transcript tailer in v1.~~** **Superseded by `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` — the transcript tailer landed in v1.** It re-uses `claude_code/test_runners/*` to emit `AgentToolCallEvent` / `AgentTurnEvent` and test-run signals via `process_response_item` (function_call / custom_tool_call / function_call_output / custom_tool_call_output) and `process_event_msg` (user_message → AgentTurnEvent; exec_command_end + patch_apply_end → AgentToolCallEvent). See the ADR for the rationale and lifecycle invariants.
- **No frontend redesign.** The status panel renders the same `AgentStatus` type. The only frontend changes are (a) handling a new `cost.totalCostUsd: number | null` shape and (b) preserving the null through state instead of coercing to `0`.
- **No premature shared parser module.** Per the 2026-05-03 ADR, generic JSON helpers stay private to each adapter for v1. Step 2 of this spec is the explicit follow-up that decides what (if anything) to promote.
- **No agent-bind-error event.** Existing frontend retry on `start_agent_watcher` failure (every 2000ms via `DETECTION_POLL_MS`) is sufficient for v1 attach failures. A new event would mean new bindings, listener wiring, stale-session filtering, UI state, and tests — none of which produces user-visible behavior beyond what the existing retry already delivers.

## Discovered facts about Codex CLI 0.128.0

These are not documented contracts. They are observations made on May 3, 2026 against `codex-cli 0.128.0`. They drive the architecture of this spec but must be wrapped behind abstractions so that future codex versions don't break us silently. Concrete versioning safeguards are listed under "Versioning safety" below.

### Codex writes one append-only rollout JSONL per session

Path shape: `~/.codex/sessions/YYYY/MM/DD/rollout-<UTC-ts>-<session-uuid>.jsonl`. The native codex binary keeps the file as an open file descriptor for the duration of the session and appends events as they occur. Each line is one JSON object with shape:

```json
{ "timestamp": "ISO-8601", "type": "<event-type>", "payload": { ... } }
```

Top-level `type` values observed:

- `session_meta` — emitted once at the top of the file. Contains `id` (the session UUID), `cwd`, `originator` (`"codex_exec"` / `"codex_tui"`), `cli_version`, `model_provider`, and a `git` block.
- `turn_context` — emitted at the start of each turn. Contains the per-turn `model`, `personality`, `effort`, sandbox/permission profile, and `collaboration_mode`.
- `response_item` — wraps OpenAI Responses API items: `message` (developer/user/assistant), `reasoning`, `function_call`, `function_call_output`. Used for transcript reconstruction (out of scope for v1).
- `event_msg` — discrete UI-style events. The status bar cares about three sub-types under `payload.type`:
  - `task_started { turn_id, started_at, model_context_window, collaboration_mode_kind }` — beginning of a turn.
  - `task_complete { turn_id, completed_at, duration_ms, time_to_first_token_ms, last_agent_message }` — end of a turn.
  - `token_count { info, rate_limits }` — token usage and rate-limit snapshot, typically emitted multiple times per turn. Last one wins for "totals".

The `event_msg.token_count.info` block holds:

```jsonc
{
  "total_token_usage": {
    "input_tokens": 608585,
    "cached_input_tokens": 566912,
    "output_tokens": 9722,
    "reasoning_output_tokens": 7550,
    "total_tokens": 618307,
  },
  "last_token_usage": {
    /* same shape, this turn only */
  },
  "model_context_window": 258400,
}
```

The `event_msg.token_count.rate_limits` block holds:

```jsonc
{
  "limit_id": "codex",
  "primary": {
    "used_percent": 8.0,
    "window_minutes": 300,
    "resets_at": 1777848985,
  }, // 5h
  "secondary": {
    "used_percent": 26.0,
    "window_minutes": 10080,
    "resets_at": 1778074288,
  }, // 7d
  "credits": null,
  "plan_type": "prolite",
  "rate_limit_reached_type": null,
}
```

`primary` maps to the existing `RateLimitInfo.five_hour`. `secondary` maps to `RateLimitInfo.seven_day` (when present). `plan_type` and `credits` are not surfaced in v1.

### Codex does not expose USD cost or lines-changed

The rollout has no per-turn or per-session dollar value, no per-token pricing block, and no diff-line counters. These fields stay zero/null in the resulting `AgentStatusEvent`:

- `cost.total_cost_usd: None` (Q2a — IPC contract changes from `f64` to `Option<f64>`).
- `cost.total_lines_added: 0` and `cost.total_lines_removed: 0` — the existing `ActivityFooter` (`AgentStatusPanel.tsx:104-105`) sources line counts from the git-diff watcher, not from the agent JSON, so zeroes here are harmless.

### Resume reuses the same rollout JSONL

`codex resume <id>` opens the existing rollout file and continues appending. The locator (below) returns the same `rollout_path`. On first parse, the fold replays all historical `token_count` events — last one wins for totals, durations sum across all `task_complete`s — so the status bar shows accumulated state from the first inline read.

### Codex maintains internal SQLite state

Two SQLite DBs in `~/.codex/` track session metadata:

- One DB contains a `logs` table mapping `process_uuid` (which embeds the codex PID) to `thread_id`, with timestamps. Today this is `~/.codex/logs_2.sqlite`.
- One DB contains a `threads` table mapping `thread_id` to `rollout_path`, `cwd`, `updated_at_ms`, plus other metadata. Today this is `~/.codex/state_5.sqlite`.

**The numeric suffixes are not stable contracts.** They have advanced before (`logs_1` → `logs_2`, etc.) and will advance again. The locator below discovers DB files by schema, not by filename.

### Sources to ignore

- `~/.codex/session_index.jsonl` — observed updated April 30, 2026 even though active sessions on May 2/3 existed. The index is only written for certain interactive flows (thread-naming) and is unreliable as a live signal.
- `/proc/<pid>/fd/*` as the **sole** chooser — one live codex PID can hold multiple historical rollout JSONL files open simultaneously, so the fd list cannot be trusted on its own. **Amended by `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`:** `/proc` _may_ contribute candidates **only when the SQLite primary `logs` query returns no rows**, AND every `/proc`-supplied path is round-tripped through `threads WHERE rollout_path = ?` to confirm a real thread row owns it. Multi-fd disambiguation falls out of the SQLite cross-check, not from trusting the fd list.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  detector.rs  (unchanged)                                   │
│   process tree → AgentType::Codex + pid                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  AgentAdapter::for_type(Codex)  →  Arc<CodexAdapter>        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CodexAdapter::status_source(ctx)                           │
│     ctx = BindContext { session_id, cwd, pid, pty_start }   │
│     uses CodexSessionLocator:                               │
│       1. discover codex_logs_db (schema-driven)             │
│       2. logs query: newest thread_id for pid since         │
│          pty_start                                          │
│       3. discover codex_state_db (schema-driven)            │
│       4. state query: thread_id → rollout_path              │
│     returns Result<StatusSource, BindError>                 │
│       Pending → start_for retries (≤500ms total)            │
│       Fatal   → start_for returns Err(String) to frontend   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  base::start_for  (unchanged shape; new retry on Pending)   │
│     watches rollout_path with notify + poll fallback        │
└─────────────────────────────────────────────────────────────┘
                          │  inline read at watcher startup
                          │  OR next file change (debounced 100ms)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CodexAdapter::parse_status(sid, jsonl_text)                │
│     folds session_meta + turn_context + event_msg lines     │
│     incomplete trailing line  → drop silently               │
│     malformed non-final line  → warn, skip                  │
│     returns ParsedStatus {                                  │
│       event: AgentStatusEvent,                              │
│       transcript_path: None,    // v1 stub                  │
│     }                                                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              Tauri emit "agent-status" → frontend
```

### File layout

Mirrors `claude_code/`:

```
src-tauri/src/agent/adapter/codex/
  mod.rs          # CodexAdapter impl
  locator.rs      # CodexSessionLocator trait + SQLite + FS-fallback impls
  parser.rs       # parse_rollout(sid, raw) → ParsedStatus
  transcript.rs   # v1 stub: validate_transcript and tail_transcript both return Err
```

### New backend types

```rust
// In agent/adapter/types.rs

pub struct BindContext<'a> {
    pub session_id: &'a str,
    pub cwd: &'a Path,
    pub pid: u32,
    pub pty_start: SystemTime,
}

pub enum BindError {
    /// Transient — the locator should be retried by `base::start_for`.
    /// String carries a human-readable reason for diagnostics.
    Pending(String),
    /// Permanent — give up and surface to caller. Examples: schema drift
    /// where neither the SQLite path nor the FS-scan fallback can resolve
    /// a rollout path; a non-existent `~/.codex` directory.
    Fatal(String),
}
```

### Trait signature change

> _Superseded by [`docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`](../../decisions/2026-05-05-codex-adapter-trait-simplification.md) — the trait method is now `(cwd: &Path, session_id: &str) -> Result<StatusSource, String>`. The discussion below describes the Stage 2 surface as shipped; the current surface is in the [2026-05-05 spec](./2026-05-05-codex-adapter-trait-simplification-design.md)._

```rust
// Before (Stage 1)
fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource;

// After (Stage 2)
fn status_source(&self, ctx: &BindContext) -> Result<StatusSource, BindError>;
```

`ClaudeCodeAdapter::status_source` and `NoOpAdapter::status_source` ignore `pid` and `pty_start`, always return `Ok(...)`. The change is mechanical for those two impls.

### `start_for` retry loop

> _Superseded by [`docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`](../../decisions/2026-05-05-codex-adapter-trait-simplification.md) — the retry now lives inside `CodexAdapter::status_source` (helper: `retry_locator`). `base::start_for` has zero retry code post-2026-05-05._

`base::start_for` switches from one synchronous `adapter.status_source(...)` call to a bounded retry on `BindError::Pending`:

- Total budget: ≤ 500ms wall clock. Concretely: 5 attempts with 100ms sleep between attempts (or equivalent shape).
- Budget chosen below `DETECTION_POLL_MS / 4` = 500ms so that the frontend's existing 2000ms re-poll never overlaps a still-in-flight `start_agent_watcher` for the same PTY (`useAgentStatus.ts:19`).
- Exhausted Pending → return `Err("could not bind to codex session: <last reason>")`.
- Fatal → return `Err("…")` immediately.
- Ok → continue to existing watcher startup.

No new Tauri events. Frontend treats Err the same way it does today: silent retry on next detection poll.

## Bind & Locator

### `CodexSessionLocator` trait

```rust
pub trait CodexSessionLocator {
    fn resolve_rollout(
        &self,
        ctx: &BindContext,
    ) -> Result<RolloutLocation, LocatorError>;
}

pub struct RolloutLocation {
    pub rollout_path: PathBuf,
    pub thread_id: String,
    pub state_updated_at_ms: i64,
}

pub enum LocatorError {
    /// codex hasn't committed its first row yet; caller should retry.
    NotYetReady,
    /// SQLite was reachable but couldn't resolve a unique rollout.
    Unresolved(String),
    /// SQLite primary AND FS fallback both failed permanently. The
    /// locator only emits this after exhausting the fallback chain;
    /// a missing schema (no DB candidate for `logs` or `threads`) is
    /// a schema-drift signal that triggers FS fallback, not Fatal.
    Fatal(String),
}
```

The production impl is `SqliteFirstLocator`, which composes a `CodexDbDiscovery` and an `FsScanFallback`. Tests use a `MockLocator`.

### DB discovery (the headline durability concern)

Database filenames are _discovered runtime artifacts_, not constants. The locator scans `~/.codex/*.sqlite` and identifies two named ports by schema:

- `codex_logs_db`: any `.sqlite` file whose schema contains a `logs` table.
- `codex_state_db`: any `.sqlite` file whose schema contains a `threads` table.

Discovery rules:

1. List `~/.codex/*.sqlite`. Skip `*.sqlite-wal` and `*.sqlite-shm` — those are SQLite WAL sidecars, not standalone DBs.
2. For each candidate, open read-only and inspect schema (`SELECT name FROM sqlite_master WHERE type='table'`).
3. Group candidates by which named port they satisfy.
4. **Tie-break within a port:** prefer the highest numeric suffix in the filename (e.g. `logs_3` > `logs_2`). Files with no numeric suffix sort lowest. Ties beyond that resolve by newest mtime.
5. If no candidate satisfies a port → discovery returns `Ok(None)` for that port (a schema-drift signal — the table name has likely been renamed in a newer codex CLI). The caller (`SqliteFirstLocator::resolve_rollout`) catches the missing-port signal and dispatches to FS fallback rather than failing. `LocatorError::Fatal` only fires after FS fallback also exhausts (see "Fatal precedence" at the end of this section).

**Discovery is memoized per `CodexAdapter` instance.** Concretely: a `OnceLock<DiscoveredDbs>` field on the adapter struct, populated on first call from `status_source`; subsequent calls (e.g. inside `start_for`'s retry loop on a cold-start race) reuse the cached handles. Each call to `<dyn AgentAdapter<R>>::for_type(AgentType::Codex)` constructs a fresh `Arc<CodexAdapter>`, so the cache scope is "one attach" — across attaches, discovery re-runs against a new instance. This is intentional for v1: it keeps the cache state local (no shared `Arc<DbCache>` or process-global lazy_static), avoids cross-session staleness questions, and the per-attach scan is ~a few ms. A future optimization could promote discovery to a Tauri-managed shared cache if profiling shows the per-attach cost to be material; v1 explicitly does not.

### Primary bind path

Both queries gated by `pty_start`:

1. Open `codex_logs_db` read-only.
2. Query the newest `thread_id` for the codex pid since `pty_start`. The `logs` table stores time as `ts INTEGER` (Unix **seconds**) plus `ts_nanos INTEGER` (subsecond nanoseconds), with a composite index `idx_logs_ts(ts DESC, ts_nanos DESC, id DESC)`. Convert `pty_start: SystemTime` via `duration_since(UNIX_EPOCH)` to `(secs: i64, nanos: i64)` and gate the query with a tuple comparison so the same-second / nanosecond-precision case is handled correctly:

   ```sql
   SELECT thread_id
   FROM logs
   WHERE process_uuid LIKE 'pid:' || :pid || ':%'
     AND thread_id IS NOT NULL
     AND (ts > :pty_start_secs
          OR (ts = :pty_start_secs AND ts_nanos >= :pty_start_nanos))
   ORDER BY ts DESC, ts_nanos DESC
   LIMIT 1;
   ```

   Three bound parameters, all named, all distinct: `:pid` (codex u32), `:pty_start_secs` (i64 Unix seconds), `:pty_start_nanos` (i64 nanos within that second). **Do not mix anonymous `?` with numbered `?N` placeholders** — in SQLite, anonymous `?` aliases to the next sequential numbered slot starting at 1, which collides with `?1` in the timestamp tuple and binds the PID predicate to the wrong value. Either use named placeholders as shown, or numbered consistently (e.g. `?1` for PID, `?2`/`?3` for the tuple). Binding `pty_start` in milliseconds will return zero rows because `logs.ts` is in seconds — the comment in earlier drafts of this spec was wrong; the verified unit is seconds.

   Zero rows → `LocatorError::NotYetReady`. (Codex hasn't flushed its first log entry; caller retries.)

3. Open `codex_state_db` read-only.
4. Query thread metadata:

   ```sql
   SELECT id, rollout_path, cwd, updated_at_ms
   FROM threads
   WHERE id = :thread_id;
   ```

   Zero rows → `LocatorError::NotYetReady`. Codex commits the `logs` row before the corresponding `threads` row during session bootstrap, so a window exists where step 2 returns Ok but step 4 returns nothing. This is a race-transient just like the empty-logs case; `start_for`'s retry budget covers it. **Do not return `Unresolved` here** — that maps to `BindError::Fatal` and would short-circuit the retry loop.

5. Return `RolloutLocation { rollout_path, thread_id, state_updated_at_ms }`.

The SQLite primary path therefore has only one `Unresolved`-shaped failure mode, and it lives in the FS fallback (multiple rollout candidates that cwd can't disambiguate). The primary path itself emits only `NotYetReady` (zero rows on either query) or `Fatal` (I/O error during open/query).

### Linux fast-paths (`/proc`-driven)

**Amended by `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`** — the original "verifier-only" rule turned out to be too narrow under realistic codex bootstrap timing. The implementation runs three layered fast-paths on Linux **only when the SQLite logs query returns zero rows**:

1. **`resume_thread_id_from_proc(proc_root, pid)`** — read `/proc/<pid>/cmdline`, parse a `codex resume <id>` argv pattern, and bind directly via that thread_id (skipping the logs query but still cross-checking with the threads table).
2. **`resolve_from_proc_fds(...)`** — walk `/proc/<pid>/fd/*` symlinks, filter to paths under `~/.codex/sessions/`, and **for each candidate path query `threads WHERE rollout_path = ?`**. The SQLite cross-check is the disambiguator: a stale fd whose path no longer corresponds to a thread row is rejected. Multi-fd codex processes don't bind to the wrong rollout because the threads table has the canonical mapping.
3. **`resolve_recent_state_candidate(...)`** — scan `threads` ordered by `updated_at_ms DESC` with optional cwd matching as the final fallback before FS-scan.

The fast-paths exist because Codex commits its rollout file open and the `threads` row before (often well before) the corresponding `logs` row arrives. The original spec's 500ms `start_for` retry budget couldn't cover that gap without overlapping the frontend's 2000ms detection re-poll. See the ADR for the full reasoning.

`/proc` results without a SQLite cross-check still must not be returned. The original "never as chooser" rule survives in spirit: the chooser is `threads.rollout_path`; `/proc` only narrows the candidate set.

### FS-scan fallback

Engaged when DB discovery returns `Ok(None)` for either port (schema drift on a future codex version where the `logs` or `threads` table names have changed). Algorithm:

1. List `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` for today's date and yesterday's date (clock-skew tolerance).
2. Filter to files whose mtime ≥ `pty_start`.
3. For each remaining file, peek the first line and parse it as `session_meta`. Keep only files where `session_meta.cwd == ctx.cwd`. (`cwd` is treated as advisory — see "Edge cases" below.)
4. If exactly one file remains → return `RolloutLocation { rollout_path, thread_id: session_meta.id, state_updated_at_ms: 0 }`. If multiple → `LocatorError::Unresolved("multiple rollout candidates after FS scan")`. If zero → `LocatorError::NotYetReady`.

### Fatal precedence

`LocatorError::Fatal` is reserved for non-retryable structural failures, NOT for transient zero-match conditions. The decision tree:

- Empty result on SQLite (zero rows on either the logs query OR the threads query) → `NotYetReady`. The logs/threads rows are committed in sequence during codex bootstrap, so either being missing is transient — `start_for`'s retry budget covers the gap.
- Empty result on FS scan (zero matches after cwd/mtime filter) → `NotYetReady` (rollout file not on disk yet).
- Schema drift (no DB candidate has the target table) → routes to FS fallback; never Fatal on its own.
- SQLite I/O error that isn't schema-drift (permission denied, corruption) → `Fatal`.
- FS I/O error during scan (permission denied, unreadable file) → `Fatal`.
- FS scan finds multiple matching rollouts → `LocatorError::Unresolved` (not Fatal — bind-ambiguity, distinct from a structural failure).

A missing-schema signal alone never produces `Fatal` — it always routes to FS fallback first. A zero-match result alone never produces `Fatal` — it's always `NotYetReady` and the orchestration layer decides exhaustion via `start_for`'s retry budget.

### Versioning safety

- Discovery is schema-driven, so renaming `logs_2` → `logs_3` or splitting a table into a new file leaves us functional as long as the table names persist.
- Read `~/.codex/version.json` (a small file containing `{"version": "0.128.0", ...}`) at adapter construction time and `log::info!` it. Do not gate behavior on the version yet; the log line is forensic.
- Pin a tested codex version range as a constant (`CODEX_TESTED_RANGE = "0.128.0..=0.140.0"` or similar). On mismatch, emit a single `log::warn!` per session. Do not hard-fail.
- Wrap all SQLite access behind the locator trait so a future codex version that moves to a different storage mechanism can swap implementations without touching the adapter or watcher.

### Edge cases (locked behavior)

- **`codex resume <uuid>` from a different cwd.** Legitimate: codex resumes the original session whose `session_meta.cwd` was elsewhere. The SQLite primary path handles this fine because `cwd` is metadata, not a filter. The FS-scan fallback's cwd filter would miss this case, which is acceptable — FS scan exists only for schema-drift recovery and the user can typically just retry from the original cwd if it ever fires.
- **PID reuse / multiple historical threads on one pid.** The `ts >= pty_start` gate handles this. We always take the newest thread_id for that pid since pty_start, not just any thread_id ever associated with that pid.
- **Cold-start race: PTY spawns codex, watcher fires before codex commits its first log row.** The retry loop in `start_for` covers this — 500ms is comfortably above the observed commit latency.

## Parser & Field mapping

Implementation lives in `codex/parser.rs`. Per the 2026-05-03 ADR, parser internals are organized around domain functions (e.g. `latest_token_count(value)`, `task_completes(value)`); only repeated nested numeric extraction uses small Codex-private helpers. **Generic JSON helpers stay private to this adapter for v1.** Step 2 of this spec is the explicit follow-up that re-evaluates promotion.

### Algorithm

```text
parse_rollout(session_id, raw) -> Result<ParsedStatus, String>:
    state = CodexFoldState::default()
    let lines: Vec<&str> = raw.split('\n').collect()
    let trailing_complete = raw.ends_with('\n')

    for (idx, line) in lines.iter().enumerate():
        let is_last = idx == lines.len() - 1
        if line.is_empty():
            continue
        if is_last && !trailing_complete:
            // Incomplete trailing line — codex is mid-flush.
            // Drop silently. No warn.
            continue
        match serde_json::from_str::<Value>(line):
            Ok(value) => fold_event(&mut state, &value),
            Err(_)    => log::warn!(
                "codex: skipping malformed rollout line for sid={}",
                session_id
            ),

    Ok(ParsedStatus {
        event: state.into_event(session_id),
        transcript_path: None,    // v1 stub
    })

fold_event(state, value):
    match value["type"].as_str():
        "session_meta":  state.absorb_session_meta(&value["payload"])
        "turn_context":  state.absorb_turn_context(&value["payload"])
        "event_msg":
            match value["payload"]["type"].as_str():
                "task_started":   state.absorb_task_started(&value["payload"])
                "task_complete":  state.absorb_task_complete(&value["payload"])
                "token_count":    state.absorb_token_count(&value["payload"])
                _ => {}             // forward-compat: ignore unknown
        _ => {}                     // forward-compat: ignore unknown
```

`CodexFoldState` is a small struct holding the latest values for each tracked field. `absorb_*` methods are deep-but-private; `into_event` produces the final `AgentStatusEvent`.

**`absorb_token_count` — null-info rule.** Real codex rollouts emit `{"type":"token_count","info":null,"rate_limits":...}` for early-session events (verified live, May 3 2026). The fold MUST handle this as a partial update:

- When `payload.info` is `null` (or missing): fold `payload.rate_limits` only; **preserve all existing context-window / token-count fields unchanged**. Do NOT zero them out — that would erase prior accumulated state on a partial event.
- When `payload.info` is present but `payload.rate_limits` is null/missing: fold `info` only; preserve prior `rate_limits` state.
- When both are present: fold both.

The rule is the same for any event in the rollout: a null sub-field is a partial update, not a reset signal.

### Field-by-field projection

| `AgentStatusEvent` field                                   | Source in rollout                                                                                                                                       | Note                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`                                               | `ctx.session_id` (PTY id)                                                                                                                               | Threaded through the parser.                                                                                                                                                                                                                                                                                         |
| `agent_session_id`                                         | `session_meta.id`                                                                                                                                       |                                                                                                                                                                                                                                                                                                                      |
| `model_id`                                                 | `turn_context.model` (latest)                                                                                                                           | E.g. `"gpt-5.4"`.                                                                                                                                                                                                                                                                                                    |
| `model_display_name`                                       | same as `model_id`                                                                                                                                      | Codex has no display_name field.                                                                                                                                                                                                                                                                                     |
| `version`                                                  | `session_meta.cli_version`                                                                                                                              | E.g. `"0.128.0"`.                                                                                                                                                                                                                                                                                                    |
| `context_window.context_window_size`                       | latest `event_msg.token_count.info.model_context_window`; fallback to latest `event_msg.task_started.model_context_window` if `info` hasn't arrived yet | Latest non-null source wins. `task_started` fallback covers the early window before the first `token_count.info`.                                                                                                                                                                                                    |
| `context_window.total_input_tokens`                        | `info.last_token_usage.input_tokens`                                                                                                                    | **NOT lifetime.** `last_token_usage` reflects the most recent API call's input — closest match for "what's currently in context", which is what `ContextBucket.tsx:80,90` renders as "CURRENT CONTEXT". `total_token_usage` is lifetime spend across all turns and would pin the gauge at 100% on long sessions.     |
| `context_window.total_output_tokens`                       | `info.last_token_usage.output_tokens`                                                                                                                   | Same reasoning — last turn's output, not lifetime.                                                                                                                                                                                                                                                                   |
| `context_window.used_percentage`                           | computed: `clamp(last_token_usage.total_tokens / context_window_size * 100, 0, 100)`                                                                    | `None` until first `token_count.info`. Uses `last_token_usage` (current-context approximation), not lifetime totals.                                                                                                                                                                                                 |
| `context_window.remaining_percentage`                      | `clamp(100 - used_percentage, 0, 100)`                                                                                                                  | Default `100.0` when no `token_count.info` yet.                                                                                                                                                                                                                                                                      |
| `context_window.current_usage.input_tokens`                | `info.last_token_usage.input_tokens`                                                                                                                    | Same source as `total_input_tokens`; redundant by design — both reflect "what was in context for the last API call".                                                                                                                                                                                                 |
| `context_window.current_usage.output_tokens`               | `info.last_token_usage.output_tokens`                                                                                                                   |                                                                                                                                                                                                                                                                                                                      |
| `context_window.current_usage.cache_creation_input_tokens` | always `0`                                                                                                                                              | Codex doesn't separate creation; report 0.                                                                                                                                                                                                                                                                           |
| `context_window.current_usage.cache_read_input_tokens`     | `info.last_token_usage.cached_input_tokens`                                                                                                             |                                                                                                                                                                                                                                                                                                                      |
| `cost.total_cost_usd`                                      | always `None`                                                                                                                                           | Q2a: IPC type changes to `Option<f64>`.                                                                                                                                                                                                                                                                              |
| `cost.total_duration_ms`                                   | sum of `event_msg.task_complete.duration_ms`                                                                                                            |                                                                                                                                                                                                                                                                                                                      |
| `cost.total_api_duration_ms`                               | always `0`                                                                                                                                              | Codex doesn't expose API-only timing. `BudgetMetrics.tsx:85` renders this as a distinct "API Time" cell, so aliasing total runtime here would print a wrong number to the user. Emitting `0` is the truthful v1 choice. A follow-up may bump the IPC to `Option<u64>` so the UI can render `"—"` instead of `"0ms"`. |
| `cost.total_lines_added` / `total_lines_removed`           | always `0`                                                                                                                                              | Frontend `ActivityFooter` sources from git-diff watcher (`AgentStatusPanel.tsx:104-105`); zeroes are harmless.                                                                                                                                                                                                       |
| `rate_limits.five_hour.used_percentage`                    | `token_count.rate_limits.primary.used_percent`                                                                                                          |                                                                                                                                                                                                                                                                                                                      |
| `rate_limits.five_hour.resets_at`                          | `token_count.rate_limits.primary.resets_at`                                                                                                             |                                                                                                                                                                                                                                                                                                                      |
| `rate_limits.seven_day`                                    | `token_count.rate_limits.secondary` mapped same way; `None` when absent                                                                                 |                                                                                                                                                                                                                                                                                                                      |

### Defaults before any `token_count` arrives

Brand-new codex session, only `session_meta` flushed:

- `model_id = "unknown"`, `version = ""` (mirrors Claude's missing-field defaults).
- `context_window` block defaults: `context_window_size: 0`, `used_percentage: None`, `remaining_percentage: 100.0`, `current_usage: None`, all token counts `0`.
- `cost` zeroed metrics with `total_cost_usd: None`.
- `rate_limits = { five_hour: { used_percentage: 0.0, resets_at: 0 }, seven_day: None }`.

### Codex-only fields dropped in v1

- `info.total_token_usage.reasoning_output_tokens` — exists in last_token_usage and total_token_usage; no slot in `AgentStatusEvent`. If a "Reasoning tokens" UI block is added, extend `CurrentUsage`.
- `rate_limits.plan_type` — `"prolite"`, `"plus"`, `"pro"`, `"team"`, etc. Could be a future "Plan: prolite" badge in the panel. v1 ignores.
- `rate_limits.credits` — observed `null` in our sessions; semantics unclear, defer.
- `turn_context.personality`, `turn_context.effort`, `turn_context.collaboration_mode` — codex-internal config.
- `task_complete.time_to_first_token_ms` — interesting metric, no UI slot today.

## IPC / Trait surface changes

### `CostMetrics.total_cost_usd: f64 → Option<f64>`

Rust:

```rust
pub struct CostMetrics {
    pub total_cost_usd: Option<f64>,   // was f64
    pub total_duration_ms: u64,
    pub total_api_duration_ms: u64,
    pub total_lines_added: u64,
    pub total_lines_removed: u64,
}
```

Serde behavior: `None` serializes to `null`. Do **not** add `#[serde(skip_serializing_if = "Option::is_none")]` — we want explicit `null` so the frontend can distinguish "agent doesn't expose cost" from "field accidentally omitted".

Frontend type override (mirrors the existing `AgentStatusEvent` override at `agent-status/types/index.ts:5-26`):

```typescript
// New override file or inline near existing override.
// Reason: ts-rs generates required fields, but Rust Option<T> serializes to null.
export interface CostMetrics {
  totalCostUsd: number | null
  totalDurationMs: number
  totalApiDurationMs: number
  totalLinesAdded: number
  totalLinesRemoved: number
}
```

`useAgentStatus.ts` cost-block normalization changes from:

```typescript
totalCostUsd: Number(p.cost.totalCostUsd),
```

to:

```typescript
totalCostUsd: p.cost.totalCostUsd ?? null,
```

`BudgetMetrics.tsx` adds null-handling: when `totalCostUsd === null`, render `"—"` (or hide the cost row, decided in implementation; spec pins "visible distinction from $0.00").

Claude's parser adapts: branches that previously returned `0.0` for missing-cost-block now return `None`. The "cost block present, `total_cost_usd` field missing" branch returns `Some(0.0)` (preserves "agent does expose cost, current value is 0").

### `AgentAdapter::status_source` becomes fallible

Detailed under "Architecture > Trait signature change" above.

### `ManagedSession.started_at: SystemTime` (prerequisite)

Add a field to `ManagedSession` at `src-tauri/src/terminal/state.rs:66`:

```rust
pub struct ManagedSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub cwd: String,
    pub generation: u64,
    pub ring: Arc<Mutex<RingBuffer>>,
    pub cancelled: Arc<AtomicBool>,
    pub started_at: SystemTime,    // NEW
}
```

Set at the spawn site (immediately before/after the construction of the read-loop task). Add `pub fn get_started_at(&self, session_id: &str) -> Option<SystemTime>` on `PtyState`.

`start_agent_watcher` (`src-tauri/src/agent/adapter/mod.rs:124-144`) builds the `BindContext` from `pty_state.get_cwd(sid)`, `pty_state.get_started_at(sid)`, and **the detected agent PID returned by `detect_agent(shell_pid)`** — _not_ `pty_state.get_pid(sid)` (which returns the shell PID). **Amended by `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`:** Codex's `logs.process_uuid` indexes by the codex child PID, not the shell PID at the PTY root, so binding with the shell PID would always return zero rows. The implementation extracts a `resolve_bind_inputs` helper that performs detection and threads the agent PID into `BindContext.pid`.

Backward-compatible: pure backend addition, no IPC bump.

### Frontend "no data yet" cosmetic

Pre-first-`token_count` codex sessions emit `used_percentage: None`. The frontend hook collapses null to `0` at `useAgentStatus.ts:335` (`p.contextWindow.usedPercentage ?? 0`), so the panel will show "0% used" for fresh codex sessions until the first turn completes. This matches Claude's behavior on equivalent boundary conditions and is acceptable for v1. A real "—" / "no data yet" state is a separate cleanup and not blocking.

### File touch list (step 1 only)

Backend (Rust):

- `src-tauri/src/agent/types.rs` — `CostMetrics.total_cost_usd: Option<f64>`.
- `src-tauri/src/agent/adapter/types.rs` — add `BindContext`, `BindError`.
  - _Post-2026-05-05: both types are deleted. `BindContext` lives privately in `agent/adapter/codex/types.rs`; `BindError` is gone (trait method returns `Result<_, String>`). See the [trait simplification spec](./2026-05-05-codex-adapter-trait-simplification-design.md).\_
- `src-tauri/src/agent/adapter/mod.rs` — trait sig update; `start_for` retry on Pending; `start_agent_watcher` builds `BindContext` from `PtyState`.
  - _Post-2026-05-05 mechanics differ; see [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](./2026-05-05-codex-adapter-trait-simplification-design.md)._
- `src-tauri/src/agent/adapter/base/mod.rs` — `start_for` retry loop, error propagation.
  - _Post-2026-05-05 mechanics differ; the retry moves into `CodexAdapter`. See the [trait simplification spec](./2026-05-05-codex-adapter-trait-simplification-design.md)._
- `src-tauri/src/agent/adapter/claude_code/mod.rs` — `status_source` impl signature update (still infallible Ok).
- `src-tauri/src/agent/adapter/claude_code/statusline.rs` — `parse_cost_metrics` returns `Option<f64>` for missing cost block.
- `src-tauri/src/agent/adapter/codex/mod.rs` — new: `CodexAdapter` impl.
- `src-tauri/src/agent/adapter/codex/locator.rs` — new: `CodexSessionLocator`, `SqliteFirstLocator`, `FsScanFallback`, `CodexDbDiscovery`.
- `src-tauri/src/agent/adapter/codex/parser.rs` — new: `parse_rollout`, `CodexFoldState`.
- `src-tauri/src/agent/adapter/codex/transcript.rs` — new (stub): `validate_transcript` and `tail_transcript` return v1-stub error.
- `src-tauri/src/terminal/state.rs` — `ManagedSession.started_at`, spawn-time set, `PtyState::get_started_at`.
- `src-tauri/Cargo.toml` — add `rusqlite` (read-only feature, bundled or system-linked decided in implementation).

Frontend (TS):

- `src/bindings/CostMetrics.ts` — regenerated with `totalCostUsd: number` (still). Real shape comes from override.
- `src/features/agent-status/types/index.ts` — add CostMetrics override.
- `src/features/agent-status/hooks/useAgentStatus.ts` — preserve null through state.
- `src/features/agent-status/components/BudgetMetrics.tsx` — render null state visibly distinct from `$0.00`.
- `src/features/agent-status/components/BudgetMetrics.test.tsx` — null case.

## Step 2 — Refactor follow-up criteria

Step 2 is a deferred, separate work item that decides what (if anything) to promote out of Claude-private and Codex-private parser internals into shared adapter-level helpers.

### Triggers — when to do it

Step 2 is initiated when ALL of:

1. Both adapters have been in production for ≥1 week with real-world signal accumulating (parser bugs, edge cases observed).
2. Repeated, non-trivial cross-adapter duplication exists at multiple call sites — OR — a shared helper would clearly reduce drift/risk in both parsers. (The bar is "the abstraction proves useful", not surface similarity.)
3. No active feature work in either parser. Refactor in stable code, not while one parser is changing daily.

If any of these is false, step 2 stays deferred.

### Constraints

Direct quotes from `docs/decisions/2026-05-03-claude-parser-json-boundary.md`:

- Parser flow continues to read in domain language (`bash_command(item)`, `total_input_tokens(value)`). The refactor must not turn parser flow into `json::str_at`-call chains.
- 1–2 nested reads stay explicit `.get().and_then(...)`. Don't rewrite shallow access just to use the shared module.
- A helper moves to a shared module only when ≥2 adapters demonstrably need it. Single-use helpers stay private.

### Likely scope (predictions, not commitments)

Probable shared helpers, in increasing confidence:

- `clamp_percentage(value: f64) -> f64` — both parsers clamp to `[0, 100]`.
- `value_at(value: &Value, path: &[&str]) -> Option<&Value>` — both have ≥3-deep nested reads.
- `u64_or` / `f64_or` — both extract numerics with defaults.

Unlikely to share:

- Domain extractors (`total_input_tokens`, `latest_token_count`, etc.) — domain-specific by definition.
- Cost handling — Codex returns `None` always; Claude has `Some(x)` paths.
- Rate-limit window mapping — Claude reads `five_hour`/`seven_day` keys directly; Codex maps `primary`/`secondary` and inspects `window_minutes`.

### Non-goals for step 2 (explicit)

- No unified intermediate-state `AgentSnapshot` trait/struct. Adapters fold to `AgentStatusEvent` directly. Intermediate shape stays private to each adapter.
- No shared `Adapter::Parser` trait specialization. `parse_status` stays the only seam.
- No frontend changes. Step 2 is backend-internal; IPC contract is stable.

### Process

1. Read both parsers fresh. List byte-similar fragments and conceptually-similar fragments.
2. For each, evaluate against the "stay private until reuse demonstrated" rule and the constraints above.
3. Promote one helper at a time, one commit each. Each promotion includes a regression test in both adapters.
4. Record decisions in a new ADR (e.g. `docs/decisions/YYYY-MM-DD-shared-adapter-json-helpers.md`), not as an addendum to the 2026-05-03 ADR. The 2026-05-03 ADR is explicitly scoped to Claude internals and decided not to decide cross-adapter structure; step 2's work is a fresh cross-adapter decision and gets its own file.

## Testing strategy

### Rust unit tests

`codex/parser.rs`:

- Empty rollout (only `session_meta`) → all defaults; `model_id = "unknown"`.
- Single complete turn (`session_meta` + `turn_context` + `task_started` + `token_count` + `task_complete`) → expected `AgentStatusEvent` field-by-field; context-window fields driven by `last_token_usage`, NOT `total_token_usage`.
- Multiple turns → `total_duration_ms` is the sum; latest `token_count.info` wins for context fields; `total_api_duration_ms` stays `0`.
- **Long-running session regression** — replay a rollout where `total_token_usage.total_tokens > model_context_window` (lifetime exceeds context size); assert `used_percentage` reflects `last_token_usage`-derived percentage, not 100%. Pins the fix for issue #1.
- `seven_day = null` in `rate_limits` → `seven_day: None`.
- `used_percentage` clamped to `[0, 100]` when computed token ratio overshoots.
- **`token_count.info = null`** → rate_limits absorbed; context-window/token fields unchanged from prior state. Pins the partial-update rule. Fixture `rollout-info-null.jsonl` covers this case explicitly.
- **`token_count.rate_limits = null`** (or missing) with `info` present → context-window absorbed; rate_limits unchanged from prior state.
- **`context_window_size` fallback** — rollout with `task_started.model_context_window` present but no `token_count.info` yet → `context_window_size` resolves to the `task_started` value.
- Incomplete trailing line (no terminating `\n`) → silently dropped; parser succeeds; no warn log.
- Malformed non-final line (line ends in `\n` but not valid JSON) → `warn!` emitted; line skipped; subsequent lines parsed normally.
- Unknown event types (forward-compat) → ignored without warn.

`codex/locator.rs` (using temp `~/.codex` dirs and rusqlite for DB construction):

- DB discovery picks the candidate file whose schema contains the target table; `*.sqlite-wal` / `*.sqlite-shm` are skipped.
- When multiple candidates contain the table: highest numeric suffix wins; newest mtime breaks suffix ties.
- `logs` query returns newest `thread_id` for the codex pid since `pty_start`. PID-only matches below `pty_start` are filtered out.
- `state` query: `thread_id → (rollout_path, cwd, updated_at_ms)` round trips.
- Cold-start race: SQLite query returns 0 rows → `LocatorError::NotYetReady`; row appears mid-retry → resolves Ok on subsequent call.
- Schema drift: target table missing from all candidates → discovery returns `Ok(None)`; locator dispatches to FS fallback (does NOT return Fatal).
- **FS fallback zero matches → `NotYetReady`** (not Fatal). Locking the algorithm rule at line ~328: an empty `~/.codex/sessions/YYYY/MM/DD/` directory or zero rollouts past the `pty_start`/cwd filter is transient — the codex process simply hasn't written its first event yet. `start_for`'s retry budget covers the wait.
- **FS fallback I/O error → `LocatorError::Fatal`.** Permission denied on `~/.codex/sessions`, an unreadable rollout file, or any non-retryable filesystem error during the scan. This is the only path through the FS fallback that emits Fatal.
- **SQLite I/O error → `LocatorError::Fatal`.** Open errors that aren't `NoSuchTable` (e.g. permission denied, corrupt DB) bypass schema-drift handling and surface as Fatal directly.

`codex/mod.rs` (`CodexAdapter` impl):

- `status_source(ctx)` happy path returns `Ok(StatusSource { path: rollout_path, trust_root: ~/.codex })`.
- `status_source(ctx)` maps `LocatorError::NotYetReady` → `BindError::Pending`.
- `status_source(ctx)` maps `LocatorError::Unresolved | Fatal` → `BindError::Fatal`.
- `parse_status` delegates to parser; `transcript_path` always `None` for v1.
- `validate_transcript` returns `Err(ValidateTranscriptError::Other("codex transcript tailer not yet implemented"))` — explicit v1 stub, asserted in test.
- `tail_transcript` returns the same shaped `Err`. Never invoked in production because `parse_status` emits `transcript_path: None`, but the no-op behavior is pinned by test.

`agent/adapter/mod.rs` (orchestration changes):

- `start_for` retries up to budget on `BindError::Pending` (test with a controllable `MockAdapter` that flips Pending → Ok after N polls).
- Total retry wall-clock < `DETECTION_POLL_MS / 2` (asserted via `Instant::now()`).
- `BindError::Fatal` returns immediately; no retry.
- `start_for` propagates `Err(String)` to caller; no event emitted.
- Claude's `ClaudeCodeAdapter::status_source(ctx)` ignores `pid`/`pty_start`, always Ok — pinned by existing tests adapted to new sig.
- `NoOpAdapter::status_source(ctx)` likewise.

`terminal/state.rs` (`ManagedSession.started_at`):

- Spawn → `started_at <= now()` and `> test_start`.
- `get_started_at(sid)` returns Some after spawn; None for unknown sid.
- Generation counter unaffected.

### Rust integration tests with fixtures

Add `src-tauri/tests/fixtures/codex/`:

- `rollout-minimal.jsonl` — ≤5 lines, 1 turn.
- `rollout-multi-turn.jsonl` — ≥30 lines, 5+ turns; mix of events with `seven_day` present and absent.
- `rollout-long-session.jsonl` — accumulated `total_token_usage.total_tokens` exceeds `model_context_window`; pins the issue-#1 regression that the gauge is driven by `last_token_usage`, not lifetime totals.
- `rollout-info-null.jsonl` — at least one `event_msg.token_count` event with `payload.info: null`; pins the partial-update rule.
- `rollout-incomplete-trail.jsonl` — last line missing terminating `\n`.
- `rollout-malformed-mid.jsonl` — one bad-JSON line surrounded by valid lines.

Tests load each fixture, run `parse_rollout`, and assert the resulting `AgentStatusEvent` against a committed expected-output snapshot.

### Frontend tests (Vitest)

`BudgetMetrics.test.tsx`:

- `totalCostUsd: null` → cost row dimmed/hidden (final visual decided in implementation; test pins the chosen behavior).
- `totalCostUsd: 0.42` → existing rendering unchanged (regression).

`useAgentStatus.test.tsx`:

- Event with `cost.totalCostUsd === null` → state preserves `null` (does NOT coerce to `0`).
- Event with `cost.totalCostUsd === 0.42` → state holds `0.42` (regression).

`AgentStatusPanel.test.tsx`:

- `agentType: 'codex'` + null `totalCostUsd` → panel renders without crash; activity feed empty (transcript stub); rate-limits visible.

### Manual verification (dev-time, end of step 1 sign-off)

1. `npm run tauri dev`, open a terminal in the app.
2. Run `codex` in the PTY → wait one turn → status bar shows model `gpt-5.4` (or whichever the user's default is), context window populated, rate limits visible, cost row dimmed/hidden.
3. Exit codex (`/exit`), spawn fresh terminal, run `codex resume --last` → status bar populates within ~1s with accumulated tokens from the prior session (the replay path).
4. Run `claude` in another terminal → Claude session unaffected, cost row shows `$x.xx` as before (no regression on Claude's path).

### Coverage target

- Per project standard (`rules/CLAUDE.md`): 80% minimum on new code.
- Locator + parser are highest-risk new surface — target ≥90% on both.

## Open Questions

None blocking. Items to revisit during implementation:

- Final visual treatment for `BudgetMetrics` when `totalCostUsd === null` — dim the row vs. hide it vs. show "—". Decided in PR with screenshots.
- Whether `total_api_duration_ms` should be bumped to `Option<u64>` so the UI can render "—" for codex sessions instead of `"0ms"`. v1 emits `0` (the truthful answer per the field projection table) and the UI's "API Time" cell will read `0ms` for codex; if testers find that distracting, the IPC bump is straightforward and is tracked as a follow-up.

## References

- `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md` — Stage 1 spec (the abstraction this work targets).
- `docs/decisions/2026-05-03-claude-parser-json-boundary.md` — ADR that defers cross-adapter helper promotion.
- `src-tauri/src/agent/adapter/mod.rs` — `AgentAdapter` trait; `start_agent_watcher` command.
- `src-tauri/src/agent/adapter/base/watcher_runtime.rs` — inline-init read flow at lines 361-409; debounce + polling fallback.
- `src-tauri/src/agent/adapter/claude_code/statusline.rs` — Claude parser; mirror for the Codex parser shape.
- `src-tauri/src/agent/detector.rs:140` — `codex` binary detection.
- `src-tauri/src/terminal/state.rs:66` — `ManagedSession`; `started_at` lands here.
- `src/features/agent-status/types/index.ts:5-26` — existing `AgentStatusEvent` override pattern; the `CostMetrics` override mirrors it.
- `src/features/agent-status/hooks/useAgentStatus.ts:19, 335` — `DETECTION_POLL_MS` constant; current `usedPercentage ?? 0` collapse.
- `src/features/agent-status/components/AgentStatusPanel.tsx:104-105` — `linesAdded`/`linesRemoved` sourced from git-diff, not from `cost.*`.
