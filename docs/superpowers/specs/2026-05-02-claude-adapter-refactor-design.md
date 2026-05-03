# Agent Adapter Abstraction — Stage 1: Claude Refactor

**Date:** 2026-05-02
**Status:** Draft, ready for review
**Scope:** Pure refactor. No behavioral change.
**Stage 2 (separate spec):** `CodexAdapter` implementation against the abstraction landed here.

---

## Context

Today, every layer of agent activity in the backend is hardcoded to Claude Code:

- `src-tauri/src/agent/statusline.rs` parses Claude's `status.json` schema.
- `src-tauri/src/agent/transcript.rs` parses Claude's JSONL with Anthropic `tool_use` / `tool_result` blocks and validates paths against `~/.claude` (`transcript.rs:38`).
- `src-tauri/src/agent/watcher.rs` directly imports `parse_statusline` and `validate_transcript_path` (`watcher.rs:16-17`) and hardcodes the status-file location to `<cwd>/.vimeflow/sessions/<sid>/status.json` (`watcher.rs:661-665`) — a location that exists only because Vimeflow's own `statusline.sh` writes there for Claude.
- `src-tauri/src/agent/test_runners/` is invoked from `transcript.rs:421` and reads Anthropic-shaped `tool_use.input.command` payloads.

Detection is the only layer that is already polymorphic: `detector.rs:138-143` matches `claude` / `codex` / `aider` cmdlines and returns the appropriate `AgentType`. Detection works for Codex _today_ — every downstream consumer assumes the agent is Claude.

We want to add support for additional CLI agents (starting with Codex CLI) without rewriting the watcher orchestration each time. The first step is to introduce a clean abstraction _while only one provider exists_, so that adding the second provider in Stage 2 is purely additive.

## Goal

Introduce an `AgentAdapter` trait that owns the entire watcher pipeline as a deep module (per `rules/common/design-philosophy.md`), and migrate the existing Claude Code logic behind it as `ClaudeCodeAdapter`. After this work, every Claude Code event payload, file watcher, transcript tail thread, debounce timing, and Tauri-emitted event must be byte-identical to today.

## Non-Goals

- **No `CodexAdapter`.** That is Stage 2 in a separate spec.
- **No frontend contract changes.** `AgentStatusEvent` / `AgentToolCallEvent` / `AgentTurnEvent` IPC payloads stay byte-identical. The Tauri command surface narrows by two — `start_transcript_watcher` and `stop_transcript_watcher` are removed — which forces exactly one frontend deletion: the `invoke('stop_transcript_watcher', …)` call in `useAgentStatus.ts:53-58`. That's the only `useAgentStatus.ts` edit; no React state, no event handling, no rendering changes.
- **No behavioral change.** Debounce intervals, polling fallback (3s), transcript-path validation rules, the Anthropic JSONL parser, the WSL2 race fix, the `EventTiming` / `PathHistory` diagnostic logging — all preserved.
- **No simultaneous file-size cleanup.** `transcript.rs` is currently 1349 lines (over the 800 budget in `rules/CLAUDE.md`). The Stage 1 work _moves_ it but does not split it. Splitting is C-scope tech debt, called out in "Open Questions".
- **No new Tauri commands.** The IPC surface narrows (see "Tauri Command Surface"); no commands are added.

## Behavioral Invariants (the contract Stage 1 must preserve)

The reviewer should be able to verify these without running the code:

1. The status-file path resolved by `start_agent_watcher` for a Claude PTY remains `<cwd>/.vimeflow/sessions/<sid>/status.json`.
2. `validate_transcript_path` for Claude still rejects paths outside `~/.claude` (`transcript.rs:47-52` test at `transcript.rs:962-974`).
3. The `agent-status`, `agent-tool-call`, `agent-turn`, and `test-run` Tauri events emit identical payloads in identical order for the same input.
4. Debounce remains 100ms (`watcher.rs:430`); polling fallback remains 3s (`watcher.rs:575`).
5. `TxOutcome` labels remain stable (logged via `record_event_diag`) — these are observable in `Vimeflow.log`.
6. The `inline-init` → `notify` → `poll-fallback` source taxonomy in diagnostic logs remains intact, including the shared `PathHistory` semantics that detect speculative→resolved path flips across sources.
7. `TestRunEmitter::finish_replay` is still called exactly once on the first EOF of the transcript tail loop (`transcript.rs:301`).
8. Existing tests pass unchanged. Specifically:
   - All `#[cfg(test)]` blocks in `agent/statusline.rs`, `agent/transcript.rs`, `agent/watcher.rs`, `agent/detector.rs`, `agent/test_runners/*`.
   - All integration tests under `src-tauri/tests/transcript_*`.

A passing test suite plus matching `Vimeflow.log` lines for a representative Claude session is the acceptance bar.

## Architecture

### One deep module: `AgentAdapter`

