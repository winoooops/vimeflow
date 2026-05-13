# PR-A — Runtime-neutral Rust backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every Tauri-coupled Rust surface (`tauri::State`, `tauri::AppHandle`, `tauri::Runtime`, `tauri::Emitter`, `tauri::Manager`) into a consolidated `BackendState` deep module + an `EventSink` trait. Tauri stays as the host for this PR; a thin `TauriEventSink` adapter bridges the two worlds.

**Architecture:** Add `src-tauri/src/runtime/{mod,state,event_sink,tauri_bridge}.rs`. `BackendState` carries five per-domain fields (PTY / SessionCache / AgentWatcherState / TranscriptState / GitWatcherState) plus `Arc<dyn EventSink>` — per-domain locks preserved. Every `#[tauri::command]` collapses to a one-liner forwarding to a `BackendState` method; every `app.emit(...)` becomes `state.events.emit_*(...)`. `AgentAdapter<R: Runtime>` drops the generic and concrete adapters store `Arc<dyn EventSink>` (not `Arc<BackendState>` — that would cycle through `agents → WatcherHandle → adapter`).

**Tech Stack:** Rust 2021, Tauri 2.x, Tokio, serde / serde_json, ts-rs, portable-pty, notify, tempfile (test-only).

**Spec:** `docs/superpowers/specs/2026-05-13-pr-a-runtime-neutral-rust-backend-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` (the original "one-PR" plan, kept as the 4-PR index).

---

## File Structure

### New (4 files)

- `src-tauri/src/runtime/mod.rs` — re-exports `BackendState`, `EventSink`, `TauriEventSink`; cfg-gated `FakeEventSink`
- `src-tauri/src/runtime/event_sink.rs` — `EventSink` trait + 8 typed helpers + `FakeEventSink`
- `src-tauri/src/runtime/tauri_bridge.rs` — `TauriEventSink` adapter
- `src-tauri/src/runtime/state.rs` — `BackendState` struct + ~20 business methods

### Modified (16+ files)

- `src-tauri/Cargo.toml` — add `tempfile` to `[dev-dependencies]` (if absent)
- `src-tauri/src/lib.rs` — replace `manage` calls with a single `BackendState` manage; keep `e2e-test` cache wipe; route `ExitRequested` through `state.shutdown()`
- `src-tauri/src/terminal/commands.rs` — every `#[tauri::command]` becomes a one-liner forwarding to `BackendState`; `app.emit` → `state.events.emit_*`
- `src-tauri/src/terminal/test_commands.rs` — `list_active_pty_sessions` collapses to a thin wrapper around `BackendState::list_active_pty_sessions`
- `src-tauri/src/filesystem/{list,read,write}.rs` — thin Tauri wrappers
- `src-tauri/src/git/mod.rs` — thin Tauri wrappers
- `src-tauri/src/git/watcher.rs` — promote `GitStatusChangedPayload` to `pub`; route emit via `state.events`
- `src-tauri/src/agent/commands.rs` — thin Tauri wrappers
- `src-tauri/src/agent/adapter/mod.rs` — drop `<R: Runtime>` generic from `AgentAdapter`
- `src-tauri/src/agent/adapter/claude_code/mod.rs` — adapter stores `Arc<dyn EventSink>`; constructor change
- `src-tauri/src/agent/adapter/codex/mod.rs` — same shape as claude_code
- `src-tauri/src/agent/adapter/base/watcher_runtime.rs` — emit via `state.events`
- `src-tauri/src/agent/adapter/base/transcript_state.rs` — store `Arc<dyn EventSink>` instead of `AppHandle<R>`
- `src-tauri/src/agent/adapter/claude_code/transcript.rs` — emit via stored `Arc<dyn EventSink>`
- `src-tauri/src/agent/adapter/codex/transcript.rs` — same shape
- `src-tauri/src/agent/adapter/claude_code/test_runners/emitter.rs` — emit via stored `Arc<dyn EventSink>`
- Various `*_test*.rs` / `tests/**.rs` — adapter-generic test call-site sweep + new parity tests

### Files NOT touched

- `src-tauri/src/main.rs`, `agent/detector.rs`, `agent/types.rs`, `agent/jsonl.rs` (does not exist — see plan task 0)
- `git/{status,diff}.rs` (pure data layer)
- `terminal/{state,cache,bridge,events,types}.rs` (per-domain state internals)
- All TypeScript (`src/**`)
- All workflows (`.github/workflows/**`)
- All E2E specs (`tests/e2e/**`)

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean**

```bash
cd /home/will/projects/vimeflow
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Confirm Rust tests are green**

```bash
cd src-tauri && cargo test
```

Expected: all tests pass; record the test count (e.g., "120 tests" or whatever the current number is) — Task 15 verifies the count climbed by ~30-40.

- [ ] **Step 3: Confirm TS tests + type-check + lint are green**

```bash
cd /home/will/projects/vimeflow
npm run test
npm run type-check
npm run lint
```

Expected: all green.

- [ ] **Step 4: Inventory current Tauri coupling for diff scope**

```bash
cd /home/will/projects/vimeflow
rg -nE "tauri::AppHandle|tauri::State|tauri::Runtime|app\.emit|app_handle\.emit|handle\.emit" src-tauri/src \
  --glob '!src-tauri/target/**' \
  --glob '!src-tauri/gen/**' \
  --glob '!src-tauri/bindings/**' > /tmp/pr-a-baseline.txt
wc -l /tmp/pr-a-baseline.txt
```

Expected: many hits — these are the call sites Task 6-13 collapses into the `BackendState` / `EventSink` shape. Save for diff comparison at Task 15.

---

## Task 1: Add `tempfile` to dev-deps + promote `GitStatusChangedPayload` to `pub`

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/git/watcher.rs:352`

- [ ] **Step 1: Check if `tempfile` is already a dev dep**

```bash
grep -nE "^tempfile" src-tauri/Cargo.toml
```

If a line appears under `[dev-dependencies]`, skip to Step 2. Otherwise:

- [ ] **Step 2: Add `tempfile` to `[dev-dependencies]`**

Append to `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
# ... existing entries below this line
```

(If `[dev-dependencies]` already exists, add the `tempfile = "3"` line inside it.)

- [ ] **Step 3: Promote `GitStatusChangedPayload` to `pub`**

Edit `src-tauri/src/git/watcher.rs:352`:

```rust
// Before:
#[derive(Serialize, Clone, Debug)]
struct GitStatusChangedPayload {
    cwds: Vec<String>,
}

// After:
/// Wire payload for the `git-status-changed` event. Promoted from
/// module-private to `pub` in PR-A so `runtime/event_sink.rs`'s
/// typed helper `emit_git_status_changed(&GitStatusChangedPayload)`
/// can reference the type. Adding or renaming fields here is a
/// breaking change for the renderer.
#[derive(Serialize, Clone, Debug)]
pub struct GitStatusChangedPayload {
    pub cwds: Vec<String>,
}
```

(Field `cwds` must also be `pub` so callers in `runtime/event_sink.rs` and `runtime/state.rs` can construct values.)

- [ ] **Step 4: Verify the visibility change compiles**

```bash
cd src-tauri && cargo build
```

Expected: clean build (no errors, no new warnings about unused pub).

- [ ] **Step 5: Confirm `TestRunSnapshot` is already `pub`**

```bash
grep -n "pub struct TestRunSnapshot" src-tauri/src/agent/adapter/claude_code/test_runners/types.rs
```

