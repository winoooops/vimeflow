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
8. **Stage 1 NEW invariant (replaces the deleted `stop_transcript_watcher` IPC):** dropping `WatcherHandle` for a session, in this exact order, (a) drops the inner notify watcher first so no further callbacks can fire, (b) signals the polling thread's `stop_flag` and joins it, (c) calls `TranscriptState::stop(&session_id)` on the registry, signaling the tail thread's `stop_flag` and joining. The order is load-bearing: a notify callback that fires after step (c) would call `state.start_or_replace(...)` and restart the tailer (Codex review third-pass Finding 1). This cascade replaces the frontend-driven "stop watcher then stop transcript" two-step that exists today (`useAgentStatus.ts:53-58`). Verifiable by a unit test that constructs a `WatcherHandle` against a `MockAdapter`, calls `Drop`, and asserts both the polling thread joined and the `TranscriptHandle`'s `stop_flag` is set, with no late-callback-driven restart in a 100ms hold-after window.
9. Existing tests pass with the minimum-necessary edits. Specifically:
   - Unit `#[cfg(test)]` blocks in `agent/statusline.rs`, `agent/watcher.rs`, `agent/detector.rs`, `agent/test_runners/*`: bodies stay 1:1; only the `super::*` import paths change as the modules relocate.
   - Unit `#[cfg(test)]` block in `agent/transcript.rs`: most tests stay 1:1 with relocation. **Carve-out** (Codex review fifth-pass Finding 2 — earlier wording incorrectly said all transcript tests stay 1:1): the `TranscriptState`-driving tests — `transcript_state_replaces_changed_path`, `transcript_state_threads_cwd_through`, `transcript_state_replaces_when_only_cwd_changes` (six `start_or_replace` call sites at `transcript.rs:840/845/850/871/902/913`) — move with `TranscriptState` itself into `adapter/base.rs`'s `#[cfg(test)] mod tests` block in step 9, and each call site gains the new `adapter: Arc<dyn AgentAdapter<MockRuntime>>` first argument. `transcript_handle_drop_sets_stop_flag` moves to `base.rs` along with `TranscriptHandle`; `validate_transcript_path_rejects_path_outside_claude_root` stays in `claude_code/transcript.rs`.
   - Integration tests under `src-tauri/tests/transcript_*`: change their `use vimeflow_lib::agent::transcript::TranscriptState;` import to `use vimeflow_lib::agent::adapter::base::TranscriptState;`, AND add an `Arc<dyn AgentAdapter<MockRuntime>>` argument to each `state.start_or_replace(...)` call (Codex review Finding 1 — `TranscriptState::start_or_replace` must take an adapter so it can call `adapter.tail_transcript` rather than the old direct call to `claude_code::transcript::start_tailing`). The four files affected: `transcript_vitest_e2e.rs:30-31`, `transcript_vitest_replay.rs:34-35`, `transcript_turns.rs:60-61`, `transcript_cargo_e2e.rs:30-31`. Each adds one line constructing the adapter, and threads it through the existing call. Test logic and assertions stay identical.

A passing test suite plus matching `Vimeflow.log` lines for a representative Claude session is the acceptance bar.

## Architecture

### One deep module: `AgentAdapter`

```
┌──────────────────────────────────────────────────────────┐
│            Tauri command (`start_agent_watcher`)         │
│                                                          │
│   let adapter = <dyn AgentAdapter<Wry>>::for_type(t)?;   │
│   adapter.start(app, sid, cwd, watcher_state)?;          │
└────────────────────┬─────────────────────────────────────┘
                     │  one call, no orchestration leakage
                     ▼
┌──────────────────────────────────────────────────────────┐
│   trait AgentAdapter<R: tauri::Runtime>                  │
│   (Send + Sync + 'static; R is Wry in production,        │
│    MockRuntime in #[cfg(test)] integration tests)        │
│                                                          │
│   PROVIDER HOOKS (each impl fills these in):             │
│     fn agent_type(&self) -> AgentType                    │
│     fn status_source(&self, cwd, sid) -> StatusSource    │
│     fn parse_status(&self, sid, raw)                     │
│         -> Result<ParsedStatus, String>                  │
│     fn validate_transcript(&self, raw_path)              │
│         -> Result<PathBuf, String>                       │
│     fn tail_transcript(&self, app: AppHandle<R>,         │
│                         sid, cwd, path)                  │
│         -> Result<TranscriptHandle, String>              │
│     // ↑ adapter OWNS the tail loop incl. TestRunEmitter │
└──────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│   impl<R> dyn AgentAdapter<R>  (USER-FACING SURFACE)     │
│     fn for_type(t: AgentType) -> Result<Arc<Self>, …>    │
│     fn start(self: Arc<Self>, app: AppHandle<R>, …)      │
│         -> Result<(), String> {                          │
│         base::start_for(self, …)                         │
│     }                                                    │
│     fn stop(state, sid) -> bool { state.remove(sid) }    │
└────────────────────┬─────────────────────────────────────┘
                     │  delegates to private orchestrator
                     ▼
┌──────────────────────────────────────────────────────────┐
│   agent::adapter::base                                   │
│   MODULE: `pub`. CONTENTS split by visibility:           │
│     pub(crate) fn start_for<R>(                          │
│         adapter: Arc<dyn AgentAdapter<R>>, …)            │
│     pub struct TranscriptState/Handle/StartStatus        │
│         #[doc(hidden)] — kept reachable for the four     │
│         tests/transcript_*.rs integration tests          │
│     private: TxOutcome / EventTiming / PathHistory       │
│   — debounce + notify watcher                            │
│   — WSL2 polling fallback                                │
│   — inline-init read                                     │
│   — TranscriptState lifecycle (calls adapter.tail_…)     │
│   — WatcherHandle::Drop cascades to TranscriptState.stop │
│   Calls hooks via `adapter.parse_status(...)` etc.       │
└──────────────────────────────────────────────────────────┘
```

The trait is the deep-module facade; `base.rs` is the body. From **production** code outside the `agent::adapter` module, only `<dyn AgentAdapter<tauri::Wry>>::for_type(...)`, `.start(...)`, `.stop(...)`, and `.agent_type(...)` are part of the user-facing surface — Tauri commands and any future production caller use only these. Test infrastructure (`TranscriptState`, `TranscriptHandle`, `TranscriptStartStatus`) stays `pub` at `adapter::base::*` so the four `tests/transcript_*.rs` integration tests continue driving the tailer directly; that surface is `#[doc(hidden)]` and carries a doc-comment forbidding production use (Codex review Finding 2). Everything else — debounce timing, polling fallback details, JSONL tailing, in-flight tool-call tracking, `TxOutcome`/`EventTiming`/`PathHistory` diagnostics — is genuinely private.