```
┌──────────────────────────────────────────────────────────┐
│            Tauri command (`start_agent_watcher`)         │
│                                                          │
│   let adapter = <dyn AgentAdapter>::for_type(t)?;        │
│   adapter.start(app, sid, cwd, watcher_state)?;          │
└────────────────────┬─────────────────────────────────────┘
                     │  one call, no orchestration leakage
                     ▼
┌──────────────────────────────────────────────────────────┐
│   trait AgentAdapter (Send + Sync + 'static)             │
│                                                          │
│   PROVIDER HOOKS (each impl fills these in):             │
│     fn agent_type(&self) -> AgentType                    │
│     fn status_source(&self, cwd, sid) -> StatusSource    │
│     fn parse_status(&self, sid, raw)                     │
│         -> Result<ParsedStatus, String>                  │
│     fn validate_transcript(&self, raw_path)              │
│         -> Result<PathBuf, String>                       │
│     fn tail_transcript(&self, app, sid, cwd, path)       │
│         -> Result<TranscriptHandle, String>              │
│     // ↑ adapter OWNS the tail loop incl. TestRunEmitter │
└──────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│   impl dyn AgentAdapter  (USER-FACING SURFACE)           │
│     fn for_type(t: AgentType) -> Result<Arc<Self>, …>    │
│     fn start(self: Arc<Self>, …) -> Result<…> {          │
│         base::start_for(self, …)                         │
│     }                                                    │
│     fn stop(state, sid) -> bool { state.remove(sid) }    │
└────────────────────┬─────────────────────────────────────┘
                     │  delegates to private orchestrator
                     ▼
┌──────────────────────────────────────────────────────────┐
│   adapter::base  (PRIVATE — pub(crate) at most)          │
│     fn start_for(adapter: Arc<dyn AgentAdapter>, …)      │
│   — debounce + notify watcher                            │
│   — WSL2 polling fallback                                │
│   — inline-init read                                     │
│   — TranscriptState lifecycle                            │
│   — EventTiming + PathHistory diagnostics                │
│   — TxOutcome classification                             │
│   Calls hooks via `adapter.parse_status(...)` etc.       │
└──────────────────────────────────────────────────────────┘
```

The trait is the deep-module facade; `base.rs` is the body. From **production** code outside the `agent::adapter` module, only `AgentAdapter::for_type(...)`, `.start(...)`, `.stop(...)`, and `.agent_type(...)` are part of the user-facing surface — Tauri commands and any future production caller use only these. Test infrastructure (`TranscriptState`, `TranscriptHandle`, `TranscriptStartStatus`) stays `pub` at `adapter::base::*` so the four `tests/transcript_*.rs` integration tests continue driving the tailer directly; that surface is `#[doc(hidden)]` and carries a doc-comment forbidding production use (Codex review Finding 2). Everything else — debounce timing, polling fallback details, JSONL tailing, in-flight tool-call tracking, `TxOutcome`/`EventTiming`/`PathHistory` diagnostics — is genuinely private.

### Rust shape: provider-hook trait + inherent impl on `dyn` + private free helper

#### IDEA — Why this dispatch shape

- **Intent:** Match the user-facing concept (template-method "BaseAdapter") to the Rust idiom that gives the smallest public surface. The trait carries only provider hooks; the user-facing `start` / `stop` live in `impl dyn AgentAdapter` so they're callable on `Arc<dyn AgentAdapter>` without `where Self: Sized`. The orchestration body lives in `pub(crate) fn base::start_for(adapter: Arc<dyn AgentAdapter>, …)` because Rust default trait methods cannot own per-instance mutable state and cannot be called through a trait object when constrained to `Sized`.
- **Danger:** A reader sees `adapter.start(...)` resolve through the inherent `impl dyn AgentAdapter` block and wonders why both a trait and an inherent block exist. Mitigation: a top-of-file docstring in `adapter/mod.rs` explains the split — _trait holds provider hooks, inherent block holds the user-facing `start` / `stop`, free fn `base::start_for` holds the orchestration body_. The free fn is `pub(crate)` only.
- **Explain:** This is the idiomatic Rust expression of the user's "BaseAdapter with template-method behavior." `impl dyn Trait` (an inherent impl on the trait object) is real Rust syntax (stable since 2018) and is exactly the right tool when you want methods that are callable through a trait object but whose body is shared across all concrete impls. It's how `std::error::Error::source` and friends compose in practice.
- **Alternatives considered:**
  - **Default trait method `fn start(self: Arc<Self>, …) where Self: Sized`.** Rejected — the `Sized` clause makes it uncallable through `Arc<dyn AgentAdapter>`, forcing the factory to return concrete types and breaking polymorphic dispatch.
  - **`struct AgentAdapterHandle(Arc<dyn AgentAdapter>)` wrapper with `impl AgentAdapterHandle { fn start(...) }`.** Rejected — adds an extra wrapping type whose only purpose is to host methods. `impl dyn AgentAdapter` does the same job without the extra type name.
  - **Free fn `agent::adapter::start_pipeline(adapter: Arc<dyn AgentAdapter>, …)`.** Rejected — leaks orchestration into the call site at the Tauri command (caller has to know to call the free fn, not a method). The deep-module property requires the user-facing operation to be `adapter.start(...)`, not `mod::start_pipeline(adapter, ...)`.
  - **Enum dispatch `enum AgentAdapter { ClaudeCode(Arc<ClaudeCodeAdapter>), Codex(...) }`.** Rejected — works but forces every new agent to grow a `match` arm in `start`, `stop`, and every other dispatched method. The trait-object approach localizes the dispatch to one factory site; new agents add an `impl AgentAdapter for NewAdapter` block and one factory `match` arm, no scattered match growth.
  - **Storing orchestration state on `ClaudeCodeAdapter` (fields).** Rejected — watcher state is per-PTY-session, not per-adapter; binding it to the adapter would force one adapter instance per session and regress today's stateless adapter semantics.

### File / module layout — old → new

```
BEFORE                                AFTER
──────                                ─────
agent/                                agent/
├── mod.rs                            ├── mod.rs
├── commands.rs                       ├── commands.rs        (unchanged)
├── detector.rs                       ├── detector.rs        (unchanged)
├── types.rs                          ├── types.rs           (IPC contract; unchanged)
├── statusline.rs       ─────► moved  ├── adapter/
├── transcript.rs       ─────► moved  │   ├── mod.rs         (NEW: trait + factory)
├── test_runners/       ─────► moved  │   ├── base.rs        (NEW: orchestration body)
└── watcher.rs          ─────► gone   │   ├── types.rs       (NEW: provider-hook types)
                                      │   └── claude_code/
                                      │       ├── mod.rs     (NEW: ClaudeCodeAdapter impl)
                                      │       ├── statusline.rs  (was agent/statusline.rs)
                                      │       ├── transcript.rs  (was agent/transcript.rs)
                                      │       └── test_runners/  (was agent/test_runners/)
```