Expected: one hit at the struct definition. If the struct is private, edit the same file to add `pub` to the struct + every field (mirror the GitStatusChangedPayload promotion above). If it's already `pub`, skip.

- [ ] **Step 6: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/Cargo.toml src-tauri/src/git/watcher.rs
git commit -m "chore(backend): add tempfile dev-dep + promote GitStatusChangedPayload to pub"
```

(If Task 1 Step 5 required a TestRunSnapshot edit, include that file in `git add` too.)

---

## Task 2: Create `runtime/event_sink.rs` — `EventSink` trait + typed helpers + `FakeEventSink`

**Files:**

- Create: `src-tauri/src/runtime/mod.rs` (initial barrel; FakeEventSink re-export added in this task)
- Create: `src-tauri/src/runtime/event_sink.rs`
- Create: `src-tauri/src/runtime/event_sink_test.rs` (inline tests via `#[cfg(test)] mod tests` in event_sink.rs)
- Modify: `src-tauri/src/lib.rs` — add `pub mod runtime;` so the new module is part of the crate

- [ ] **Step 1: Wire the new module into the library**

Edit `src-tauri/src/lib.rs`, add near the top with the other `pub mod` declarations:

```rust
pub mod runtime;
```

- [ ] **Step 2: Create the initial barrel `runtime/mod.rs`**

```rust
// src-tauri/src/runtime/mod.rs

//! Runtime-neutral backend layer. Production builds bind to Tauri via
//! `TauriEventSink`; PR-B will add `StdoutEventSink` for the Electron
//! sidecar. Tests use `FakeEventSink`.
//!
//! See `docs/superpowers/specs/2026-05-13-pr-a-runtime-neutral-rust-backend-design.md`
//! for the full design.

pub mod event_sink;
// state.rs and tauri_bridge.rs added in later tasks.

pub use event_sink::EventSink;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
```

- [ ] **Step 3: Write the failing test for `FakeEventSink` recording**

Create `src-tauri/src/runtime/event_sink.rs` with just the test module first (TDD red):

```rust
// src-tauri/src/runtime/event_sink.rs

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fake_event_sink_records_emit_json() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({"session_id": "s1", "data": "hello"}))
            .expect("emit");
        let recorded = sink.recorded();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "pty-data");
        assert_eq!(recorded[0].1["session_id"], "s1");
    }

    #[test]
    fn fake_event_sink_count_filters_by_name() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({})).expect("emit");
        sink.emit_json("pty-exit", json!({})).expect("emit");
        sink.emit_json("pty-data", json!({})).expect("emit");
        assert_eq!(sink.count("pty-data"), 2);
        assert_eq!(sink.count("pty-exit"), 1);
        assert_eq!(sink.count("nope"), 0);
    }

    #[test]
    fn fake_event_sink_concurrent_emits_record_in_order() {
        use std::thread;
        let sink = FakeEventSink::new();
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let sink = sink.clone();
                thread::spawn(move || {
                    sink.emit_json(&format!("evt-{i}"), json!({})).expect("emit");
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(sink.recorded().len(), 10);
    }
}
```

- [ ] **Step 4: Run the test, expect failure (no types defined yet)**

```bash
cd src-tauri && cargo test --lib runtime::event_sink::tests
```

Expected: FAIL with `cannot find type FakeEventSink in this scope`.

- [ ] **Step 5: Implement the trait + helpers + fake**

Replace the file contents of `src-tauri/src/runtime/event_sink.rs` with:

```rust
// src-tauri/src/runtime/event_sink.rs

use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::agent::adapter::claude_code::test_runners::types::TestRunSnapshot;
use crate::agent::types::{AgentStatusEvent, AgentToolCallEvent, AgentTurnEvent};
use crate::git::watcher::GitStatusChangedPayload;
use crate::terminal::types::{PtyDataEvent, PtyErrorEvent, PtyExitEvent};

/// Runtime-neutral event emission. Concrete impls:
///   - `TauriEventSink` (production today; defined in `tauri_bridge.rs`)
///   - `StdoutEventSink` (PR-B; defined in `runtime/ipc.rs`)
///   - `FakeEventSink` (tests; defined below behind `#[cfg]`)
///
/// Only `emit_json` is required; the typed helpers default-implement
/// via `serde_json::to_value`. New events the Rust backend emits get
/// a new helper here; events the Rust side does NOT emit (e.g. the
/// frontend-poll-only `agent-detected` / `agent-disconnected`) do
/// NOT get helpers.
pub trait EventSink: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String>;

    fn emit_pty_data(&self, payload: &PtyDataEvent) -> Result<(), String> {
        self.emit_json("pty-data", serialize(payload)?)
    }

    fn emit_pty_exit(&self, payload: &PtyExitEvent) -> Result<(), String> {
        self.emit_json("pty-exit", serialize(payload)?)
    }

    fn emit_pty_error(&self, payload: &PtyErrorEvent) -> Result<(), String> {
        self.emit_json("pty-error", serialize(payload)?)
    }

    fn emit_agent_status(&self, payload: &AgentStatusEvent) -> Result<(), String> {
        self.emit_json("agent-status", serialize(payload)?)
    }

    fn emit_agent_tool_call(
        &self,
        payload: &AgentToolCallEvent,
    ) -> Result<(), String> {
        self.emit_json("agent-tool-call", serialize(payload)?)
    }

    fn emit_agent_turn(&self, payload: &AgentTurnEvent) -> Result<(), String> {
        self.emit_json("agent-turn", serialize(payload)?)
    }

    fn emit_test_run(&self, payload: &TestRunSnapshot) -> Result<(), String> {
        self.emit_json("test-run", serialize(payload)?)
    }

    fn emit_git_status_changed(
        &self,
        payload: &GitStatusChangedPayload,
    ) -> Result<(), String> {
        self.emit_json("git-status-changed", serialize(payload)?)
    }
}

#[inline]
fn serialize<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| format!("event serialize: {err}"))
}

#[cfg(any(test, feature = "e2e-test"))]
pub struct FakeEventSink {
    recorded: Mutex<Vec<(String, Value)>>,
}

#[cfg(any(test, feature = "e2e-test"))]
impl FakeEventSink {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            recorded: Mutex::new(Vec::new()),
        })
    }

    /// WARNING: clones the full event log on every call. For
    /// end-of-test assertions, not per-iteration polling. For
    /// per-event-name counting, use `count(event)` which lifts the
    /// lock once.
    pub fn recorded(&self) -> Vec<(String, Value)> {
        self.recorded.lock().expect("FakeEventSink poisoned").clone()
    }

    pub fn count(&self, event: &str) -> usize {
        self.recorded
            .lock()
            .expect("FakeEventSink poisoned")
            .iter()
            .filter(|(name, _)| name == event)
            .count()
    }
}