### Rust shape: provider-hook trait + inherent impl on `dyn` + private free helper

#### IDEA — Why this dispatch shape

- **Intent:** Match the user-facing concept (template-method "BaseAdapter") to the Rust idiom that gives the smallest public surface. The trait `AgentAdapter<R: tauri::Runtime>` carries only provider hooks; the user-facing `start` / `stop` / `for_type` live in `impl<R> dyn AgentAdapter<R>` so they're callable on `Arc<dyn AgentAdapter<R>>` without `where Self: Sized`. The orchestration body lives in `pub(crate) fn base::start_for<R: Runtime>(adapter: Arc<dyn AgentAdapter<R>>, …)` because Rust default trait methods can't own per-instance mutable state and can't be called through a trait object when constrained to `Sized`.
- **Danger:** A reader sees `adapter.start(...)` resolve through the inherent `impl<R> dyn AgentAdapter<R>` block and wonders why both a trait and an inherent block exist. Mitigation: a top-of-file docstring in `adapter/mod.rs` explains the split — _trait holds provider hooks, inherent block holds the user-facing `start` / `stop`, free fn `base::start_for` holds the orchestration body_. The free fn is `pub(crate)` only.
- **Explain:** `impl<R> dyn Trait<R>` is real Rust syntax (stable since 2018) and is exactly the right tool when you want methods that are callable through a trait object but whose body is shared across all concrete impls. It's how `std::error::Error::source` and friends compose. The runtime parameter rides along because Tauri's `AppHandle<R>` is itself runtime-parameterized — `tauri::Wry` in production, `tauri::test::MockRuntime` in `mock_builder()`-driven tests — and the existing transcript code is generic end-to-end (`transcript.rs:126,141,241,…`); a non-generic trait would break that test path.
- **Alternatives considered:**
  - **Default trait method `fn start(self: Arc<Self>, …) where Self: Sized`.** Rejected — the `Sized` clause makes it uncallable through `Arc<dyn AgentAdapter<R>>`, forcing the factory to return concrete types and breaking polymorphic dispatch.
  - **Non-runtime-generic trait with `app: AppHandle` (defaults to `Wry`).** Rejected — Codex review Finding 4 surfaced that the four `tests/transcript_*.rs` integration tests build via `tauri::test::mock_builder()`, which yields `AppHandle<MockRuntime>`. A trait that takes `AppHandle<Wry>` would be uncallable from those tests, forcing a parallel test-only API surface — a worse abstraction than carrying `<R>` through.
  - **`struct AgentAdapterHandle(Arc<dyn AgentAdapter>)` wrapper with `impl AgentAdapterHandle { fn start(...) }`.** Rejected — adds an extra wrapping type whose only purpose is to host methods. `impl<R> dyn AgentAdapter<R>` does the same job without the extra type name.
  - **Free fn `agent::adapter::start_pipeline(adapter: Arc<dyn AgentAdapter<R>>, …)`.** Rejected — leaks orchestration into the call site at the Tauri command (caller has to know to call the free fn, not a method). The deep-module property requires the user-facing operation to be `adapter.start(...)`, not `mod::start_pipeline(adapter, ...)`.
  - **Enum dispatch `enum AgentAdapter { ClaudeCode(Arc<ClaudeCodeAdapter>), Codex(...) }`.** Rejected — works but forces every new agent to grow a `match` arm in `start`, `stop`, and every other dispatched method. The trait-object approach localizes dispatch to one factory site; new agents add an `impl<R> AgentAdapter<R> for NewAdapter` block and one factory `match` arm, no scattered match growth.
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
pub use adapter::base::TranscriptState;  // still Tauri-managed via lib.rs:77
pub use adapter::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};
pub use commands::detect_agent_in_session;
// start/stop_transcript_watcher commands deleted (see Tauri Command Surface)
```

**Why `TranscriptState` is still re-exported from `agent`** (Codex review third-pass Finding 2): `src-tauri/src/lib.rs:8-9` imports `TranscriptState` from `agent::{...}` and registers it with Tauri at line 77 via `.manage(TranscriptState::new())`. It must remain reachable from `lib.rs` for the application to compile and to keep the registry shared across PTY sessions. The user-facing IPC surface still doesn't expose it (no Tauri command takes or returns `TranscriptState`); it's an internal piece of managed state, accessed via `app_handle.state::<TranscriptState>()` inside `base::start_for` and via `tauri::State<'_, TranscriptState>` parameters where needed. Re-exporting from `agent` keeps `lib.rs`'s import path stable across the refactor — `lib.rs` doesn't need to know that `TranscriptState` now physically lives under `adapter::base`.

## Trait Surface

### Public methods

The trait carries **only provider hooks** (no default method bodies). The `start` / `stop` / `for_type` user-facing methods are defined as **inherent methods on `dyn AgentAdapter<R>`** so callers receive `Arc<dyn AgentAdapter<R>>` from the factory and use `.start(...)` directly. Default trait methods with `where Self: Sized` were rejected because they cannot be called through a trait object — see the IDEA block above. The trait is generic over `R: tauri::Runtime` so the same surface works under production (`R = Wry`) and `tauri::test::mock_builder()`-driven integration tests (`R = MockRuntime`); see Codex review Finding 4.

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    /// Which agent this adapter represents.
    fn agent_type(&self) -> AgentType;

    /// Where this agent writes its status snapshot.
    /// Claude returns `<cwd>/.vimeflow/sessions/<sid>/status.json`,
    /// `trust_root: <cwd>` so base canonicalizes the path under
    /// the workspace before creating dirs / starting the watcher.
    /// Codex (Stage 2) will return its rollout JSONL path with
    /// `trust_root: ~/.codex/sessions`.
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
    /// emit live thereafter). Returns a `TranscriptHandle` whose
    /// `Drop` only signals the tail thread to stop on its next poll
    /// (sets `stop_flag`); explicit `TranscriptHandle::stop(self)`
    /// also joins the thread. This matches today's behavior at
    /// `transcript.rs:94-108` — Stage 1 preserves it (Codex review
    /// fifth-pass Finding 3 — earlier doc incorrectly claimed Drop
    /// joins, which would be a behavioral change).
    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