`agent/watcher.rs` is deleted. Every line of its body either (a) lives in `agent/adapter/base.rs` generic over the trait or (b) becomes a method on `ClaudeCodeAdapter` because it was Claude-specific (e.g. the `validate_transcript_path` call site).

`agent/mod.rs` re-exports change:

```rust
// before
pub use commands::detect_agent_in_session;
pub use transcript::{start_transcript_watcher, stop_transcript_watcher, TranscriptState};
pub use watcher::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};

// after
pub use adapter::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};
pub use commands::detect_agent_in_session;
// TranscriptState becomes private to adapter::base (no longer Tauri-managed)
// start/stop_transcript_watcher commands deleted (see Tauri Command Surface)
```

## Trait Surface

### Public methods

The trait carries **only provider hooks** (no default method bodies). The `start` / `stop` user-facing methods are defined as **inherent methods on `dyn AgentAdapter`** so callers receive `Arc<dyn AgentAdapter>` from the factory and use `.start(...)` directly. Default trait methods with `where Self: Sized` were rejected because they cannot be called through a trait object — see the IDEA block below.

```rust
pub trait AgentAdapter: Send + Sync + 'static {
    /// Which agent this adapter represents.
    fn agent_type(&self) -> AgentType;

    /// Where this agent writes its status snapshot.
    /// Claude returns `<cwd>/.vimeflow/sessions/<sid>/status.json`.
    /// Codex (Stage 2) will return its rollout JSONL path resolved
    /// via `~/.codex/state_5.sqlite`.
    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource;

    /// Parse one snapshot of the status source. Returns the typed event
    /// plus the transcript path to start tailing (if any).
    fn parse_status(
        &self,
        session_id: &str,
        raw: &str,
    ) -> Result<ParsedStatus, String>;

    /// Validate a transcript path against this provider's trust root.
    /// Claude rejects paths outside `~/.claude`; future providers reject
    /// paths outside their own session directories.
    /// MUST canonicalize and reject symlinks-out via `fs::canonicalize`.
    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, String>;

    /// Tail this provider's transcript and emit Tauri events as new
    /// lines arrive. The adapter owns the tail loop end-to-end —
    /// including in-flight tool-call tracking, turn counting, and
    /// the replay-aware `TestRunEmitter` lifecycle (buffer during
    /// initial catch-up read, flush latest snapshot on first EOF,
    /// emit live thereafter). Returns a handle whose `Drop` signals
    /// stop and joins the tail thread.
    ///
    /// Why this is per-adapter rather than a shared loop: today's
    /// transcript parser at `transcript.rs:269-325` carries
    /// `process_line(line, sid, cwd, app, &mut emitter, &mut in_flight,
    /// &mut num_turns)` — seven arguments wired to a stateful
    /// `TestRunEmitter` whose contract (`emitter.submit(...)` during
    /// replay, `emitter.finish_replay()` at first EOF) is intrinsic
    /// to the parsing logic. Splitting parser from tail loop would
    /// either leak the emitter into the trait surface or force a
    /// heavyweight per-line callback contract that buys nothing
    /// because Codex's rollout-JSONL parser will be structurally
    /// different anyway (one file is both status + transcript, no
    /// `~/.claude` jail, distinct tool-result schema).
    fn tail_transcript(
        &self,
        app: AppHandle,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}

// ─── User-facing surface — inherent methods on the trait object ──────
//
// `impl dyn Trait` lets `start` / `stop` be called on `Arc<dyn AgentAdapter>`
// without the `where Self: Sized` clause that would block dyn dispatch.
// Bodies delegate to the private `base::*` helpers where the orchestration
// lives (Rust trait default methods cannot own per-watcher mutable state,
// so the body has to live in a free fn that accepts `Arc<dyn AgentAdapter>`).

impl dyn AgentAdapter {
    /// Start the watcher pipeline for this session. Owns the full
    /// lifecycle: removes any pre-existing handle for `session_id`,
    /// logs the active-watcher count, builds the new pipeline, and
    /// inserts the resulting `WatcherHandle` into `state`. The Tauri
    /// command does not interact with `state` directly — that's the
    /// "deep module" property: one call replaces the entire current
    /// `start_agent_watcher` body's state-management dance
    /// (`watcher.rs:680-697`).
    ///
    /// Returns `Ok(())` on success. The watcher runs until either
    /// `stop` is called or the matching `WatcherHandle` is dropped
    /// from `state` (e.g. by a subsequent `start` for the same sid).
    pub fn start(
        self: Arc<Self>,
        app: AppHandle,
        session_id: String,
        cwd: PathBuf,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        crate::agent::adapter::base::start_for(self, app, session_id, cwd, state)
    }

    /// Stop the watcher pipeline for this session. Returns `true`
    /// when a handle was removed, `false` when no watcher was
    /// running for the sid.
    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }
}
```

### Provider-hook types (`adapter/types.rs`)

```rust
pub struct StatusSource {
    /// Filesystem path to watch.
    pub path: PathBuf,
    /// Trust root the path must canonicalize under (defense-in-depth
    /// against path traversal from a misconfigured cwd).
    pub trust_root: PathBuf,
}

pub struct ParsedStatus {
    pub event: AgentStatusEvent,
    /// Transcript path the next layer should validate + tail. None means
    /// "no transcript available yet" (e.g. Claude hasn't written one).
    pub transcript_path: Option<String>,
}

// (No `TranscriptContext` / `TranscriptEffect` types — Codex review
//  Finding 3 surfaced that decomposing transcript parsing into a
//  per-line trait method would either leak `TestRunEmitter` /
//  `in_flight` / `num_turns` into the trait surface or force a
//  per-line callback contract that buys nothing (Codex's rollout
//  JSONL is structurally different from Claude's transcript). Each
//  adapter therefore owns its tail loop end-to-end via
//  `tail_transcript`, returning a `TranscriptHandle` to the base
//  layer for lifecycle management only.)
```

### Shared parse primitives (`adapter/json.rs`)

Today's `statusline.rs` repeats the same JSON-extraction pattern ~30 times across `parse_context_window` / `parse_cost_metrics` / `parse_rate_limits`:

```rust
let total_input_tokens = cw.get("total_input_tokens")
    .and_then(|v| v.as_u64())
    .unwrap_or(0);