#[cfg(any(test, feature = "e2e-test"))]
impl EventSink for FakeEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.recorded
            .lock()
            .map_err(|err| format!("FakeEventSink poisoned: {err}"))?
            .push((event.to_string(), payload));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fake_event_sink_records_emit_json() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({"session_id": "s1", "data": "hello"}))
            .expect("emit");
        let recorded = sink.recorded();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "pty-data");
        assert_eq!(recorded[0].1["session_id"], "s1");
    }

    #[test]
    fn fake_event_sink_count_filters_by_name() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({})).expect("emit");
        sink.emit_json("pty-exit", json!({})).expect("emit");
        sink.emit_json("pty-data", json!({})).expect("emit");
        assert_eq!(sink.count("pty-data"), 2);
        assert_eq!(sink.count("pty-exit"), 1);
        assert_eq!(sink.count("nope"), 0);
    }

    #[test]
    fn fake_event_sink_concurrent_emits_record_in_order() {
        use std::thread;
        let sink = FakeEventSink::new();
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let sink = sink.clone();
                thread::spawn(move || {
                    sink.emit_json(&format!("evt-{i}"), json!({}))
                        .expect("emit");
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(sink.recorded().len(), 10);
    }
}
```

- [ ] **Step 6: Run the tests, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::event_sink::tests
```

Expected: 3 tests pass.

- [ ] **Step 7: Verify the full crate still compiles**

```bash
cd src-tauri && cargo build
```

Expected: clean build.

- [ ] **Step 8: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/lib.rs src-tauri/src/runtime/mod.rs src-tauri/src/runtime/event_sink.rs
git commit -m "feat(runtime): EventSink trait + typed helpers + FakeEventSink"
```

---

## Task 3: Create `runtime/tauri_bridge.rs` — `TauriEventSink` adapter

**Files:**

- Create: `src-tauri/src/runtime/tauri_bridge.rs`
- Modify: `src-tauri/src/runtime/mod.rs` — add `pub mod tauri_bridge;` + re-export

- [ ] **Step 1: Add the module declaration + re-export**

Edit `src-tauri/src/runtime/mod.rs`:

```rust
// src-tauri/src/runtime/mod.rs

pub mod event_sink;
pub mod tauri_bridge;
// state.rs added in Task 4.

pub use event_sink::EventSink;
pub use tauri_bridge::TauriEventSink;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
```

- [ ] **Step 2: Implement the adapter**

```rust
// src-tauri/src/runtime/tauri_bridge.rs

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::event_sink::EventSink;

/// Adapter that bridges the runtime-neutral `EventSink` trait to
/// Tauri's `AppHandle::emit`. This is the ONLY file in
/// `src-tauri/src/runtime/` that imports `tauri::*`. PR-D deletes
/// this file as the mechanical final step of the Tauri removal.
pub struct TauriEventSink {
    handle: AppHandle,
}

impl TauriEventSink {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.handle
            .emit(event, payload)
            .map_err(|err| format!("tauri emit {event}: {err}"))
    }
}
```

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri && cargo build
```

Expected: clean build (no warning about unused `TauriEventSink` because `mod.rs` re-exports it).

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/mod.rs src-tauri/src/runtime/tauri_bridge.rs
git commit -m "feat(runtime): TauriEventSink adapter (production EventSink for Tauri host)"
```

---

## Task 4: Create `runtime/state.rs` — `BackendState` skeleton + constructors + shutdown

This task adds the struct and its three lifecycle methods (`new`, `with_fake_sink`, `shutdown`) but NOT the ~20 business methods (those land in Tasks 6-13 as each domain migrates).

**Files:**

- Create: `src-tauri/src/runtime/state.rs`
- Modify: `src-tauri/src/runtime/mod.rs` — add `pub mod state;` + re-export

- [ ] **Step 1: Add the module declaration + re-export**

Edit `src-tauri/src/runtime/mod.rs`:

```rust
// src-tauri/src/runtime/mod.rs

pub mod event_sink;
pub mod state;
pub mod tauri_bridge;

pub use event_sink::EventSink;
pub use state::BackendState;
pub use tauri_bridge::TauriEventSink;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
```

- [ ] **Step 2: Write the failing tests for the constructors + shutdown**

```rust
// inline at the bottom of src-tauri/src/runtime/state.rs (file does not exist yet)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_fake_sink_returns_arc_state_and_fake_and_temp_dir() {
        let (state, sink, _temp) = BackendState::with_fake_sink();
        // Construction succeeded; types compile.
        assert!(Arc::strong_count(&state) >= 1);
        assert_eq!(sink.recorded().len(), 0);
    }

    #[test]
    fn shutdown_clears_session_cache_and_is_idempotent() {
        let (state, _sink, _temp) = BackendState::with_fake_sink();
        // First call: clears the (already-empty) cache; should not panic.
        state.shutdown();
        // Second call: same, must not panic — graceful exit fires twice
        // on some platforms (Windows close + relaunch).
        state.shutdown();
    }
}
```

- [ ] **Step 3: Run the test, expect failure (no file)**

```bash
cd src-tauri && cargo test --lib runtime::state::tests
```

Expected: FAIL — `cannot find module state`.

- [ ] **Step 4: Implement the struct + constructors + shutdown**

```rust
// src-tauri/src/runtime/state.rs

use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::adapter::base::transcript_state::TranscriptState;
use crate::agent::adapter::base::watcher_runtime::AgentWatcherState;
use crate::git::watcher::GitWatcherState;
use crate::terminal::cache::SessionCache;
use crate::terminal::state::PtyState;

use super::event_sink::EventSink;

/// Consolidated backend state. Owns the five per-domain types
/// previously managed by Tauri's `manage<T>` mechanism, plus the
/// event sink. Per-domain locks live inside each domain's type;
/// `BackendState` is just the carrier.
///
/// Construction:
///   - Production: `BackendState::new(app_data_dir, TauriEventSink)`
///     from Tauri's setup hook.
///   - Tests: `BackendState::with_fake_sink()` — bypasses Tauri,
///     uses an in-memory temp dir + `FakeEventSink`.
pub struct BackendState {
    pub(crate) pty: PtyState,
    pub(crate) sessions: Arc<SessionCache>,
    pub(crate) agents: AgentWatcherState,
    pub(crate) transcripts: TranscriptState,
    pub(crate) git: GitWatcherState,
    pub(crate) events: Arc<dyn EventSink>,
}

impl BackendState {
    /// Production constructor. `app_data_dir` is
    /// `tauri::Manager::path().app_data_dir()` today (PR-B will pass
    /// `app.getPath('userData')` from Electron). The cache file path
    /// is `app_data_dir.join("sessions.json")` — the same expression
    /// `lib.rs` uses today.
    pub fn new(app_data_dir: PathBuf, events: Arc<dyn EventSink>) -> Self {
        let cache_path = app_data_dir.join("sessions.json");
        let sessions = Arc::new(SessionCache::load_or_recover(cache_path));
        Self {
            pty: PtyState::new(),
            sessions,
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
        }
    }

    /// Test-only constructor. Returns `(Arc<BackendState>,
    /// Arc<FakeEventSink>, tempfile::TempDir)`. The caller MUST hold
    /// the `TempDir` for the lifetime of the state — `TempDir::Drop`
    /// removes the cache file out from under the test if it's
    /// dropped early.
    #[cfg(any(test, feature = "e2e-test"))]
    pub fn with_fake_sink() -> (
        Arc<Self>,
        Arc<super::event_sink::FakeEventSink>,
        tempfile::TempDir,
    ) {
        let temp_dir = tempfile::tempdir().expect("temp dir for test BackendState");
        let cache_path = temp_dir.path().join("sessions.json");
        let sink = super::event_sink::FakeEventSink::new();
        let events: Arc<dyn EventSink> = sink.clone();
        let state = Arc::new(Self {
            pty: PtyState::new(),
            sessions: Arc::new(SessionCache::load_or_recover(cache_path)),
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
        });
        (state, sink, temp_dir)
    }