```

#### Why the trait is generic over `R: tauri::Runtime`

Today's transcript code is generic over `R: tauri::Runtime` end-to-end (`transcript.rs:126,141,241,269,328,…`) so the four integration tests under `src-tauri/tests/` can drive it via `tauri::test::mock_builder()`, which returns `AppHandle<MockRuntime>`. A non-generic trait with `app: AppHandle` (defaulting to `Wry`) would break the test path on the first call — see Codex review Finding 4. The trait carries `R` so it can be parameterized at the dispatch boundary:

- Production: `Arc<dyn AgentAdapter<tauri::Wry>>` — built by the Tauri command.
- Tests: `Arc<dyn AgentAdapter<MockRuntime>>` — built inside `#[cfg(test)]` blocks against `mock_builder()`.

Each concrete impl is generic over `R` (`impl<R: Runtime> AgentAdapter<R> for ClaudeCodeAdapter`) so a single `ClaudeCodeAdapter` value works with both runtimes — the parameterization adds no per-runtime code in the impl, just plumbing. The four hooks `agent_type` / `status_source` / `parse_status` / `validate_transcript` don't actually use `R`, but the trait is parameterized at the type level so all methods share the same `Self` type when seen through a trait object.

// ─── User-facing surface — inherent methods on the trait object ──────
//
// `impl<R> dyn AgentAdapter<R>` lets `start` / `stop` / `for_type` be
// called on `Arc<dyn AgentAdapter<R>>` without the `where Self: Sized`
// clause that would block dyn dispatch. Bodies delegate to the private
// `base::*` helpers where the orchestration lives (Rust trait default
// methods cannot own per-watcher mutable state, so the body has to live
// in a free fn that accepts `Arc<dyn AgentAdapter<R>>`).

impl<R: tauri::Runtime> dyn AgentAdapter<R> {
/// Construct the adapter for a detected agent type. For agents not
/// yet implemented in Stage 1 (Codex / Aider / Generic), this
/// returns a `NoOpAdapter` whose `status_source` points at the
/// same path Claude uses (`<cwd>/.vimeflow/sessions/<sid>/status.json`)
/// so the watcher starts successfully — no statusline.sh writes
/// there under non-Claude agents, so no events ever fire, but the
/// frontend's exit-collapse gate (`useAgentStatus.ts:139-154`,
/// keyed off `watcherStartedRef.current`) keeps working when the
/// agent process exits. Stage 2 replaces the `Codex` arm with a
/// real `CodexAdapter`. (Codex review fifth-pass Finding 1 — see
/// the IDEA block on `NoOpAdapter` below for why returning `Err`
/// breaks the UI for unsupported agents.)
pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
match agent_type {
AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
other => Ok(Arc::new(NoOpAdapter::new(other))),
}
}

    /// Start the watcher pipeline for this session. Owns the full
    /// lifecycle: removes any pre-existing handle for `session_id`,
    /// logs the active-watcher count, builds the new pipeline, and
    /// inserts the resulting `WatcherHandle` into `state`. The Tauri
    /// command does not interact with `state` directly — that's the
    /// "deep module" property: one call replaces the entire current
    /// `start_agent_watcher` body's state-management dance
    /// (`watcher.rs:680-697`).
    pub fn start(
        self: Arc<Self>,
        app: AppHandle<R>,
        session_id: String,
        cwd: PathBuf,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        crate::agent::adapter::base::start_for(self, app, session_id, cwd, state)
    }

    /// Stop the watcher pipeline for this session. The corresponding
    /// transcript tail is also stopped via `WatcherHandle::Drop`'s
    /// cascade — see Behavioral Invariants #9 for the contract.
    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }

}

````

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
````

### Claude parser JSON boundary

The Stage 1 parser refactor deliberately keeps JSON extraction inside the Claude adapter rather than promoting it to a shared `agent::adapter::json` API. See `docs/decisions/2026-05-03-claude-parser-json-boundary.md`.

Parser flow should prefer Claude-domain functions:

```rust
let test_match = bash_command(item).and_then(|cmd| match_command(cmd, cwd));

let context_window = ContextWindowStatus {
    total_input_tokens: total_input_tokens(value),
    current_usage: current_usage(value),
    // ...
};
```

Those domain functions may use explicit JSON access when the shape is shallow:

```rust
fn bash_command(item: &Value) -> Option<&str> {
    item.get("input")
        .and_then(|v| v.get("command"))
        .and_then(Value::as_str)
}
```

For repeated 3+ layer reads such as `context_window.current_usage.cache_creation_input_tokens`, the Claude parser may use small private helpers (for example `u64_or(value, &["context_window", "current_usage", "input_tokens"], 0)`). Those helpers are implementation details of `claude_code/statusline.rs` or a Claude-private parser module; they are not part of the adapter-level abstraction until a second adapter proves the same API is useful.

#### IDEA — Domain functions before generic JSON helpers

- **Intent:** Keep the `AgentAdapter` surface deep while avoiding a premature shared JSON helper API. Parser main flows should read in Claude concepts, not path-query syntax. `bash_command(item)` communicates more than `json::str_at(item, &["input", "command"])`.
- **Danger:** Removing shared helpers can reintroduce noisy `.get().and_then(...)` boilerplate. Mitigation: allow Claude-private helpers for repeated deep/defaulted fields, but call them behind domain functions so the main parser remains semantic.
- **Explain:** Two-level JSON reads are often clearest when written explicitly. The path-slice helper (`try_fold` over `&["a", "b", "c"]`) becomes useful only when repetition or depth hides intent. Because Codex CLI is Stage 2 and not yet implemented, cross-provider helper reuse is not evidence-backed today.
- **Alternatives considered:**
  - **Shared free fns in `adapter::json`.** Rejected after review because only Claude uses them and the module advertises a cross-adapter abstraction before the second adapter exists.
  - **Raw `.get().and_then()` everywhere.** Rejected because statusline metrics contain many repeated nested numeric/default reads.
  - **Trait extraction hooks.** Rejected because parser deduplication is below the trait line; adding hooks would widen the public adapter surface for an implementation detail.

### Visibility of orchestration-internal types

These currently live in `watcher.rs` and `transcript.rs`. They move into `adapter/base.rs` and split by visibility:

**Private** (truly internal — never reached from outside `agent::adapter::base`):

- `TxOutcome` — log classification for `record_event_diag`.
- `EventTiming` — per-source timing state.
- `PathHistory` — speculative→resolved transcript-path tracking.

**Crate-internal infrastructure with `pub` visibility, kept reachable for integration tests** (Codex review Findings 2 + 3):