```

Codex's adapter (Stage 2) would either duplicate that pattern or invent a slightly different one — both are bad. Stage 1 introduces a single generic-extraction module used by every adapter's parser:

```rust
// agent/adapter/json.rs

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

/// Walk a path from the root, returning the value at the leaf if every
/// hop exists. The path is a slice of `&str` keys; arrays are not in
/// scope (no adapter parses array-keyed status today).
pub fn navigate<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(v, |acc, key| acc.get(*key))
}

/// Generic typed extraction. Calls `navigate` then deserializes via
/// serde. Use this when the leaf shape is non-trivial (a nested struct).
pub fn extract<T: DeserializeOwned>(v: &Value, path: &[&str]) -> Option<T> {
    let leaf = navigate(v, path)?;
    serde_json::from_value(leaf.clone()).ok()
}

/// Typed scalar accessors — skip the serde round-trip for hot paths
/// (status events fire ~10/s under load). Each is a one-liner over
/// `navigate` + `serde_json::Value::as_*`.
pub fn u64_at(v: &Value, path: &[&str]) -> Option<u64> {
    navigate(v, path).and_then(Value::as_u64)
}

pub fn f64_at(v: &Value, path: &[&str]) -> Option<f64> {
    navigate(v, path).and_then(Value::as_f64)
}

pub fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    navigate(v, path).and_then(Value::as_str)
}

pub fn obj_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Map<String, Value>> {
    navigate(v, path).and_then(Value::as_object)
}

/// Convenience for the dominant pattern: "extract or fall back to default".
pub fn u64_or(v: &Value, path: &[&str], default: u64) -> u64 {
    u64_at(v, path).unwrap_or(default)
}

pub fn f64_or(v: &Value, path: &[&str], default: f64) -> f64 {
    f64_at(v, path).unwrap_or(default)
}

pub fn str_or<'a>(v: &'a Value, path: &[&str], default: &'a str) -> &'a str {
    str_at(v, path).unwrap_or(default)
}
```

After step 6 of the migration, `claude_code/statusline.rs::parse_context_window` collapses from:

```rust
let total_input_tokens = cw.get("total_input_tokens")
    .and_then(|v| v.as_u64()).unwrap_or(0);
let total_output_tokens = cw.get("total_output_tokens")
    .and_then(|v| v.as_u64()).unwrap_or(0);
let context_window_size = cw.get("context_window_size")
    .and_then(|v| v.as_u64()).unwrap_or(0);
// ... 4 more like this
```

to:

```rust
use crate::agent::adapter::json;

let total_input_tokens = json::u64_or(&value, &["context_window", "total_input_tokens"], 0);
let total_output_tokens = json::u64_or(&value, &["context_window", "total_output_tokens"], 0);
let context_window_size = json::u64_or(&value, &["context_window", "context_window_size"], 0);
```

Stage 2's `codex/rollout.rs` consumes the **same primitives**, just with different paths into Codex's structure:

```rust
let total_tokens = json::u64_or(&v,
    &["payload", "info", "total_token_usage", "total_tokens"], 0);
let context_window = json::u64_or(&v,
    &["payload", "info", "model_context_window"], 0);
let primary_used = json::f64_or(&v,
    &["payload", "rate_limits", "primary", "used_percent"], 0.0);