    /// Graceful shutdown — clears the session cache. Idempotent
    /// (second call on an empty cache is a no-op). Errors are
    /// logged at warn level; a clear-failure must not block shutdown.
    pub fn shutdown(&self) {
        if let Err(err) = self.sessions.clear_all() {
            log::warn!("BackendState::shutdown: cache clear failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_fake_sink_returns_arc_state_and_fake_and_temp_dir() {
        let (state, sink, _temp) = BackendState::with_fake_sink();
        assert!(Arc::strong_count(&state) >= 1);
        assert_eq!(sink.recorded().len(), 0);
    }

    #[test]
    fn shutdown_clears_session_cache_and_is_idempotent() {
        let (state, _sink, _temp) = BackendState::with_fake_sink();
        state.shutdown();
        state.shutdown();
    }
}
```

- [ ] **Step 5: Run the tests, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::state::tests
```

Expected: 2 tests pass.

- [ ] **Step 6: Confirm the crate still compiles + all tests still pass**

```bash
cd src-tauri && cargo test
```

Expected: full Rust test suite green.

- [ ] **Step 7: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/mod.rs src-tauri/src/runtime/state.rs
git commit -m "feat(runtime): BackendState struct + constructors + shutdown"
```

---

## Task 5: Migrate `terminal/commands.rs` to `BackendState` (one command per sub-step)

This is the biggest migration. There are 9 PTY-related commands today: `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`, `list_sessions`, `set_active_session`, `reorder_sessions`, `update_session_cwd`, plus `list_active_pty_sessions` (e2e-only, handled in Task 8).

For EACH command, the migration shape is identical:

1. Cut the body of `#[tauri::command] async fn spawn_pty(...)` from `terminal/commands.rs`.
2. Paste into `impl BackendState { pub async fn spawn_pty(...) }` in `runtime/state.rs`.
3. Drop the `tauri::State<'_, T>` and `tauri::AppHandle` argument extractions; read from `&self.pty` / `&self.events` / `&self.sessions`.
4. Replace `app.emit("event-name", payload)` with `self.events.emit_event_name(&payload)` (use the typed helper that matches the event name).
5. Replace the original Tauri command body with a one-liner forwarder: `state.spawn_pty(request).await`.

A test must accompany each migration: a `BackendState::with_fake_sink()` test that exercises the new method and asserts the event sequence in `fake_sink.recorded()`.

This task is structured as 8 sub-tasks (one per command). Each sub-task = 5 steps (red test, run-fail, migrate, run-pass, commit).

**Files:**

- Modify: `src-tauri/src/terminal/commands.rs` (every command body collapses)
- Modify: `src-tauri/src/runtime/state.rs` (new methods added)
- Modify: `src-tauri/src/terminal/commands_test.rs` or similar (existing tests + new parity tests)

### Task 5.1: `spawn_pty`

- [ ] **Step 1: Write parity test for the new method**

Add to `src-tauri/src/runtime/state.rs` inside the existing `mod tests`:

```rust
#[tokio::test]
async fn spawn_pty_emits_pty_data_via_event_sink() {
    let (state, sink, _temp) = BackendState::with_fake_sink();
    let request = crate::terminal::types::SpawnPtyRequest {
        cwd: "~".into(),
        env: Default::default(),
        enable_agent_bridge: false,
    };
    let session = state.spawn_pty(request).await.expect("spawn");
    // Wait briefly for the PTY read-loop to produce the prompt.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(sink.count("pty-data") >= 1);
    // Cleanup so the test doesn't leak the child process.
    state.kill_pty(crate::terminal::types::KillPtyRequest {
        session_id: session.id.clone(),
    })
    .expect("kill");
}
```

- [ ] **Step 2: Run, expect compile failure (no `BackendState::spawn_pty` yet)**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::spawn_pty_emits_pty_data_via_event_sink
```

Expected: FAIL — `no method named spawn_pty found`.

- [ ] **Step 3: Migrate the body**

In `src-tauri/src/terminal/commands.rs`, find the current `#[tauri::command] pub async fn spawn_pty(...)` (around line 22). Cut its body. Replace the function with:

```rust
#[tauri::command]
pub async fn spawn_pty(
    state: tauri::State<'_, std::sync::Arc<crate::runtime::BackendState>>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    state.spawn_pty(request).await
}
```

In `src-tauri/src/runtime/state.rs`, add the migrated body inside the `impl BackendState` block:

```rust
pub async fn spawn_pty(
    self: &std::sync::Arc<Self>,
    request: crate::terminal::types::SpawnPtyRequest,
) -> Result<crate::terminal::types::PtySession, String> {
    // <PASTE the body from terminal/commands.rs::spawn_pty here>
    //
    // Apply these three textual substitutions on the pasted body:
    //   1. Where the original used `pty_state: tauri::State<'_, PtyState>`,
    //      use `&self.pty` (or `self.pty.<method>(...)`).
    //   2. Where the original used `cache_state: tauri::State<'_, Arc<SessionCache>>`,
    //      use `self.sessions.clone()` or `&self.sessions`.
    //   3. Where the original used `app.emit("pty-data", payload)`,
    //      use `self.events.emit_pty_data(&payload)`. Same for
    //      `pty-exit` → `self.events.emit_pty_exit(&payload)`,
    //      `pty-error` → `self.events.emit_pty_error(&payload)`.
    //
    // Every other line — cache mutations, lock order, bridge wiring,
    // tombstone-first cleanup — is byte-identical to today.
    todo!("paste body from terminal/commands.rs::spawn_pty (pre-Task 5.1 commit)")
}
```

Replace the `todo!()` with the actual migrated body. Reference the pre-Task-5.1 git blob: `git show HEAD:src-tauri/src/terminal/commands.rs | sed -n '22,90p'` (adjust line range to match the current `spawn_pty` extent).

- [ ] **Step 4: Run the parity test, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::spawn_pty_emits_pty_data_via_event_sink
```

Expected: PASS. If FAIL, the migration introduced a regression — diff the migrated body against `git show HEAD~:src-tauri/src/terminal/commands.rs` and fix.

- [ ] **Step 5: Run the full terminal suite to confirm no regression**

```bash
cd src-tauri && cargo test --lib terminal
```

Expected: every pre-existing terminal test still passes.

- [ ] **Step 6: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/terminal/commands.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(terminal): migrate spawn_pty to BackendState method"
```

### Task 5.2 – 5.8: Repeat the same shape for the remaining 7 commands

For each of: `write_pty`, `resize_pty`, `kill_pty`, `list_sessions`, `set_active_session`, `reorder_sessions`, `update_session_cwd` — run the same 6-step cycle:

1. Write a parity test in `runtime::state::tests` that exercises the new method via `with_fake_sink`.
2. Run it; expect compile failure.
3. Migrate the body from `terminal/commands.rs` into a new `BackendState` method; collapse the Tauri command to a one-liner forwarder.
4. Run the parity test; expect pass.
5. Run the full `terminal` test bucket; expect no regression.
6. Commit with message `refactor(terminal): migrate <command_name> to BackendState method`.

Each sub-task should produce a small, focused commit (one command per commit). At the end of Task 5, the only Tauri-specific content in `terminal/commands.rs` is the `#[tauri::command]` attribute + the one-liner forwarders.

### Task 5 End

- [ ] **Step 1: Verify `terminal/commands.rs` body collapse**

```bash
wc -l src-tauri/src/terminal/commands.rs
```

Expected: drop from ~250-300 LOC to ~80-100 LOC (just the 8 thin wrappers + imports + struct definitions that didn't move).

- [ ] **Step 2: Verify no `app.emit` calls remain in `terminal/commands.rs`**

```bash
grep -nE "app\.emit|app_handle\.emit" src-tauri/src/terminal/commands.rs
```

Expected: zero hits.

---

## Task 6: Migrate `filesystem/{list,read,write}.rs` to `BackendState`

Three small commands: `list_dir`, `read_file`, `write_file`. None emit events; they're pure data ops. Migration is mechanical.

**Files:**

- Modify: `src-tauri/src/filesystem/list.rs`
- Modify: `src-tauri/src/filesystem/read.rs`
- Modify: `src-tauri/src/filesystem/write.rs`
- Modify: `src-tauri/src/runtime/state.rs` (3 new methods)

- [ ] **Step 1: Write parity tests for the 3 new methods**

Add to `runtime/state.rs` tests:

```rust
#[test]
fn list_dir_returns_expected_entries() {
    let (state, _sink, temp) = BackendState::with_fake_sink();
    // Create a couple of files in the temp dir.
    std::fs::write(temp.path().join("a.txt"), b"a").unwrap();
    std::fs::write(temp.path().join("b.txt"), b"b").unwrap();
    let entries = state
        .list_dir(crate::filesystem::list::ListDirRequest {
            path: temp.path().to_string_lossy().into_owned(),
        })
        .expect("list");
    let names: Vec<_> = entries.iter().map(|e| e.name.clone()).collect();
    assert!(names.contains(&"a.txt".to_string()));
    assert!(names.contains(&"b.txt".to_string()));
}

#[test]
fn read_write_file_roundtrip() {
    let (state, _sink, temp) = BackendState::with_fake_sink();
    let path = temp.path().join("greeting.txt").to_string_lossy().into_owned();
    state
        .write_file(crate::filesystem::write::WriteFileRequest {
            path: path.clone(),
            content: "hello".into(),
        })
        .expect("write");
    let content = state
        .read_file(crate::filesystem::read::ReadFileRequest { path: path.clone() })
        .expect("read");
    assert_eq!(content, "hello");
}
```

(Adjust `ListDirRequest` / `ReadFileRequest` / `WriteFileRequest` field names + types to match the actual structs in those modules — use `grep -n "pub struct" src-tauri/src/filesystem/*.rs` if uncertain.)

- [ ] **Step 2: Run tests, expect failure**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::list_dir_returns_expected_entries runtime::state::tests::read_write_file_roundtrip
```

Expected: FAIL — methods don't exist.

- [ ] **Step 3: Migrate `list_dir`, `read_file`, `write_file`**

For each file (`filesystem/list.rs`, `filesystem/read.rs`, `filesystem/write.rs`):

1. Cut the current `#[tauri::command]` body.
2. Add a `BackendState::<command_name>` method in `runtime/state.rs` containing the body.
3. Replace the Tauri command with the one-liner forwarder pattern:

```rust
#[tauri::command]
pub async fn list_dir(
    state: tauri::State<'_, std::sync::Arc<crate::runtime::BackendState>>,
    request: ListDirRequest,
) -> Result<Vec<DirEntry>, String> {
    state.list_dir(request)
}
```

(Note `list_dir` / `read_file` / `write_file` are synchronous in `BackendState` since they don't await IO that's wrapped in Tokio — check today's signature; preserve `async` if the original is `async`.)

- [ ] **Step 4: Run tests, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::list_dir_returns_expected_entries runtime::state::tests::read_write_file_roundtrip filesystem
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/filesystem/list.rs src-tauri/src/filesystem/read.rs src-tauri/src/filesystem/write.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(filesystem): migrate list_dir / read_file / write_file to BackendState"
```

---

## Task 7: Migrate `git/mod.rs` to `BackendState`

Three commands: `git_status`, `git_branch`, `get_git_diff`. Pure-data; no events.

**Files:**

- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/runtime/state.rs`

- [ ] **Step 1: Write parity tests**

Add to `runtime/state.rs` tests:

```rust
#[test]
fn git_branch_returns_repo_branch() {
    let (state, _sink, temp) = BackendState::with_fake_sink();
    // Initialize a tiny git repo in temp.
    std::process::Command::new("git")
        .args(&["init", "-q", "-b", "main"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    let branch = state
        .git_branch(crate::git::types::GitBranchRequest {
            cwd: temp.path().to_string_lossy().into_owned(),
        })
        .expect("branch");
    assert_eq!(branch, "main");
}

#[test]
fn git_status_returns_empty_for_fresh_repo() {
    let (state, _sink, temp) = BackendState::with_fake_sink();
    std::process::Command::new("git")
        .args(&["init", "-q", "-b", "main"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    let status = state
        .git_status(crate::git::types::GitStatusRequest {
            cwd: temp.path().to_string_lossy().into_owned(),
        })
        .expect("status");
    assert!(status.files.is_empty());
}
```

(Adjust request struct names + return types to match the current `git/types.rs` definitions.)

- [ ] **Step 2: Run tests, expect failure**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::git_branch_returns_repo_branch runtime::state::tests::git_status_returns_empty_for_fresh_repo
```

Expected: FAIL — methods don't exist.

- [ ] **Step 3: Migrate `git_status`, `git_branch`, `get_git_diff`**

Migrate from `src-tauri/src/git/mod.rs` to `BackendState` methods. Same one-liner-forwarder pattern.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::git_branch_returns_repo_branch runtime::state::tests::git_status_returns_empty_for_fresh_repo git
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/git/mod.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(git): migrate git_status / git_branch / get_git_diff to BackendState"
```

---

## Task 8: Migrate `terminal/test_commands.rs` (e2e-test only)

**Files:**

- Modify: `src-tauri/src/terminal/test_commands.rs`
- Modify: `src-tauri/src/runtime/state.rs`

- [ ] **Step 1: Write a test for the new method (cfg-gated)**

In `runtime/state.rs` tests, add (behind `cfg(feature = "e2e-test")` if the existing e2e command is gated):

```rust
#[cfg(feature = "e2e-test")]
#[test]
fn list_active_pty_sessions_returns_empty_for_fresh_state() {
    let (state, _sink, _temp) = BackendState::with_fake_sink();
    let active = state.list_active_pty_sessions();
    assert!(active.is_empty());
}
```

- [ ] **Step 2: Run with the e2e-test feature, expect failure**

```bash
cd src-tauri && cargo test --lib --features e2e-test runtime::state::tests::list_active_pty_sessions_returns_empty_for_fresh_state
```

Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Migrate the body**

In `src-tauri/src/terminal/test_commands.rs`, collapse the `list_active_pty_sessions` Tauri command body to a forwarder. Add the corresponding method on `BackendState` in `runtime/state.rs`, behind `#[cfg(feature = "e2e-test")]`.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd src-tauri && cargo test --features e2e-test
```

Expected: every test (including the standard suite) passes with the e2e-test feature enabled.

- [ ] **Step 5: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/terminal/test_commands.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(terminal): migrate list_active_pty_sessions (e2e-only) to BackendState"
```

---

## Task 9: Migrate `agent/commands.rs` to `BackendState`

Three commands: `detect_agent_in_session`, `start_agent_watcher`, `stop_agent_watcher`. These DO emit events (`agent-status`, `agent-tool-call`, etc.) through the agent adapter — but the wire-up to `state.events` lives in Tasks 10-11 (the adapter migration). For Task 9, just migrate the command bodies and pass through to whatever the adapters expose today; Tasks 10-11 swap the inner emission path.

**Files:**

- Modify: `src-tauri/src/agent/commands.rs`
- Modify: `src-tauri/src/runtime/state.rs`

- [ ] **Step 1: Write parity tests**

Add to `runtime/state.rs` tests:

```rust
#[test]
fn detect_agent_in_session_returns_none_for_blank_state() {
    let (state, _sink, _temp) = BackendState::with_fake_sink();
    let result = state.detect_agent_in_session(
        crate::agent::types::DetectAgentRequest {
            session_id: "nonexistent".into(),
        },
    );
    // Detection without an active session is expected to be None or
    // an explicit "no agent" variant; assert whatever the current
    // command returns today by mirroring the existing detect-only
    // test in agent/commands.rs.
    assert!(result.is_ok());
}
```

- [ ] **Step 2: Run, expect failure (method missing)**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::detect_agent_in_session_returns_none_for_blank_state
```

Expected: FAIL.

- [ ] **Step 3: Migrate the three command bodies**

Cut bodies from `agent/commands.rs`, paste into `BackendState` methods, collapse to forwarders. Today's adapters still emit through `AppHandle<R>` — that's fine for this task; Tasks 10-11 swap.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd src-tauri && cargo test --lib agent
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/agent/commands.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(agent): migrate detect / start_watcher / stop_watcher commands to BackendState"
```

---

## Task 10: Drop `<R: tauri::Runtime>` from `AgentAdapter` trait

This is the deepest refactor. The trait + every concrete adapter + every test call-site touches.

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs`
- Modify: `src-tauri/src/agent/adapter/codex/mod.rs`

- [ ] **Step 1: Drop the generic from the trait**

Edit `src-tauri/src/agent/adapter/mod.rs`:

```rust
// Before:
// pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
//     fn detect(&self, app: &AppHandle<R>, info: &SessionInfo) -> Result<...>;
//     ...
// }
//
// After:

pub trait AgentAdapter: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;
    fn detect(&self, info: &SessionInfo) -> Result<DetectionResult, String>;
    fn start_watcher(&self, info: &SessionInfo) -> Result<(), String>;
    fn stop_watcher(&self, session_id: &str) -> Result<bool, String>;
    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;
    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;
}

impl dyn AgentAdapter {
    pub fn for_attach(
        events: std::sync::Arc<dyn crate::runtime::EventSink>,
        agent_type: AgentType,
        pid: u32,
        pty_start: PtyStartId,
    ) -> Result<std::sync::Arc<dyn AgentAdapter>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(std::sync::Arc::new(ClaudeCodeAdapter::new(events))),
            AgentType::Codex => Ok(std::sync::Arc::new(CodexAdapter::new(events, pid, pty_start))),
            // ... preserve every existing match arm; just adapt the constructor calls.
        }
    }