- The module path `agent::adapter::base` itself is `pub` (i.e. declared as `pub mod base;` in `agent/adapter/mod.rs`). Without that, the `pub` items inside are unreachable from integration tests.
- `WatcherHandle` — opaque externally but stays `pub` so `AgentWatcherState` can store it.
- `TranscriptState`, `TranscriptHandle`, `TranscriptStartStatus` — stay `pub` at `agent::adapter::base::*` with `#[doc(hidden)]` and a `// Test-only public surface — production code MUST use AgentAdapter::start instead` doc-comment. The free fn `base::start_for` itself stays `pub(crate)` (no test reaches into it directly — tests drive `TranscriptState`).
- The four integration tests under `src-tauri/tests/transcript_*` (`transcript_vitest_e2e.rs`, `transcript_vitest_replay.rs`, `transcript_turns.rs`, `transcript_cargo_e2e.rs`) get **two** edits each:
  1. Import path changes from `vimeflow_lib::agent::transcript::TranscriptState` to `vimeflow_lib::agent::adapter::base::TranscriptState`.
  2. Each `state.start_or_replace(app_handle.clone(), session_id.clone(), path, cwd)` call gains an `Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter)` argument so `start_or_replace` can route to `adapter.tail_transcript(...)` (Codex review Finding 1 — `TranscriptState` cannot call into `claude_code::start_tailing` directly without re-coupling to a Claude-specific module from `base`).

#### IDEA — Why `TranscriptState` stays `pub` rather than being hidden behind the adapter

- **Intent:** The deep-module property targets the _user-facing IPC surface_ (Tauri commands + frontend). Test-driving infrastructure is a different audience with a different contract; keeping it reachable via `pub` is consistent with how `tokio::runtime::Runtime` stays public even though most apps use the higher-level `tokio::spawn`.
- **Danger:** Future code outside the adapter module could grow a dependency on `TranscriptState`'s internals, defeating the abstraction. Mitigation: a `// Test-only public surface — production code MUST use AgentAdapter::start instead` doc-comment on each `pub` item, plus a one-line `#[doc(hidden)]` to keep them out of generated docs.
- **Explain:** The alternative — rewriting all four integration tests to drive `<dyn AgentAdapter>::start()` end-to-end — is doable but would change what those tests actually verify. They were written specifically to drive `TranscriptState` directly so the assertions can isolate transcript-parsing behavior from watcher-orchestration behavior. Forcing them through `start()` collapses two test scopes into one and makes regressions harder to localize.
- **Alternatives considered:**
  - Make the types `pub(crate)` and put the integration tests inside `src-tauri/src/agent/adapter/base.rs` as `#[cfg(test)]`. Rejected — the existing tests use fixture files at `src-tauri/tests/fixtures/`, which only the integration-tests crate can reach via `CARGO_MANIFEST_DIR`. Moving the tests breaks that path.
  - Add a separate `pub(crate) fn test_drive_transcript(...)` helper for tests only. Rejected — adds a parallel surface that exists only for tests, violating "make invalid states unrepresentable" by inviting confusion about which API is canonical.

### Factory

`for_type` is shown above in the `impl<R: tauri::Runtime> dyn AgentAdapter<R>` inherent block. The `NoOpAdapter` fallback for non-Claude agents preserves Stage 0's user-visible behavior — the watcher starts, no events fire, and when the agent process exits the frontend's existing `watcherStartedRef.current`-keyed collapse path runs naturally. Stage 2 replaces the `Codex` arm with a real `CodexAdapter::new(...)`.

`NoOpAdapter` itself is a small struct in `adapter/mod.rs`:

```rust
pub(crate) struct NoOpAdapter {
    agent_type: AgentType,
}

impl NoOpAdapter {
    pub fn new(agent_type: AgentType) -> Self { Self { agent_type } }
}

impl<R: tauri::Runtime> AgentAdapter<R> for NoOpAdapter {
    fn agent_type(&self) -> AgentType { self.agent_type.clone() }
    // ↑ `.clone()` because AgentType currently derives only `Clone`,
    //   not `Copy` (`agent/types.rs:6`). Returning `self.agent_type`
    //   directly from `&self` would move out of a shared reference and
    //   fail to compile (Codex review sixth-pass Finding 1). The Clone
    //   is ~free for a unit-variant enum. ClaudeCodeAdapter's hook is
    //   unaffected because it returns the literal `AgentType::ClaudeCode`
    //   rather than a stored field.

    /// Same path Claude uses, so the watcher's create_dir_all + watch
    /// behavior matches today's "start succeeds, no events" no-op for
    /// non-Claude agents. trust_root is the workspace cwd.
    fn status_source(&self, cwd: &Path, sid: &str) -> StatusSource {
        StatusSource {
            path: cwd.join(".vimeflow").join("sessions").join(sid).join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }

    // Hooks below are reachable only if a non-Claude agent somehow
    // wrote the Claude-shaped status.json — should not happen in
    // production. Return Err so the watcher logs and skips, matching
    // today's parse-failure path.
    fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
        Err(format!("{:?} has no parser; statusline write was unexpected",
                    self.agent_type))
    }
    fn validate_transcript(&self, _: &str) -> Result<PathBuf, String> {
        Err(format!("{:?} has no transcript validator", self.agent_type))
    }
    fn tail_transcript(
        &self, _: AppHandle<R>, _: String, _: Option<PathBuf>, _: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        Err(format!("{:?} has no transcript tailer", self.agent_type))
    }
}
```

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
- `start_agent_watcher` (`watcher.rs:649-698`) — moves to `adapter/mod.rs`; signature unchanged. Internally it now calls `<dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?.start(...)` instead of building the watcher inline. (`<dyn AgentAdapter<R>>::for_type` is the Rust syntax for an inherent method on a runtime-parameterized trait object.)
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

- All unit tests in `agent/statusline.rs`, `agent/test_runners/*`, and most of `agent/transcript.rs`. They move with their module; their test bodies are 1:1.
- **Carve-out for the `TranscriptState`-driving unit tests** (Codex review fifth-pass Finding 2): the three tests in `agent/transcript.rs`'s `#[cfg(test)]` block that drive `state.start_or_replace(...)` — `transcript_state_replaces_changed_path`, `transcript_state_threads_cwd_through`, `transcript_state_replaces_when_only_cwd_changes` — move with `TranscriptState` into `adapter/base.rs`'s test block in step 9, and each `start_or_replace` call gains the new `adapter` argument. Test bodies are NOT 1:1 for these three; logic and assertions stay identical, but the call signature changes by one parameter. `transcript_handle_drop_sets_stop_flag` moves to `base.rs` along with `TranscriptHandle`; `validate_transcript_path_rejects_path_outside_claude_root` stays in `claude_code/transcript.rs`.
- Integration tests `src-tauri/tests/transcript_*.rs` — four files (`transcript_vitest_e2e.rs`, `transcript_vitest_replay.rs`, `transcript_turns.rs`, `transcript_cargo_e2e.rs`) drive `TranscriptState::new()` directly to isolate transcript-parsing assertions from watcher orchestration. Each file gets **two** edits and no others: (1) import path changes from `vimeflow_lib::agent::transcript::TranscriptState` to `vimeflow_lib::agent::adapter::base::TranscriptState`; (2) one new line constructing `let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter)` before the `state.start_or_replace(...)` call, plus passing `adapter` as the new first argument to that call (Codex review first-pass Finding 1 + third-pass Finding 4 — `start_or_replace` takes the adapter so it can route to `adapter.tail_transcript` rather than directly to Claude-specific `start_tailing`, and earlier spec text incorrectly claimed "import-only" edits). Test logic, fixtures, and assertions stay 1:1; `TranscriptStartStatus`, `TranscriptHandle`, and the replace/already-running semantics are preserved verbatim.