```

#### IDEA — Generic primitives as free fns vs. extraction methods on the trait

- **Intent:** The user-facing concern was "the parse should be generic, not tightly coupled to specific operations." Two design choices satisfy that:
  1. **Free fns in `adapter::json`** (chosen). Every adapter's parser internals consume `json::u64_or` etc. The trait surface stays narrow (one `parse_status` method per adapter); the deduplication is below the trait line.
  2. **Decomposed extraction hooks on the trait** (rejected for Stage 1). Trait methods like `extract_context_window(&self, root) -> ContextWindowStatus`, with a default `parse_status` composing them. Forces every adapter to provide a value (or default) per logical group, harder to silently drop a field.
- **Danger:** Free fns leave it to each adapter's discipline to actually USE them (an adapter could re-roll its own boilerplate). Mitigation: a CI-time grep / clippy-lint can flag direct `.and_then(|v| v.as_u64())` patterns inside `adapter/*/`. Easier: the spec includes a "no in-line `.and_then(|v| v.as_*())` chains in adapter parsers" item in the migration checklist for steps 6 and 7.
- **Explain:** Stage 1's deep-module property comes from `AgentAdapter`. Adding more trait methods (option 2) widens the trait surface for an internal concern (parser dedup). The free-fn primitives deliver the same dedup benefit without growing the public abstraction. If Stage 2 reveals that adapters _consistently_ want to override individual sub-extractions (e.g. Codex needs a different `extract_model_id` policy than Claude across multiple snapshot types), then promoting these to trait methods becomes warranted — but that's evidence-driven evolution, not speculative widening today.
- **Alternatives considered:**
  - Builder API (`Json::from(v).at("a").at("b").as_u64()`). Rejected — extra type for a one-call-per-field pattern; the slice-of-keys form composes more naturally with `const` paths.
  - `serde_path_to_error` or `jsonpath_lib` crate dependencies. Rejected — both are heavier than the ~50-line module above and obscure where the actual schema differences are. House-grown is small enough to read in one screen.

### Visibility of orchestration-internal types

These currently live in `watcher.rs` and `transcript.rs`. They move into `adapter/base.rs` and split by visibility:

**Private** (truly internal — never reached from outside `agent::adapter::base`):

- `TxOutcome` — log classification for `record_event_diag`.
- `EventTiming` — per-source timing state.
- `PathHistory` — speculative→resolved transcript-path tracking.

**Crate-internal infrastructure with `pub` visibility, kept reachable for integration tests** (Codex review Finding 2):

- `WatcherHandle` — opaque externally but stays `pub` so `AgentWatcherState` can store it.
- `TranscriptState`, `TranscriptHandle`, `TranscriptStartStatus` — stay `pub` at `agent::adapter::base::*`. They are not part of the user-facing IPC surface (Tauri commands don't take or return them), but four integration tests under `src-tauri/tests/transcript_*` import `TranscriptState` directly to drive the tailer end-to-end (e.g. `tests/transcript_vitest_e2e.rs:7`, `tests/transcript_vitest_replay.rs:8`, `tests/transcript_turns.rs:4`, `tests/transcript_cargo_e2e.rs:3`). Those imports change path under the refactor — `vimeflow_lib::agent::transcript::TranscriptState` → `vimeflow_lib::agent::adapter::base::TranscriptState` — but the test logic stays identical.

#### IDEA — Why `TranscriptState` stays `pub` rather than being hidden behind the adapter

- **Intent:** The deep-module property targets the _user-facing IPC surface_ (Tauri commands + frontend). Test-driving infrastructure is a different audience with a different contract; keeping it reachable via `pub` is consistent with how `tokio::runtime::Runtime` stays public even though most apps use the higher-level `tokio::spawn`.
- **Danger:** Future code outside the adapter module could grow a dependency on `TranscriptState`'s internals, defeating the abstraction. Mitigation: a `// Test-only public surface — production code MUST use AgentAdapter::start instead` doc-comment on each `pub` item, plus a one-line `#[doc(hidden)]` to keep them out of generated docs.
- **Explain:** The alternative — rewriting all four integration tests to drive `<dyn AgentAdapter>::start()` end-to-end — is doable but would change what those tests actually verify. They were written specifically to drive `TranscriptState` directly so the assertions can isolate transcript-parsing behavior from watcher-orchestration behavior. Forcing them through `start()` collapses two test scopes into one and makes regressions harder to localize.
- **Alternatives considered:**
  - Make the types `pub(crate)` and put the integration tests inside `src-tauri/src/agent/adapter/base.rs` as `#[cfg(test)]`. Rejected — the existing tests use fixture files at `src-tauri/tests/fixtures/`, which only the integration-tests crate can reach via `CARGO_MANIFEST_DIR`. Moving the tests breaks that path.
  - Add a separate `pub(crate) fn test_drive_transcript(...)` helper for tests only. Rejected — adds a parallel surface that exists only for tests, violating "make invalid states unrepresentable" by inviting confusion about which API is canonical.

### Factory

```rust
// In agent/adapter/mod.rs (additional inherent block on dyn AgentAdapter):

impl dyn AgentAdapter {
    /// Construct the adapter for a detected agent type. Returns `Err`
    /// for agents not yet implemented — callers (the Tauri command)
    /// surface this as a watcher-startup failure, which the frontend
    /// already handles gracefully (`useAgentStatus.ts:135-138`).
    pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            other => Err(format!(
                "agent type {:?} not yet supported by AgentAdapter",
                other,
            )),
        }
    }
}
```

The error path is intentional and Stage-1-correct: today, `start_agent_watcher` invoked under a non-Claude detected agent already does nothing useful (no `status.json` exists at the Claude-shaped path; the watcher polls it forever and emits zero events). Returning `Err` here makes that silent no-op explicit at the `Result` boundary so the frontend can react. Stage 2 turns the `Codex` arm into `Ok(Arc::new(CodexAdapter::new()))`; until then, attempting to start a Codex watcher fails fast with a clear diagnostic.

## Tauri Command Surface

### Removed

- `start_transcript_watcher` (`transcript.rs:794`) — was only ever called transitively from inside the watcher; never wired from the frontend in production paths. Confirmed: no `invoke('start_transcript_watcher', …)` call exists in `src/`.
- `stop_transcript_watcher` (`transcript.rs:807`) — currently called by `stopWatchers` in `useAgentStatus.ts:53-58`. Frontend collapses to `stop_agent_watcher` only after this refactor (the adapter owns transcript lifecycle end-to-end). **This is a frontend change** — though small (delete one `invoke` line), it must land in the same commit as the command removal.

#### IDEA — Removing `start/stop_transcript_watcher` commands

- **Intent:** The transcript is an _internal_ dependency of the watcher. Exposing its lifecycle as separate IPC was a layering accident from the original implementation when watcher and transcript lived in sibling files. Hiding it inside the adapter aligns with "prefer one complete operation over several half-operations."
- **Danger:** A future feature that wants to tail a transcript _without_ the rest of the watcher (e.g. a "show me the transcript of a closed session" view) would have to plumb a new command through. Mitigation: that's the right place to design a new command for; the present hidden-coupling shape makes such a feature already hard.
- **Explain:** Today the frontend issues `stop_transcript_watcher` as a courtesy after `stop_agent_watcher` because watcher destruction does not currently cascade. Under the adapter, watcher destruction is the single source of truth for transcript tear-down (`WatcherHandle::Drop` already stops the polling thread; transcript stop joins onto it). One IPC, one lifecycle.
- **Alternatives considered:**
  - Keep both commands and have `stop_agent_watcher` cascade. Rejected — preserves the misleading public surface ("transcripts are independently controllable") that no production caller uses.

### Unchanged

- `detect_agent_in_session` (`commands.rs:17-37`) — agent-agnostic, no changes.
- `start_agent_watcher` (`watcher.rs:649-698`) — moves to `adapter/mod.rs`; signature unchanged. Internally it now calls `<dyn AgentAdapter>::for_type(...)?.start(...)` instead of building the watcher inline. (`<dyn AgentAdapter>::for_type` is the Rust syntax for an inherent method on a trait object.)
- `stop_agent_watcher` (`watcher.rs:702-712`) — moves to `adapter/mod.rs`; signature unchanged.

## Frontend Touch (minimal)

`src/features/agent-status/hooks/useAgentStatus.ts:53-58`:

```ts
// before
try {
  await invoke('stop_transcript_watcher', { sessionId: ptyId })
} catch {
  /* … */
}