    pub fn stop(state: &Arc<BackendState>, session_id: &str) -> bool {
        // ... migrate today's body that uses AppHandle<R>; substitute
        // state.events for the AppHandle.
    }
}
```

(Use `grep -n "AgentAdapter<" src-tauri/src/agent/adapter/mod.rs` to find every reference and update.)

- [ ] **Step 2: Update `ClaudeCodeAdapter`**

Edit `src-tauri/src/agent/adapter/claude_code/mod.rs`:

```rust
// Before:
// pub struct ClaudeCodeAdapter;
// impl<R: tauri::Runtime> AgentAdapter<R> for ClaudeCodeAdapter { ... }
//
// After:

pub struct ClaudeCodeAdapter {
    events: std::sync::Arc<dyn crate::runtime::EventSink>,
}

impl ClaudeCodeAdapter {
    pub fn new(events: std::sync::Arc<dyn crate::runtime::EventSink>) -> Self {
        Self { events }
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn detect(&self, info: &SessionInfo) -> Result<DetectionResult, String> {
        // <PASTE today's detect body, dropping the `app: &AppHandle<R>` parameter.>
        todo!("paste body from pre-Task-10 ClaudeCodeAdapter::detect")
    }
    // ... same shape for start_watcher, stop_watcher, status_source, parse_status.
}
```

- [ ] **Step 3: Update `CodexAdapter`**

Same shape as `ClaudeCodeAdapter`. Constructor takes `(events, pid, pty_start)`; trait methods drop the AppHandle param; emission uses `self.events.emit_*(...)`.

- [ ] **Step 4: Sweep test call sites**

```bash
cd src-tauri && grep -rn "as AgentAdapter<MockRuntime>>::" src/ tests/ 2>/dev/null
grep -rn "<dyn AgentAdapter<tauri::Wry>>::" src/ tests/ 2>/dev/null
grep -rn "AgentAdapter<MockRuntime>" src/ tests/ 2>/dev/null
```

Every hit must be rewritten:

- `<NoOpAdapter as AgentAdapter<MockRuntime>>::method(&adapter, ...)` → `<NoOpAdapter as AgentAdapter>::method(&adapter, ...)`
- `<dyn AgentAdapter<tauri::Wry>>::for_attach(...)` → `<dyn AgentAdapter>::for_attach(events.clone(), ...)` (call sites now must thread the `events` Arc in)
- `impl<R: tauri::Runtime> AgentAdapter<R> for NoOpAdapter` (in tests) → `impl AgentAdapter for NoOpAdapter`

- [ ] **Step 5: Verify compile + tests**

```bash
cd src-tauri && cargo build
cd src-tauri && cargo test --lib
```

Expected: both green. If the compile fails with `the trait AgentAdapter<R> is not implemented for ...`, that's a leftover call site — grep for `AgentAdapter<` and fix.

- [ ] **Step 6: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/agent/adapter/
git commit -m "refactor(agent): drop <R: Runtime> from AgentAdapter; constructor takes Arc<dyn EventSink>"
```

---

## Task 11: Migrate watcher / transcript / test-runner emission to `state.events`

The actual `app_handle.emit(...)` calls in `agent/adapter/base/{watcher_runtime,transcript_state}.rs` + provider transcripts + `claude_code/test_runners/emitter.rs` must move from `AppHandle<R>` to the stored `Arc<dyn EventSink>` on the adapter.

**Files:**

- Modify: `src-tauri/src/agent/adapter/base/watcher_runtime.rs`
- Modify: `src-tauri/src/agent/adapter/base/transcript_state.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/transcript.rs`
- Modify: `src-tauri/src/agent/adapter/codex/transcript.rs`
- Modify: `src-tauri/src/agent/adapter/claude_code/test_runners/emitter.rs`

- [ ] **Step 1: Write a parity test that exercises an `agent-tool-call` emission via EventSink**

Add to `runtime/state.rs` tests:

```rust
#[tokio::test]
async fn start_agent_watcher_emits_tool_call_after_transcript_line() {
    let (state, sink, _temp) = BackendState::with_fake_sink();
    // 1. Spawn a fake PTY with a controlled transcript path.
    // 2. Drop a synthetic transcript JSONL line for a known tool call.
    // 3. Call state.start_agent_watcher(...) and wait briefly.
    // 4. Assert sink.count("agent-tool-call") >= 1.
    //
    // Body is non-trivial — mirror the existing test in
    // agent/adapter/claude_code/transcript_test.rs but route through
    // state.start_agent_watcher instead of the underlying watcher
    // function directly.
    todo!("port the transcript-tailer test to BackendState API");
}
```

(This test may be substantial — port it from whichever existing test today exercises the same code path. Reference: `grep -rn "agent-tool-call" src-tauri/src/agent/` to find the current emission test.)

- [ ] **Step 2: Run, expect failure**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::start_agent_watcher_emits_tool_call_after_transcript_line
```

Expected: FAIL.

- [ ] **Step 3: Migrate emission sites — `watcher_runtime.rs`**

Search for the three `app_handle.emit("agent-status", ...)` sites identified in baseline (Task 0). Replace each with `self.events.emit_agent_status(&parsed.event)`. The struct must already hold `events: Arc<dyn EventSink>` (added in Task 10 when adapters became non-generic and constructor-stored the sink). If `watcher_runtime.rs` doesn't have access to the sink, thread it through — typically by passing `events: Arc<dyn EventSink>` into whichever function `start_agent_watcher` calls.

- [ ] **Step 4: Migrate emission sites — `claude_code/transcript.rs`**

Replace `app_handle.emit("agent-tool-call", &event)` with `self.events.emit_agent_tool_call(&event)`. Same for `agent-turn`. The transcript tailer struct gains `events: Arc<dyn EventSink>` as a field (replacing whatever `AppHandle<R>` field it had).

- [ ] **Step 5: Migrate `codex/transcript.rs` + `test_runners/emitter.rs`**

Same shape. Each emission site becomes `self.events.emit_<event>(&payload)`.

- [ ] **Step 6: Update `transcript_state.rs`**

Replace `AppHandle<R>` field with `Arc<dyn EventSink>`. Drop the `R: Runtime` generic param wherever it appears in the struct or impl.

- [ ] **Step 7: Verify the parity test passes + full agent suite stays green**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::start_agent_watcher_emits_tool_call_after_transcript_line agent
```

Expected: every test green.

- [ ] **Step 8: Verify no more `app_handle.emit` / `app.emit` calls in `agent/adapter/`**

```bash
grep -rnE "app_handle\.emit|app\.emit" src-tauri/src/agent/adapter/
```

Expected: zero hits.

- [ ] **Step 9: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/agent/adapter/base/ src-tauri/src/agent/adapter/claude_code/ src-tauri/src/agent/adapter/codex/
git commit -m "refactor(agent): route adapter event emission through Arc<dyn EventSink>"
```

---

## Task 12: Migrate `git/watcher.rs` emission to `state.events`

**Files:**

- Modify: `src-tauri/src/git/watcher.rs`
- Modify: `src-tauri/src/runtime/state.rs`

- [ ] **Step 1: Write parity test**

Add to `runtime/state.rs` tests:

```rust
#[tokio::test]
async fn start_git_watcher_emits_git_status_changed_on_file_touch() {
    let (state, sink, temp) = BackendState::with_fake_sink();
    std::process::Command::new("git")
        .args(&["init", "-q", "-b", "main"])
        .current_dir(temp.path())
        .status()
        .unwrap();
    state
        .start_git_watcher(crate::git::types::StartGitWatcherRequest {
            cwd: temp.path().to_string_lossy().into_owned(),
        })
        .expect("start watcher");
    // Touch a file and wait for the notify callback.
    std::fs::write(temp.path().join("a.txt"), b"hello").unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert!(sink.count("git-status-changed") >= 1);
    state
        .stop_git_watcher(crate::git::types::StopGitWatcherRequest {
            cwd: temp.path().to_string_lossy().into_owned(),
        })
        .expect("stop watcher");
}
```

- [ ] **Step 2: Run, expect failure**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::start_git_watcher_emits_git_status_changed_on_file_touch
```

Expected: FAIL — methods don't exist yet OR emission still goes through AppHandle.

- [ ] **Step 3: Migrate emission site in `git/watcher.rs`**

Find the `app_handle.emit("git-status-changed", payload)` call (Task 0 baseline located it at line ~1291). Replace with `events.emit_git_status_changed(&payload)`. The watcher callback closure must capture `events: Arc<dyn EventSink>` instead of `app_handle: AppHandle<R>`.

The `start_git_watcher` Tauri command body migrates to `BackendState::start_git_watcher`, which threads `self.events.clone()` into the notify closure.

- [ ] **Step 4: Collapse the `start_git_watcher` / `stop_git_watcher` Tauri commands to one-liners**

```rust
#[tauri::command]
pub async fn start_git_watcher(
    state: tauri::State<'_, std::sync::Arc<crate::runtime::BackendState>>,
    request: StartGitWatcherRequest,
) -> Result<(), String> {
    state.start_git_watcher(request).await
}

#[tauri::command]
pub async fn stop_git_watcher(
    state: tauri::State<'_, std::sync::Arc<crate::runtime::BackendState>>,
    request: StopGitWatcherRequest,
) -> Result<(), String> {
    state.stop_git_watcher(request).await
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd src-tauri && cargo test --lib runtime::state::tests::start_git_watcher_emits_git_status_changed_on_file_touch git
```

Expected: green.

- [ ] **Step 6: Verify no `app_handle.emit` remains in `git/`**

```bash
grep -rnE "app_handle\.emit|app\.emit" src-tauri/src/git/
```

Expected: zero hits.

- [ ] **Step 7: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/git/watcher.rs src-tauri/src/runtime/state.rs
git commit -m "refactor(git): migrate git watcher emission to EventSink"
```

---

## Task 13: Rewrite `lib.rs` setup hook + ExitRequested handler

This is the final wiring step. Replace the five `.manage(...)` calls with one `BackendState` manage; keep the `e2e-test` cache wipe block in place.

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace the setup hook**

Current setup hook (around line 25-78) creates five `manage<T>` calls. Replace with:

```rust
let builder = tauri::Builder::default()
    .setup(|app| {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .expect("failed to get app_data_dir");
        let cache_path = app_data_dir.join("sessions.json");

        // E2E parity (preserved verbatim from pre-PR-A lib.rs):
        // delete the cache file before BackendState::new reads it.
        #[cfg(feature = "e2e-test")]
        {
            if let Err(e) = std::fs::remove_file(&cache_path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        "e2e-test: failed to remove cache file {}: {}",
                        cache_path.display(),
                        e
                    );
                }
            }
        }