### What's new

- `agent/adapter/base.rs` gets a `MockAdapter` test impl (in `#[cfg(test)] mod tests`) that records hook invocations. Tests cover:
  - `start_for` calls `status_source` exactly once at startup.
  - `start_for` calls `parse_status` on every notify event after debounce.
  - `start_for` calls `state.start_or_replace(adapter.clone(), …)` exactly once when `parse_status` returns a transcript path, and `TranscriptState`'s registry holds the resulting handle.
  - Status path canonicalize-and-starts-with-trust-root check rejects an adapter that returns a `path` outside `trust_root` (Finding 5 enforcement).
  - Polling fallback fires every 3s in WSL2 (env-flagged) or by mock clock injection.
  - `WatcherHandle::Drop` joins the poll thread AND triggers `TranscriptState.stop(&session_id)` so the tail thread's `stop_flag` flips (Finding 2 cascade).

  All `MockAdapter` tests are written against `R = MockRuntime` because the test harness builds via `tauri::test::mock_builder()`, which yields `App<MockRuntime>` / `AppHandle<MockRuntime>` — the same path the four `tests/transcript_*.rs` integration tests use. The trait's `<R: Runtime>` parameter is what makes this work without a separate test-only API surface.

- `agent/adapter/claude_code/mod.rs` gets a `ClaudeCodeAdapter` test (also under `<MockRuntime>`) that verifies each provider hook delegates correctly. These are thin tests — the heavy lifting still lives in the moved `statusline.rs` / `transcript.rs` test suites.

### Acceptance test (manual, before merge)

Run a Claude Code session under Vimeflow on a workspace with a JSONL transcript that exercises `tool_use` + `tool_result` + a `vitest` test run. Compare:

- `Vimeflow.log` lines for `watcher.event` / `watcher.slow_event` / `watcher.tx_path_change` / `watcher.handle.dropped` against a baseline run on `main`. Identical except for any timing fluctuations.
- Frontend `agent-status`, `agent-tool-call`, `agent-turn`, `test-run` events — identical payloads (compare via dev-tools network capture or a tap added temporarily).

## Migration Steps (ordered)

Each step compiles and passes tests independently. PRs may bundle them or split them.

1. **Add new module skeletons.** Create `agent/adapter/{mod.rs,base.rs,types.rs,claude_code/mod.rs}` empty/stub. Wire `agent/mod.rs` to declare `pub mod adapter;`. Build passes; nothing yet uses the new modules.
2. **Keep parser JSON helpers Claude-private.** Do not add shared `agent::adapter::json`. Any generic extraction helpers introduced during the move live under `claude_code/*` and are called behind domain functions, per "Claude parser JSON boundary". Build passes; tests pass.
3. **Move provider-hook types.** Add `StatusSource`, `ParsedStatus` to `adapter/types.rs`. (`TranscriptHandle` moves to `adapter/base.rs` in step 9 alongside the rest of the transcript lifecycle. `InFlightToolCall` from `transcript.rs:57-66` stays inside `claude_code/transcript.rs` since transcript parsing is now per-adapter — Codex review Finding 3.) Pure additions; nothing yet uses them.
4. **Define `trait AgentAdapter<R: tauri::Runtime>` skeleton in `adapter/mod.rs` with provider hooks only.** Trait is generic over `R` (Codex review Finding 4 — required so integration tests with `MockRuntime` and production with `Wry` can both target the same trait). Provider hooks include `tail_transcript(&self, app: AppHandle<R>, …)`. No `start`/`stop`/`for_type` yet — those live on the `impl<R: Runtime> dyn AgentAdapter<R>` inherent block that lands in step 11, after `base::start_for` exists in step 10. Build passes; trait has no callers.
5. **Move `agent/test_runners/` → `agent/adapter/claude_code/test_runners/`.** Update import paths in the moved files (relative `super::` references) and in `transcript.rs`'s import (still in old location). Build passes; tests pass unchanged.
6. **Move `agent/statusline.rs` → `agent/adapter/claude_code/statusline.rs` AND refactor parser call sites to Claude-domain helpers.** Update import paths in the moved file's tests. Update `agent/mod.rs` to drop the `pub mod statusline;` declaration. Update `watcher.rs`'s import to `use crate::agent::adapter::claude_code::statusline::parse_statusline;` (temporary; goes away in step 10). Repeated deep/defaulted reads may use private helpers, but the parser flow should call semantic functions such as `total_input_tokens(value)` and `current_usage(value)`. Build passes; tests pass unchanged.
7. **Move `agent/transcript.rs` → `agent/adapter/claude_code/transcript.rs` (relocate-only — no API changes yet).** Move the file as a single unit: `TranscriptState`/`TranscriptHandle`/`TranscriptStartStatus` AND the per-line parsing (`tail_loop`, `process_line`, `process_assistant_message`, `process_tool_result`, `start_tailing`, `InFlightToolCall`, `TestRunEmitter` integration) all relocate together with their existing public API unchanged. The `serde_json::Value` consumers inside the parsers migrate to Claude-domain helpers such as `line_type`, `tool_use_id`, `bash_command`, and `summarize_input`.

   To keep `lib.rs` and the integration tests compiling without a wide-blast-radius rewrite at this step, leave a transitional re-export shim at the old `agent/transcript.rs` path:

   ```rust
   // agent/transcript.rs (transitional — deleted in step 9)
   pub use crate::agent::adapter::claude_code::transcript::*;
   ```

   This shim keeps `lib.rs:8-9`'s `use vimeflow_lib::agent::{TranscriptState, …}` resolving correctly. The four integration tests under `src-tauri/tests/transcript_*` get an **import-only** edit at this step: `vimeflow_lib::agent::transcript::TranscriptState` → `vimeflow_lib::agent::adapter::claude_code::transcript::TranscriptState`. (They go to the FINAL location, `adapter::base::TranscriptState`, in step 9 once the lift-to-base happens.) `validate_transcript_path` stays `pub(crate)` inside `claude_code/transcript.rs` for now so `watcher.rs` can still call it during the transitional period (goes away in step 10). Build passes; all unit + integration tests pass with import-only changes; no behavior change.