// after
// (block deleted — stop_agent_watcher cascades transcript teardown)
```

No other frontend changes. Bindings under `src/bindings/` are auto-generated from Rust types via `ts-rs`; they regenerate as part of the test cycle.

## Test Strategy

### What survives unchanged

- All unit tests in `agent/statusline.rs`, `agent/transcript.rs`, `agent/test_runners/*`. They move with their module; their test bodies are 1:1.
- Integration tests `src-tauri/tests/transcript_*.rs` — four files (`transcript_vitest_e2e.rs`, `transcript_vitest_replay.rs`, `transcript_turns.rs`, `transcript_cargo_e2e.rs`) drive `TranscriptState::new()` directly to isolate transcript-parsing assertions from watcher orchestration. Their import path updates from `vimeflow_lib::agent::transcript::TranscriptState` to `vimeflow_lib::agent::adapter::base::TranscriptState` — that's the only edit; test bodies stay identical (Codex review Finding 2). `TranscriptStartStatus`, `TranscriptHandle`, and the `start_or_replace` semantics they exercise are preserved verbatim under the new path.

### What's new

- `agent/adapter/base.rs` gets a `MockAdapter` test impl (in `#[cfg(test)] mod tests`) that records hook invocations. Tests cover:
  - `start_for` calls `status_source` exactly once at startup.
  - `start_for` calls `parse_status` on every notify event after debounce.
  - `start_for` calls `adapter.tail_transcript(...)` exactly once when `parse_status` returns a transcript path, and the returned `TranscriptHandle` is held inside `TranscriptState`'s registry.
  - Polling fallback fires every 3s in WSL2 (env-flagged) or by mock clock injection.
  - `WatcherHandle::Drop` joins the poll thread and the transcript tail thread.
- `agent/adapter/claude_code/mod.rs` gets a `ClaudeCodeAdapter` test that verifies each provider hook delegates correctly. These are thin tests — the heavy lifting still lives in the moved `statusline.rs` / `transcript.rs` test suites.

### Acceptance test (manual, before merge)

Run a Claude Code session under Vimeflow on a workspace with a JSONL transcript that exercises `tool_use` + `tool_result` + a `vitest` test run. Compare:

- `Vimeflow.log` lines for `watcher.event` / `watcher.slow_event` / `watcher.tx_path_change` / `watcher.handle.dropped` against a baseline run on `main`. Identical except for any timing fluctuations.
- Frontend `agent-status`, `agent-tool-call`, `agent-turn`, `test-run` events — identical payloads (compare via dev-tools network capture or a tap added temporarily).

## Migration Steps (ordered)

Each step compiles and passes tests independently. PRs may bundle them or split them.

1. **Add new module skeletons.** Create `agent/adapter/{mod.rs,base.rs,types.rs,json.rs,claude_code/mod.rs}` empty/stub. Wire `agent/mod.rs` to declare `pub mod adapter;`. Build passes; nothing yet uses the new modules.
2. **Implement `adapter/json.rs`** with `navigate`, `extract<T>`, `u64_at` / `f64_at` / `str_at` / `obj_at`, and `u64_or` / `f64_or` / `str_or` per the "Shared parse primitives" section. Add unit tests covering: missing path, partial path (intermediate key absent), wrong-type leaf, default fallback, deep navigation. Build passes; tests pass.
3. **Move provider-hook types.** Add `StatusSource`, `ParsedStatus` to `adapter/types.rs`. (`TranscriptHandle` moves to `adapter/base.rs` in step 7 alongside the rest of the transcript lifecycle. `InFlightToolCall` from `transcript.rs:57-66` stays inside `claude_code/transcript.rs` since transcript parsing is now per-adapter — Codex review Finding 3.) Pure additions; nothing yet uses them.
4. **Define `trait AgentAdapter` skeleton in `adapter/mod.rs` with provider hooks only.** No `start`/`stop`/`for_type` yet — those live on the `impl dyn AgentAdapter` inherent block that lands in step 10, after `base::start_for` exists in step 9. Build passes; trait has no callers.
5. **Move `agent/test_runners/` → `agent/adapter/claude_code/test_runners/`.** Update import paths in the moved files (relative `super::` references) and in `transcript.rs`'s import (still in old location). Build passes; tests pass unchanged.
6. **Move `agent/statusline.rs` → `agent/adapter/claude_code/statusline.rs` AND refactor its parsers to use `adapter::json` primitives.** Update import paths in the moved file's tests. Update `agent/mod.rs` to drop the `pub mod statusline;` declaration. Update `watcher.rs`'s import to `use crate::agent::adapter::claude_code::statusline::parse_statusline;` (temporary; goes away in step 9). Replace every `obj.get(...).and_then(|v| v.as_*()).unwrap_or(default)` chain with the equivalent `json::*_or(&v, &["..."], default)` call. **Acceptance check (mechanical):** `rg "and_then\(\|v\| v\.as_(u64|f64|str|object)\(\)\)" src-tauri/src/agent/adapter/` returns zero results. Build passes; tests pass unchanged (parser refactor is semantics-preserving).
7. **Move `agent/transcript.rs` → `agent/adapter/claude_code/transcript.rs` AND extract shared lifecycle types into `adapter/base.rs`.** This step does three things atomically so integration tests stay green:
   1. Move the per-line parsing logic (`tail_loop`, `process_line`, `process_assistant_message`, `process_tool_result`, `start_tailing`, the `InFlightToolCall` struct, the `TestRunEmitter` integration) into `adapter/claude_code/transcript.rs`.
   2. Lift `TranscriptState`, `TranscriptHandle`, `TranscriptStartStatus` out of the file and place them in `adapter/base.rs` as `pub` items with `#[doc(hidden)]` (per Finding 2). They're shared lifecycle infrastructure, not Claude-specific.
   3. Update the four integration tests' imports in one commit:
      - `tests/transcript_vitest_e2e.rs:7`
      - `tests/transcript_vitest_replay.rs:8`
      - `tests/transcript_turns.rs:4`
      - `tests/transcript_cargo_e2e.rs:3`
        Each changes `use vimeflow_lib::agent::transcript::TranscriptState;` → `use vimeflow_lib::agent::adapter::base::TranscriptState;`. Test bodies stay identical.

   `validate_transcript_path` stays `pub(crate)` inside `claude_code/transcript.rs` for now so `watcher.rs` can still call it during the transitional period (goes away in step 9). `transcript.rs`'s parsers that consume `serde_json::Value` directly via `value.get(...).and_then(|v| v.as_str())` migrate to `adapter::json` primitives in this same commit (per Finding 2's parser-dedup acceptance check). Build passes; integration tests pass under their new import path; nothing else changes.

8. **Implement `ClaudeCodeAdapter` in `adapter/claude_code/mod.rs`.** Each provider hook delegates to the (now-moved) Claude logic:
   - `agent_type` → `AgentType::ClaudeCode`
   - `status_source(cwd, sid)` → `StatusSource { path: <cwd>/.vimeflow/sessions/<sid>/status.json, trust_root: <cwd> }`
   - `parse_status(sid, raw)` → `statusline::parse_statusline(sid, raw)`
   - `validate_transcript(raw)` → `transcript::validate_transcript_path(raw)` (the `~/.claude` jail logic)
   - `tail_transcript(app, sid, cwd, path)` → wraps the existing `transcript::start_tailing(app, sid, path, cwd)`, returning the resulting `TranscriptHandle` (Finding 3 — the entire `tail_loop`, `process_line`, `TestRunEmitter` lifecycle stays inside `claude_code/transcript.rs` unchanged)
     Add unit tests that verify each hook's delegation contract. Build passes; new tests pass.
9. **Move watcher orchestration body into `adapter/base.rs`.** Verbatim from `watcher.rs:403-642` (`start_watching`) and the surrounding `start_agent_watcher` Tauri command body (`watcher.rs:649-697`, the state.remove + log + start_watching + state.insert flow), with the new signature `pub(crate) fn start_for(adapter: Arc<dyn AgentAdapter>, app: AppHandle, sid: String, cwd: PathBuf, state: AgentWatcherState) -> Result<(), String>` (Codex review Finding 4 — adapter owns the full state lifecycle). Replace direct `parse_statusline` calls with `adapter.parse_status(...)`; replace `validate_transcript_path` calls with `adapter.validate_transcript(...)`; replace status-file-path construction with `adapter.status_source(cwd, sid).path`. The `TxOutcome`, `EventTiming`, `PathHistory` types move with it as private items in `base.rs`. (`TranscriptState` / `TranscriptHandle` / `TranscriptStartStatus` already landed in `base.rs` in step 7, so they're already addressable here.) The transcript-tailer call site changes from the previous inline `start_tailing(...)` to `adapter.tail_transcript(...)` — a single delegated call (Finding 3). **Critical: this is the step that risks behavioral drift. Reviewer should diff `watcher.rs` (old) vs. `base.rs` (new) and confirm every change is one of: (a) hook-call substitution per the IDEA below, (b) state-lifecycle wrapping into `start_for`, (c) `tail_transcript` delegation. No silent behavioral edits.**
10. **Wire `start_agent_watcher` / `stop_agent_watcher` Tauri commands to use the adapter.** Move them from `watcher.rs` to `adapter/mod.rs`. The IPC contract for `start_agent_watcher` stays unchanged — it still receives only `session_id` plus the managed `AgentWatcherState` and `PtyState`. **The agent type is re-detected on the backend** (Codex review Finding 1) — the frontend's separate `detect_agent_in_session` poll is not the source of truth for which adapter to build. Concretely:

    ```rust
    #[tauri::command]
    pub async fn start_agent_watcher(
        app_handle: tauri::AppHandle,
        state: tauri::State<'_, AgentWatcherState>,
        pty_state: tauri::State<'_, crate::terminal::PtyState>,
        session_id: String,
    ) -> Result<(), String> {
        let cwd = pty_state.get_cwd(&session_id)
            .ok_or_else(|| format!("PTY session not found: {}", session_id))?;
        let pid = pty_state.get_pid(&session_id)
            .ok_or_else(|| format!("PTY session not found: {}", session_id))?;
        let agent_type = detect_agent(pid)
            .map(|(t, _pid)| t)
            .ok_or_else(|| format!(
                "no agent detected in PTY session {}", session_id
            ))?;
        let adapter = <dyn AgentAdapter>::for_type(agent_type)?;
        adapter.start(app_handle, session_id, PathBuf::from(cwd), (*state).clone())
    }
    ```

    Re-running detection on the backend rather than trusting a frontend-supplied `agent_type` parameter avoids a TOCTOU window between detection and watcher start (the agent could exit and a different one start in the same PTY) and matches `rules/rust/patterns.md`'s "validate all inputs on the Rust side — the frontend is untrusted." Also add the `impl dyn AgentAdapter { fn for_type(...), fn start(...), fn stop(...) }` inherent block in `adapter/mod.rs`.

11. **Delete `agent/watcher.rs`.** Update `agent/mod.rs` re-exports.
12. **Delete `start_transcript_watcher` / `stop_transcript_watcher` Tauri commands.** Update `lib.rs`'s `tauri::generate_handler![…]` list. Frontend `useAgentStatus.ts:53-58` deletion lands in the same commit.
13. **Acceptance test pass.** Per "Acceptance test" above.

## Risks

### IDEA — Behavioral drift in step 9

- **Intent:** The watcher orchestration is dense (debounce + notify + WSL2 poll fallback + inline-init read + path-history diagnostics + transcript replay). Moving it into a generic function across a single PR commit risks subtle drift: a missed debounce reset, a swapped argument, a race in the polling thread spawn.
- **Danger:** Drift is silent. The agent panel still lights up; events still fire. But e.g. a missed `last.lock()` reset could turn the 100ms debounce into 0ms and cause event storms under WSL2; a swapped `Mutex` lock order could deadlock during `WatcherHandle::Drop`.
- **Explain:** Mitigation — step 9 is its own commit with no other changes. Reviewer must run a `diff -u` between the deleted `watcher.rs::{start_agent_watcher,start_watching}` bodies and the new `base::start_for` body and confirm every change is one of:
  1. `parse_statusline(&sid, &c)` → `adapter.parse_status(&sid, &c)`
  2. `validate_transcript_path(p)` → `adapter.validate_transcript(p)`
  3. status-file-path construction → `adapter.status_source(cwd, sid).path`
  4. inline `transcript::start_tailing(app, sid, path, cwd)` → `adapter.tail_transcript(app, sid, cwd, path)`
  5. wrapping the previous `start_agent_watcher` body's `state.remove(&sid)` + active-count log + `state.insert(sid, handle)` flow into the new `start_for` body so the adapter owns lifecycle (Finding 4)
     No other changes are admissible in this commit.
- **Alternatives considered:** Splitting step 9 across two commits (first introduce the generic free fn paralleling the existing one, then switch callers). Rejected — doubles the diff surface and creates a transient state where two parallel watchers could race if a test runs in between.

### IDEA — `Err` (not `unimplemented!`) for non-Claude agents in `for_type`

- **Intent:** Today, `start_agent_watcher` for a non-Claude detected agent silently no-ops (no `status.json` exists at the Claude-shaped path; the watcher polls forever and emits zero events). Stage 1 must not regress this into a panic.
- **Danger:** A factory that panics (`unimplemented!`) for `AgentType::Codex` would crash the backend whenever a user runs `codex` under Vimeflow during the Stage-1 → Stage-2 window. That window is the entire point of staging the work; a panic erases the value.
- **Explain:** The factory therefore returns `Result<Arc<Self>, String>` and yields `Err(format!("agent type {:?} not yet supported", other))` for every variant except `ClaudeCode`. The Tauri command propagates the `Err` to the frontend, which already handles watcher-startup failure as a no-op at `useAgentStatus.ts:135-138` (the `try { … } catch { /* retry next poll */ }` branch). User-visible behavior under a Codex session: detection still lights up the agent as `'codex'` in the UI (existing behavior), but the status panel stays in its inactive state — same as today.
- **Alternatives considered:**
  - Panic via `unimplemented!`. Rejected per Danger above.
  - Return a `NoOpAdapter` for unsupported variants (an adapter whose hooks all return empty). Rejected — adds dead code that has to be maintained. The `Err` path expresses the same semantics with no extra code.

### IDEA — Pre-existing 1349-line `transcript.rs`

- **Intent:** `agent/transcript.rs` exceeds the 800-line file budget in `rules/CLAUDE.md`. The refactor moves it without splitting it.
- **Danger:** Reviewer perceives the spec as accepting a guideline violation.
- **Explain:** The violation is pre-existing (Stage 1 doesn't introduce it). Splitting `transcript.rs` is a separate refactor with its own risk surface (the in-flight tool-call tracking + replay-aware emitter spans the file's middle — splits could fragment that state). Stage 1's "no behavior change" invariant is the safety net; bundling a split would compromise that invariant.
- **Alternatives considered:** Split `transcript.rs` into `parse.rs` (process_assistant_message, process_tool_result), `tail.rs` (start_tailing, tail_loop), `state.rs` (TranscriptState) inside `claude_code/`. Rejected for Stage 1 — sized as its own spec post-Stage-2.

## Open Questions

1. **Test-runner refactor for Codex (deferred).** Stage 2 will need a Codex variant of `match_command` against the `function_call` / `exec_command_end` shape from Codex rollout JSONLs. Out of scope here; flagged so it surfaces in the Stage 2 spec.
2. **Should `validate_transcript` be an inherent method with a per-adapter `trust_root()` hook?** Both Claude and Codex's validation logic is "canonicalize and assert under trust root." Stage 2 will reveal whether the duplication is exact or whether each provider has subtle additional rules. **Recommendation:** keep `validate_transcript` as a per-adapter trait method for Stage 1 (forward-compatible); if Stage 2 confirms exact duplication, collapse into a `fn validate_under(trust_root: &Path, raw: &str) -> Result<PathBuf, String>` helper in `adapter::base` and have both adapters delegate.
3. **Future: `transcript.rs` split (post-Stage-2).** The 1349-line `transcript.rs` is movable as-is for Stage 1 but should be broken into `parse.rs` / `tail.rs` / `state.rs` once both adapters exist and the symmetry between them clarifies the natural split lines. Tracked as future tech debt, not a Stage 1 deliverable.

## References

- `rules/common/design-philosophy.md` — deep modules, interface discipline, complexity budget.
- `rules/rust/patterns.md` — Tauri command shape, managed state, event system.
- `rules/CLAUDE.md` — file-size budget, conventional commits.
- `src-tauri/src/agent/{statusline,transcript,watcher,detector,commands,types}.rs` — current implementation under refactor.
- `src/features/agent-status/hooks/useAgentStatus.ts` — frontend consumer (only `:53-58` touched).
- Stage 2 spec (to be drafted post-merge): `2026-MM-DD-codex-adapter-design.md`.