        let sink: std::sync::Arc<dyn crate::runtime::EventSink> =
            std::sync::Arc::new(crate::runtime::TauriEventSink::new(app.handle().clone()));
        let state = std::sync::Arc::new(crate::runtime::BackendState::new(
            app_data_dir,
            sink,
        ));
        app.manage(state);
        Ok(())
    });
// IMPORTANT: remove the chained .manage(PtyState::new()), .manage(AgentWatcherState::new()),
// .manage(TranscriptState::new()), .manage(GitWatcherState::new()) calls — BackendState
// carries all of those now.
```

- [ ] **Step 2: Rewrite the `ExitRequested` handler**

Find the `tauri::RunEvent::ExitRequested` branch at the bottom of `run()` (around line 144). Today it inlines the session cache wipe. Replace with:

```rust
if let tauri::RunEvent::ExitRequested { .. } = event {
    if let Some(state) = handle.try_state::<std::sync::Arc<crate::runtime::BackendState>>() {
        state.shutdown();
    }
}
```

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri && cargo build
```

Expected: clean. If any of the removed `manage` lines are still referenced (e.g., a `tauri::State<'_, PtyState>` extraction in a command that wasn't migrated), the compile errors point right at the missed call site.

- [ ] **Step 4: Run full Rust test suite**

```bash
cd src-tauri && cargo test
cd src-tauri && cargo test --features e2e-test
```

Expected: both green.

- [ ] **Step 5: Manual smoke — `npm run tauri:dev`**

```bash
cd /home/will/projects/vimeflow
npm run tauri:dev
```

Verify in the app:

1. App window opens.
2. Default terminal session spawns and reaches a prompt.
3. Typing into the terminal echoes characters.
4. Open File Explorer; click a file; editor loads.
5. Open the Diff panel; git status shows the current branch.
6. Click "+" in the empty pane slot (5c-2 flow); a second pane spawns.
7. Cmd/Ctrl+Q the app cleanly; relaunch; verify no ghost-Exited sessions in the sidebar.

If any of these fail, the migration introduced a regression — bisect by reverting the offending Task's commit.

- [ ] **Step 6: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/lib.rs
git commit -m "refactor(lib): manage BackendState; route ExitRequested through state.shutdown"
```

---

## Task 14: Update affected unit-test call-site sweep

Task 10 already touched test call sites for the `AgentAdapter<R>` change. This task does a final sweep to catch any other stale references.

**Files:**

- Various tests under `src-tauri/src/` and `src-tauri/tests/`

- [ ] **Step 1: Find any remaining `tauri::State` / `AppHandle` references in tests that pre-date PR-A's migration**

```bash
grep -rnE "tauri::State|AppHandle|mock_app" src-tauri/src/ src-tauri/tests/ 2>/dev/null | grep -vE "tauri_bridge\.rs|TauriEventSink|app\.manage" | head -30
```

Expected hits are limited to:

- `runtime/tauri_bridge.rs` (allowed — production adapter)
- Tests that EXPLICITLY exercise the Tauri command wrapper layer (e.g. existing `mock_app()` tests that prove the wrapper forwards correctly — these stay; PR-D deletes them with the wrappers)

Any other hits are stale and should be ported to the `BackendState::with_fake_sink()` pattern.

- [ ] **Step 2: For each stale hit, port the test**

Replace `let app = mock_app(); ...; app.state::<PtyState>().inner()` with `let (state, sink, _temp) = BackendState::with_fake_sink(); ...`.

For each ported test, ensure the recorded events on `sink` match what the original Tauri-bound test asserted.

- [ ] **Step 3: Run the full Rust test suite + e2e-test variant**

```bash
cd src-tauri && cargo test
cd src-tauri && cargo test --features e2e-test
```

Expected: both green.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/
git commit -m "test(backend): port remaining Tauri-bound tests to BackendState::with_fake_sink"
```

---

## Task 15: Final verification gate

- [ ] **Step 1: Format check**

```bash
cd /home/will/projects/vimeflow
npm run format:check
```

Expected: clean. If not, `npm run format` and re-run; commit any prettier changes separately.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean. No TypeScript changes were made in PR-A; the existing types compile against an unchanged `src/bindings/` (verified by Step 4).

- [ ] **Step 4: Verify ts-rs bindings are unchanged**

```bash
cd src-tauri && cargo test export_bindings
cd /home/will/projects/vimeflow && git status --short src/bindings/
```

Expected: `git status` shows zero changes under `src/bindings/`. If any binding file changed, the spec's "no `#[derive(TS)]` types change" contract was violated by some task — bisect and fix.

- [ ] **Step 5: Full Rust test suite + e2e-test variant**

```bash
cd src-tauri && cargo test
cd src-tauri && cargo test --features e2e-test
```

Expected: both green. Compare the test count against Task 0's baseline; should be ~30-40 higher.

- [ ] **Step 6: TS test suite**

```bash
cd /home/will/projects/vimeflow && npm run test
```

Expected: green and identical count to Task 0.

- [ ] **Step 7: Diff inventory**

```bash
rg -nE "tauri::AppHandle|tauri::State|tauri::Runtime|app\.emit|app_handle\.emit|handle\.emit" \
   src-tauri/src \
   --glob '!src-tauri/target/**' \
   --glob '!src-tauri/gen/**' \
   --glob '!src-tauri/bindings/**' > /tmp/pr-a-post.txt
diff /tmp/pr-a-baseline.txt /tmp/pr-a-post.txt | head -60
```

Expected: every removed hit is a Tauri reference that moved to `runtime/tauri_bridge.rs`, a `#[tauri::command]` one-liner forwarder, or got dropped (e.g. `AppHandle<R>` field on an adapter). No NEW `app.emit` hits outside `tauri_bridge.rs`.

- [ ] **Step 8: Manual smoke — second pass**

```bash
npm run tauri:dev
```

Repeat Task 13 Step 5's manual checklist. If anything is regressed, bisect.

- [ ] **Step 9: Open the PR**

```bash
git push -u origin <pr-a-branch>
gh pr create \
  --base dev \
  --title "feat(backend): PR-A — runtime-neutral Rust backend (Tauri stays as host)" \
  --body "$(cat <<'EOF'
## Summary

PR-A of the 4-PR Tauri → Electron migration. Extracts every Tauri-coupled Rust surface into a consolidated `BackendState` deep module + an `EventSink` trait. Tauri stays as the host; a thin `TauriEventSink` adapter at `runtime/tauri_bridge.rs` keeps the existing `#[tauri::command]` wrappers functional.

## Spec + migration roadmap

- Spec: `docs/superpowers/specs/2026-05-13-pr-a-runtime-neutral-rust-backend-design.md`
- Plan: `docs/superpowers/plans/2026-05-13-pr-a-runtime-neutral-rust-backend.md`
- Roadmap (4-PR index): `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`

## Test plan

- [x] `cargo test` — full Rust suite green
- [x] `cargo test --features e2e-test` — green
- [x] `npm run test` — green (no TS changes, identical count to baseline)
- [x] `npm run type-check` + `npm run lint` + `npm run format:check` — clean
- [x] `src/bindings/` zero-diff — ts-rs bindings unchanged
- [x] Manual smoke: `npm run tauri:dev` — every existing user flow works identically to today (default terminal, file explorer, diff panel, multi-pane add/close, clean Quit + relaunch)

## Cross-PR contract

§5 of the spec locks four contracts the downstream PRs consume:

- §5.1 — Public `BackendState` API (PR-B's IPC router calls it)
- §5.2 — `EventSink` trait (PR-B writes `StdoutEventSink`)
- §5.3 — Event payload serde shapes (PR-C's `backend.ts` binds via ts-rs)
- §5.4 — Tauri removal surface (PR-D's deletion checklist)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Adjust `--base dev` if the long-lived integration branch uses a different name.)

---

## Final Verification Checklist

After PR-A merges to `dev`:

- [ ] The PR-B planner session can start. PR-B consumes §5.1 + §5.2 of the spec.
- [ ] Local dev continues against Tauri (`npm run tauri:dev`) — PR-A didn't change the user-visible shell.
- [ ] `cargo test` test count climbed by ~30-40 (~120 → ~155).
- [ ] No `agent-detected` / `agent-disconnected` events are emitted by Rust (those remain frontend-poll-only).
- [ ] `tauri::AppHandle` references are limited to `runtime/tauri_bridge.rs` + `#[tauri::command]` wrapper functions.

PR-B's planner run is next.