8. **Implement `AgentAdapter<R> for ClaudeCodeAdapter` in `adapter/claude_code/mod.rs`.** A single `impl<R: tauri::Runtime> AgentAdapter<R> for ClaudeCodeAdapter` block covers both production (`R = Wry`) and tests (`R = MockRuntime`). Hook delegations:
   - `agent_type(&self)` → `AgentType::ClaudeCode`
   - `status_source(&self, cwd, sid)` → `StatusSource { path: <cwd>/.vimeflow/sessions/<sid>/status.json, trust_root: <cwd>.to_path_buf() }`
   - `parse_status(&self, sid, raw)` → `statusline::parse_statusline(sid, raw)`
   - `validate_transcript(&self, raw)` → `transcript::validate_transcript_path(raw)` (the `~/.claude` jail logic)
   - `tail_transcript(&self, app: AppHandle<R>, sid, cwd, path)` → `transcript::start_tailing::<R>(app, sid, path, cwd)`, returning the resulting `TranscriptHandle` (Finding 3 — the entire `tail_loop`, `process_line`, `TestRunEmitter` lifecycle stays inside `claude_code/transcript.rs` unchanged)

   Add unit tests that verify each hook's delegation contract. Build passes; new tests pass. ClaudeCodeAdapter is now constructible as `Arc::new(ClaudeCodeAdapter)` and assignable to `Arc<dyn AgentAdapter<R>>` for any `R` — which the next step relies on.

9. **Lift `TranscriptState`/`TranscriptHandle`/`TranscriptStartStatus` to `adapter/base.rs`, change `start_or_replace` to take an adapter, update ALL callers — integration tests AND the unit tests inside the moved transcript module** (Codex review fourth-pass Findings 1 + 2). Atomic:
   1. Move the three types from `claude_code/transcript.rs` into `adapter/base.rs` as `pub #[doc(hidden)]` items.
   2. Change the API:
      - **Before:** `pub fn start_or_replace<R: Runtime>(&self, app: AppHandle<R>, sid, path, cwd) -> Result<TranscriptStartStatus, String>` — internally calls `start_tailing(...)` directly. With `start_tailing` under `claude_code::transcript` and `TranscriptState` now under `base`, that direct call would re-couple base to a Claude-specific module.
      - **After:** `pub fn start_or_replace<R: Runtime>(&self, adapter: Arc<dyn AgentAdapter<R>>, app: AppHandle<R>, sid, path, cwd) -> Result<TranscriptStartStatus, String>` — internally calls `adapter.tail_transcript(app, sid, cwd, path)`. The replace-vs-keep identity check on `(transcript_path, cwd)` stays exactly as today; only the spawn site changes. (Step 8 just made `ClaudeCodeAdapter` an admissible argument.)
   3. Update the **integration tests** under `src-tauri/tests/transcript_*` (four files): change the import from `…::claude_code::transcript::TranscriptState` to `…::adapter::base::TranscriptState`, and add a `let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter)` line plus the `adapter` first-argument to each `start_or_replace` call (sites: `transcript_vitest_e2e.rs:30-31`, `transcript_vitest_replay.rs:34-35`, `transcript_turns.rs:60-61`, `transcript_cargo_e2e.rs:30-31`).
   4. Update the **unit tests inside the moved transcript module** — `transcript.rs:826-945` contains `transcript_state_replaces_changed_path`, `transcript_state_threads_cwd_through`, `transcript_state_replaces_when_only_cwd_changes`, `transcript_handle_drop_sets_stop_flag`, and `validate_transcript_path_rejects_path_outside_claude_root`. The first three each call `state.start_or_replace(...)` (call sites currently at `transcript.rs:840`, `:845`, `:850`, `:871`, `:902`, `:913`). These tests verify `TranscriptState` semantics; they **move with the type into `base.rs`'s `#[cfg(test)] mod tests` block**, and each `start_or_replace` call gains the same `adapter` argument. The two non-state-related tests (`transcript_handle_drop_sets_stop_flag` and `validate_transcript_path_rejects_path_outside_claude_root`) — the first stays with `TranscriptHandle` in `base.rs`; the second stays with `validate_transcript_path` inside `claude_code/transcript.rs`.
   5. Update `agent/mod.rs`'s re-export to point to the new path: `pub use adapter::base::TranscriptState;` (replaces the transitional shim from step 7).
   6. Delete the transitional `agent/transcript.rs` re-export shim from step 7.

   Build passes; all tests (integration + the relocated unit tests) pass with the adapter-argument additions.

10. **Move watcher orchestration body into `adapter/base.rs`, wire transcript-shutdown cascade, and enforce `trust_root`.** Verbatim from `watcher.rs:403-642` (`start_watching`) and the surrounding `start_agent_watcher` Tauri body (`watcher.rs:649-697` — the `state.remove` + log + `start_watching` + `state.insert` flow), with new signature:

    ```rust
    pub(crate) fn start_for<R: tauri::Runtime>(
        adapter: Arc<dyn AgentAdapter<R>>,
        app: AppHandle<R>,
        sid: String,
        cwd: PathBuf,
        state: AgentWatcherState,
    ) -> Result<(), String>
    ```

    Substitutions inside the body:
    - `parse_statusline(&sid, &c)` → `adapter.parse_status(&sid, &c)`
    - `validate_transcript_path(p)` → `adapter.validate_transcript(p)`
    - inline `<cwd>/.vimeflow/sessions/<sid>/status.json` construction → `let src = adapter.status_source(&cwd, &sid)`, then the **first-run-safe** trust-root verification procedure detailed in the IDEA below — canonicalize `src.trust_root` first, walk up `src.path`'s ancestors to find the deepest existing prefix, canonicalize that, assert `starts_with(canonical_trust_root)` BEFORE `create_dir_all`; after `create_dir_all`, re-canonicalize the now-existing parent and re-verify (catches symlink races). Both the pre-create and post-create checks live here, before `notify::recommended_watcher` is constructed (Codex review fourth-pass Finding 3 — earlier wording said "canonicalize parent before create_dir_all" which would Err for fresh sessions; this corrected procedure is what actually goes in the code).
    - inline `transcript::start_tailing(app, sid, path, cwd)` → `state.start_or_replace(adapter.clone(), app, sid, path, cwd)` (Codex review fourth-pass Finding 4 — the watcher MUST go through the registry's `start_or_replace`, not call `adapter.tail_transcript` directly. The registry owns the (transcript_path, cwd) identity check, the existing-handle replacement, the AlreadyRunning short-circuit. Calling `adapter.tail_transcript` directly would bypass all three and re-introduce the bug `start_or_replace` was designed to prevent.) The earlier fixed-string description "→ `adapter.tail_transcript(...)`" was wrong and is corrected here.
    - `TxOutcome`, `EventTiming`, `PathHistory` move with `start_for` as private items. (`TranscriptState` / `TranscriptHandle` / `TranscriptStartStatus` already landed in `base.rs` in step 9 — see step 9 for the lift details.)

`WatcherHandle` gains the transcript-cascade fields, plus a critical change to `_watcher`'s type so the Drop body can shut down notify callbacks **before** the transcript registry is asked to stop (Codex review third-pass Finding 1):

```rust
pub struct WatcherHandle {
    // NEW: was `RecommendedWatcher`. Wrapped in `Option` so Drop
    // can take + drop it explicitly BEFORE the cascade — see below.
    _watcher: Option<RecommendedWatcher>,
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<JoinHandle<()>>,
    transcript_state: TranscriptState,  // NEW: cloned Arc-share with the registry
    session_id: String,                 // NEW: lifted out of the cfg gate
    #[cfg(debug_assertions)]
    session_id_for_log: String,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        // ORDER MATTERS — Rust drops fields AFTER the explicit Drop
        // body. If we left `_watcher` to implicit cleanup, notify
        // callbacks could keep firing throughout the body, including
        // while we're trying to stop the transcript. A late callback
        // would call adapter.parse_status → maybe_start_transcript →
        // TranscriptState::start_or_replace, restarting the tailer
        // we just stopped. So we tear down in this order:
        //
        //   1. Drop `_watcher` first → notify worker thread joins,
        //      no further callbacks can fire.
        //   2. Set stop_flag and join the polling thread.
        //   3. Stop the transcript registry for this session.
        //
        // Once we reach step 3, no source can spawn a new transcript
        // tail for this session, so the registry stop is final.
        drop(self._watcher.take());

        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(h) = self.join_handle.take() { let _ = h.join(); }

        // NEW: cascade to transcript tail (replaces today's
        // frontend-side stop_transcript_watcher courtesy call).
        // Safe to call now that no notify callback can race.
        let _ = self.transcript_state.stop(&self.session_id);

        #[cfg(debug_assertions)]
        log::info!("watcher.handle.dropped session={}",
                   short_sid(&self.session_id_for_log));
    }
}
```

`start_for` constructs the `WatcherHandle` with `_watcher: Some(...)` and the `TranscriptState` clone wired in. The Tauri-managed `TranscriptState` instance (registered with `app.manage(TranscriptState::new())` at startup — see `lib.rs:77`, which keeps managing it under the new path) is the single shared registry; `WatcherHandle` holds a clone (`TranscriptState` is `Clone` because its inner `Arc<Mutex<HashMap>>` clones cheaply).

**Critical: this is the step that risks behavioral drift. Reviewer should diff `watcher.rs` (old) vs. `base.rs` (new) and confirm every change is one of: (a) hook substitutions listed above, (b) state-lifecycle wrapping into `start_for`, (c) `tail_transcript` delegation, (d) trust_root canonicalize-and-verify, (e) `WatcherHandle::Drop` cascade. No silent behavioral edits.**

11. **Wire `start_agent_watcher` / `stop_agent_watcher` Tauri commands to use the adapter.** Move them from `watcher.rs` to `adapter/mod.rs`. The IPC contract for `start_agent_watcher` stays unchanged — it still receives only `session_id` plus the managed `AgentWatcherState` and `PtyState`. **The agent type is re-detected on the backend** (Codex review Finding 1) — the frontend's separate `detect_agent_in_session` poll is not the source of truth for which adapter to build. Concretely:

    ```rust
    #[tauri::command]
    pub async fn start_agent_watcher(
        app_handle: tauri::AppHandle,  // ≡ AppHandle<tauri::Wry> in production
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
        let adapter = <dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?;
        adapter.start(app_handle, session_id, PathBuf::from(cwd), (*state).clone())
    }
    ```

    Re-running detection on the backend rather than trusting a frontend-supplied `agent_type` parameter avoids a TOCTOU window between detection and watcher start (the agent could exit and a different one start in the same PTY) and matches `rules/rust/patterns.md`'s "validate all inputs on the Rust side — the frontend is untrusted." The `<tauri::Wry>` parameter pins the production runtime; `#[cfg(test)]` callers use `<MockRuntime>` against the same trait. Also add the `impl<R: tauri::Runtime> dyn AgentAdapter<R> { fn for_type(...), fn start(...), fn stop(...) }` inherent block in `adapter/mod.rs`.

12. **Delete `agent/watcher.rs`.** Update `agent/mod.rs` re-exports.
13. **Delete `start_transcript_watcher` / `stop_transcript_watcher` Tauri commands.** Update `lib.rs`'s `tauri::generate_handler![…]` list. Frontend `useAgentStatus.ts:53-58` deletion lands in the same commit.
14. **Acceptance test pass.** Per "Acceptance test" above.

## Risks

### IDEA — Behavioral drift in step 10

- **Intent:** The watcher orchestration is dense (debounce + notify + WSL2 poll fallback + inline-init read + path-history diagnostics + transcript replay). Moving it into a generic function across a single PR commit risks subtle drift: a missed debounce reset, a swapped argument, a race in the polling thread spawn.
- **Danger:** Drift is silent. The agent panel still lights up; events still fire. But e.g. a missed `last.lock()` reset could turn the 100ms debounce into 0ms and cause event storms under WSL2; a swapped `Mutex` lock order could deadlock during `WatcherHandle::Drop`.
- **Explain:** Mitigation — step 10 is its own commit with no other changes. Reviewer must run a `diff -u` between the deleted `watcher.rs::{start_agent_watcher,start_watching}` bodies and the new `base::start_for` body and confirm every change is one of:
  1. `parse_statusline(&sid, &c)` → `adapter.parse_status(&sid, &c)`
  2. `validate_transcript_path(p)` → `adapter.validate_transcript(p)`
  3. status-file-path construction → `let src = adapter.status_source(cwd, sid)` plus a NEW trust-root verification step (Finding 5). The verification handles the first-run case where `<cwd>/.vimeflow/sessions/<sid>` may not yet exist (Codex review third-pass Finding 3 — `fs::canonicalize` on a missing path returns Err, which would break every fresh session). Procedure: canonicalize `src.trust_root` first (always exists — it's the workspace cwd), then walk up `src.path`'s ancestors to find the deepest _existing_ prefix, canonicalize that prefix, and assert it `starts_with(canonical_trust_root)` BEFORE `create_dir_all`. After `create_dir_all` succeeds, re-canonicalize the now-existing parent and re-verify under `canonical_trust_root` — the second check catches symlink escapes that the lexical-ancestor probe could miss (e.g. an attacker plants a symlink at `<cwd>/.vimeflow` between detection and creation; the post-create canonicalize sees through the symlink). Sketch:

     ```rust
     // 1. trust_root preexists; this canonicalize must succeed.
     let canonical_root = fs::canonicalize(&src.trust_root)
         .map_err(|e| format!("trust_root not resolvable: {}: {}",
                              src.trust_root.display(), e))?;
     // 2. Pre-create: walk up to the deepest existing ancestor of
     //    src.path's parent and canonicalize it. Reject before mkdir
     //    so a malicious adapter can't trick base into creating
     //    directories outside the workspace.
     let parent = src.path.parent()
         .ok_or_else(|| "status path has no parent".to_string())?;
     let resolved_ancestor = {
         let mut probe = parent;
         loop {
             if probe.exists() {
                 break fs::canonicalize(probe)
                     .map_err(|e| format!("ancestor canonicalize failed: {}", e))?;
             }
             probe = probe.parent().ok_or_else(|| {
                 format!("status path escapes filesystem root: {}",
                         parent.display())
             })?;
         }
     };
     if !resolved_ancestor.starts_with(&canonical_root) {
         return Err(format!(
             "status source path escapes trust_root: {} not under {}",
             resolved_ancestor.display(), canonical_root.display(),
         ));
     }
     // 3. Now safe to mkdir + watch (existing logic).
     fs::create_dir_all(parent)?;
     // 4. Post-create: catches any symlink race between (2) and now.
     let canonical_parent = fs::canonicalize(parent)
         .map_err(|e| format!("post-create canonicalize failed: {}", e))?;
     if !canonical_parent.starts_with(&canonical_root) {
         return Err(format!(
             "status parent escapes trust_root after create: {} not under {}",
             canonical_parent.display(), canonical_root.display(),
         ));
     }
     ```

  4. inline `transcript::start_tailing(app, sid, path, cwd)` → `state.start_or_replace(adapter.clone(), app, sid, path, cwd)` (the registry then calls `adapter.tail_transcript(...)`). The watcher does NOT call `adapter.tail_transcript` directly; routing through `TranscriptState` preserves the (transcript_path, cwd) identity check, the existing-handle replacement, and the AlreadyRunning short-circuit — Codex review fourth-pass Finding 4.
  5. wrapping the previous `start_agent_watcher` body's `state.remove(&sid)` + active-count log + `state.insert(sid, handle)` flow into the new `start_for` body so the adapter owns lifecycle (Finding 4)
  6. NEW: changing `_watcher: RecommendedWatcher` to `_watcher: Option<RecommendedWatcher>`, adding `transcript_state: TranscriptState` and `session_id: String` fields, and reordering the `Drop` body to (a) `drop(self._watcher.take())` first so notify callbacks cease, (b) signal+join the polling thread, (c) call `self.transcript_state.stop(&self.session_id)` last (Codex review third-pass Finding 1 + earlier Finding 2). Without the explicit `_watcher` drop at the start, late notify callbacks could call `state.start_or_replace(...)` AFTER the cascade ran, restarting the very tailer we tried to stop — Rust's implicit field-drop runs _after_ the Drop body, so leaving `_watcher` to implicit cleanup is the bug. This is genuinely new behavior, intended: it's what makes step 13's removal of `stop_transcript_watcher` safe.
     No other changes are admissible in this commit.

- **Alternatives considered:** Splitting step 10 across two commits (first introduce the generic free fn paralleling the existing one, then switch callers). Rejected — doubles the diff surface and creates a transient state where two parallel watchers could race if a test runs in between.

### IDEA — `NoOpAdapter` for non-Claude agents in `for_type`

- **Intent:** Today, `start_agent_watcher` for a non-Claude detected agent silently no-ops at the Tauri level — the watcher starts, watches the never-written `<cwd>/.vimeflow/sessions/<sid>/status.json` path, and emits no events; the frontend's `watcherStartedRef.current` flips to `true`, and the exit-collapse path runs naturally when the process dies. Stage 1 must preserve that exit-collapse behavior, **not** just preserve the no-events behavior.
- **Danger:** Two paths for unsupported agents looked equivalent at first; only one actually preserves Stage 0:
  - **Panic via `unimplemented!`.** Crashes the backend whenever a user runs `codex` under Vimeflow during the Stage-1 → Stage-2 window. Rejected.
  - **Return `Err` from `for_type`.** Looked clean — the Tauri catch at `useAgentStatus.ts:135-138` already swallows watcher-start errors. But this **regresses the UI** (Codex review fifth-pass Finding 1): `watcherStartedRef.current` never flips to `true` because `start_agent_watcher` failed. When the agent later exits, the early-return at `useAgentStatus.ts:141-143` skips the collapse. The status panel stays in `isActive: true` indefinitely. Rejected.
- **Explain:** The factory returns `Ok(Arc::new(NoOpAdapter::new(other)))` for every variant except `ClaudeCode`. `NoOpAdapter` is a tiny struct (one `AgentType` field) whose hooks (a) return Claude's status-source path so the watcher creates the same directory and watches the same file Claude does, and (b) return `Err` from `parse_status` / `validate_transcript` / `tail_transcript` because those should never be called (no statusline.sh writes to the file under non-Claude agents). User-visible behavior under a Codex session: detection lights up the agent as `'codex'`; the status panel stays inactive (no events fire); when Codex exits, detection-driven collapse runs and the panel returns to its inactive state — **identical** to Stage 0.
- **Alternatives considered:**
  - **Frontend change: rework the `useAgentStatus.ts` collapse gate** to track "agent ever detected" separately from "watcher started." Honest but violates the Stage 1 "no frontend contract changes" non-goal; defer to Stage 2 if the dual-ref shape becomes worth cleaning up. Rejected for Stage 1.
  - **Use `ClaudeCodeAdapter` for all agents during Stage 1.** Zero new code, but semantically misleading (`agent_type()` would lie about which agent it represents). Rejected — `NoOpAdapter` is the same size and honest about what it represents.

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
