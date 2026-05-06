# Codex Adapter Trait Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `AgentAdapter` trait so codex-only requirements (`BindContext`, `BindError`, the bounded retry inside `base::start_for`) no longer leak through the trait surface. After the refactor, the trait method is `status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>`, the factory becomes `for_attach(agent_type, pid, pty_start)`, and codex's cold-start retry lives inside `CodexAdapter` itself.

**Architecture:** Move codex-only state (`pid`, `pty_start`, `codex_home`) onto the `CodexAdapter` struct. Introduce a private `pub(super) struct BindContext { cwd, pid, pty_start }` inside `agent/adapter/codex/types.rs` (no `session_id`; the codex locator never reads it). Add a `retry_locator` helper that takes a closure and runs the existing 5-attempt × 100ms-sleep budget (with the trailing sleep skipped, giving a 400ms sleep budget on full exhaustion). Delete `BindContext` + `BindError` from public `agent/adapter/types.rs`. `base::start_for` becomes a single-call orchestrator with no retry/sleep code.

**Tech Stack:** Rust 2021, Tauri, `rusqlite` (read-only feature, already a dep), `tempfile` for tests, `notify` for the file watcher (no change), `tauri::test::MockRuntime` for adapter unit tests.

**Spec reference:** [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../specs/2026-05-05-codex-adapter-trait-simplification-design.md)

**Issue:** [#156](https://github.com/winoooops/vimeflow/issues/156)

---

## File Structure

| File                                                                | Status   | Responsibility                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/agent/adapter/codex/types.rs`                        | Created  | Private `BindContext` struct; visible only inside the `codex/` module tree                                                                                                                                                                                                                               |
| `src-tauri/src/agent/adapter/codex/mod.rs`                          | Modified | New `pid`/`pty_start`/`codex_home` adapter fields; `new(pid, pty_start)` + `#[cfg(test)] with_home`; `default_codex_home()` free fn; `retry_locator` helper + `retry_locator_tests`; new `status_source_tests`; trait impl uses new sig; private BindContext consumed via `use self::types::BindContext` |
| `src-tauri/src/agent/adapter/codex/locator.rs`                      | Modified | Single import edit: `crate::agent::adapter::types::BindContext` → `super::types::BindContext`. No body changes                                                                                                                                                                                           |
| `src-tauri/src/agent/adapter/types.rs`                              | Modified | Delete public `BindContext` struct + `BindError` enum + their Display impls + their pinned-format tests                                                                                                                                                                                                  |
| `src-tauri/src/agent/adapter/mod.rs`                                | Modified | Trait sig change (`(cwd, sid) -> Result<_, String>`); rename `for_type` → `for_attach(agent_type, pid, pty_start)`; `start` drops pid/pty_start; `start_agent_watcher` uses new factory; rewrite `NoOpAdapter::status_source`; rename `for_type_returns_real_codex_adapter` test                         |
| `src-tauri/src/agent/adapter/claude_code/mod.rs`                    | Modified | Trait impl sig change; rewrite `status_source` body to use direct `(cwd, sid)` params; update test                                                                                                                                                                                                       |
| `src-tauri/src/agent/adapter/base/mod.rs`                           | Modified | Drop `resolve_status_source_with_retry`; drop `BIND_RETRY_*` constants; simplify `start_for` body to single status_source call; delete `start_for_retry_tests` module                                                                                                                                    |
| `src-tauri/src/agent/adapter/base/transcript_state.rs`              | Modified | Update `OrderingAdapter` mock's `status_source` impl signature only (FQN-style refs; `unreachable!()` body unchanged)                                                                                                                                                                                    |
| `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`   | Created  | New ADR recording the decision and what spec sections it supersedes                                                                                                                                                                                                                                      |
| `docs/decisions/CLAUDE.md`                                          | Modified | Append the new ADR to the index table                                                                                                                                                                                                                                                                    |
| `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` | Modified | Add `Amended further by:` pointer at top + inline supersede markers                                                                                                                                                                                                                                      |
| `src-tauri/src/agent/README.md`                                     | Modified | Lines 67, 98, 116 updated to describe the post-2026-05-05 flow                                                                                                                                                                                                                                           |

**Total:** 7 modified Rust files, 1 added Rust file, 1 added doc, 3 modified docs.

---

## Task 1: Add private codex `BindContext` types module

Spec section 3.1.

**Files:**

- Create: `src-tauri/src/agent/adapter/codex/types.rs`
- Modify: `src-tauri/src/agent/adapter/codex/mod.rs:1-19` (top-of-file module declarations)

The new types module is dead code until Task 3 wires it. Adding it first lets later tasks reference `super::types::BindContext` from inside `codex/locator.rs` without a forward-declaration dance.

- [ ] **Step 1: Create `codex/types.rs` with the private struct**

```rust
//! Private codex-internal types. Visibility intentionally `pub(super)` so
//! these types do not leak through the `AgentAdapter` trait surface.

use std::path::Path;
use std::time::SystemTime;

/// Bag of attach-time facts the codex locator needs. Built fresh on each
/// `status_source` call from the adapter's stored `pid`/`pty_start` plus
/// the trait method's `cwd` parameter.
///
/// Note: `session_id` is intentionally not a field. The codex locator
/// gates queries by `pid` + `pty_start` + `cwd` only. Carrying `session_id`
/// here would trigger `cargo clippy --all-targets -- -D warnings` to flag
/// the field as dead code. The trait method still receives `session_id`;
/// the codex adapter binds it to `_session_id`.
#[derive(Debug, Clone, Copy)]
pub(super) struct BindContext<'a> {
    pub(super) cwd: &'a Path,
    pub(super) pid: u32,
    pub(super) pty_start: SystemTime,
}
```

- [ ] **Step 2: Add `mod types;` to `codex/mod.rs`**

Edit the existing module-declarations block at the top of the file. Before:

```rust
mod locator;
mod parser;
mod transcript;
```

After:

```rust
mod locator;
mod parser;
mod transcript;
mod types;
```

- [ ] **Step 3: Verify the workspace builds**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: build succeeds. The new `types` module is unused, so rustc may warn `unused module` — acceptable for this intermediate state; Task 3 wires it.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/adapter/codex/types.rs \
        src-tauri/src/agent/adapter/codex/mod.rs
git commit -m "refactor(agent/adapter): add private codex types module

Empty scaffolding for the upcoming trait simplification (issue #156).
The new BindContext is pub(super) so it cannot leak through the
AgentAdapter trait surface. session_id is intentionally omitted —
codex's locator never reads it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `retry_locator` helper and its unit tests

Spec section 3.3 + 4.3.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/mod.rs` (add helper + test module)

The helper is currently unused — Task 3 wires it into `CodexAdapter::status_source`. Adding it standalone first lets us TDD it without touching the trait signature yet.

- [ ] **Step 1: Add module-level constants and import additions**

Insert near the top of `codex/mod.rs`, immediately after the existing `use self::locator::{...}` statement:

```rust
use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError, RolloutLocation};
```

(The previous version of that line did not include `RolloutLocation` — `retry_locator` returns it, so add it now.)

Add these constants near the top of the impl block (or as free constants right after the imports):

```rust
const CODEX_BIND_RETRY_INTERVAL_MS: u64 = 100;
const CODEX_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;
```

- [ ] **Step 2: Add the `retry_locator` helper as a free function**

Add this `fn` to `codex/mod.rs`, after `CodexAdapter`'s `impl` blocks but before the `#[cfg(test)] mod adapter_tests`:

```rust
/// Retry a codex locator resolution up to the bind budget. Returns the
/// resolved location on success, or a formatted error string on:
///
/// - The first non-`NotYetReady` error from the closure (Fatal /
///   Unresolved → bubble up immediately, no further attempts).
/// - Budget exhaustion (`CODEX_BIND_RETRY_MAX_ATTEMPTS` consecutive
///   `NotYetReady` returns).
///
/// The trailing sleep on the final attempt is skipped — exhaustion would
/// follow immediately so the additional sleep only inflates wall clock.
/// Sleep budget on full exhaustion: `(MAX_ATTEMPTS - 1) * INTERVAL_MS` =
/// 400ms with the current constants.
fn retry_locator<F>(mut resolve: F) -> Result<RolloutLocation, String>
where
    F: FnMut() -> Result<RolloutLocation, LocatorError>,
{
    let started = std::time::Instant::now();
    let mut last_reason = String::from("no attempts");

    for attempt in 0..CODEX_BIND_RETRY_MAX_ATTEMPTS {
        match resolve() {
            Ok(location) => return Ok(location),
            Err(LocatorError::NotYetReady) => {
                last_reason = format!("not yet ready (attempt {})", attempt + 1);
                if attempt + 1 < CODEX_BIND_RETRY_MAX_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(
                        CODEX_BIND_RETRY_INTERVAL_MS,
                    ));
                }
            }
            Err(LocatorError::Unresolved(reason))
            | Err(LocatorError::Fatal(reason)) => {
                return Err(format!("codex bind fatal: {}", reason));
            }
        }
    }

    log::warn!(
        "codex bind retry exhausted after {} attempts (elapsed={:?})",
        CODEX_BIND_RETRY_MAX_ATTEMPTS,
        started.elapsed()
    );
    Err(format!("codex bind retry exhausted: {}", last_reason))
}
```

- [ ] **Step 3: Add `retry_locator_tests` test module**

Append this `#[cfg(test)] mod` to the bottom of `codex/mod.rs`:

```rust
#[cfg(test)]
mod retry_locator_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn retries_on_not_yet_ready_then_succeeds() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            if n < 3 {
                Err(LocatorError::NotYetReady)
            } else {
                Ok(RolloutLocation {
                    rollout_path: PathBuf::from("/tmp/rollout.jsonl"),
                    thread_id: "tid".to_string(),
                    state_updated_at_ms: 0,
                })
            }
        });
        assert!(result.is_ok(), "expected Ok after 4th attempt: {:?}", result);
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn returns_err_when_retry_budget_exhausted() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::NotYetReady)
        });
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("retry exhausted"),
            "expected 'retry exhausted' in: {:?}",
            result
        );
        assert_eq!(
            calls.load(Ordering::SeqCst),
            CODEX_BIND_RETRY_MAX_ATTEMPTS as usize,
        );
    }

    #[test]
    fn fatal_short_circuits_immediately() {
        let calls = AtomicUsize::new(0);
        let started = std::time::Instant::now();
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Fatal("permission denied".to_string()))
        });
        assert!(result.is_err());
        assert!(result.as_ref().unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // Generous bound — fatal should not sleep at all (~0ms in
        // practice). 100ms covers loaded-CI scheduler delay.
        assert!(
            started.elapsed() < std::time::Duration::from_millis(100),
            "fatal should short-circuit: elapsed {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn unresolved_short_circuits_immediately() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Unresolved("ambiguous candidates".to_string()))
        });
        assert!(result.is_err());
        assert!(result.as_ref().unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml retry_locator_tests`
Expected: `4 passed`. Each test validates one of the four exit paths (Ok, exhaustion, Fatal, Unresolved).

- [ ] **Step 5: Run the full crate's tests to confirm no collateral damage**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::adapter`
Expected: all existing tests pass; only the new `retry_locator_tests` add to the count.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/adapter/codex/mod.rs
git commit -m "feat(agent/adapter): add codex retry_locator helper

Pure addition. Helper is unused by production code in this commit;
Task 3 of the trait-simplification refactor wires it into
CodexAdapter::status_source. Sleep budget on full exhaustion is
4 × 100ms = 400ms (final-attempt sleep skipped). Fatal/Unresolved
short-circuit immediately.

Tests cover all four exit paths via synthesized closures — no real
~/.codex setup required.

Issue #156. See spec section 3.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Atomic trait simplification

Spec sections 2.1–2.7, 3.2, 3.4, 3.5, 4.1, 4.2.

This is the meat of the refactor. The trait signature change is atomic at the compile boundary — every `impl AgentAdapter` and every callsite must update together. Steps within this task may leave the workspace transiently non-compiling; the final step verifies a clean build + green test suite before commit.

**Files:**

- Modify: `src-tauri/src/agent/adapter/mod.rs` (trait + factory + start + start_agent_watcher + NoOp impl + tests)
- Modify: `src-tauri/src/agent/adapter/claude_code/mod.rs` (impl + test)
- Modify: `src-tauri/src/agent/adapter/codex/mod.rs` (struct fields, new constructors, status_source body, locator() body, adapter_tests)
- Modify: `src-tauri/src/agent/adapter/codex/locator.rs` (one import edit)
- Modify: `src-tauri/src/agent/adapter/base/mod.rs` (start_for body + delete retry helpers + delete retry tests)
- Modify: `src-tauri/src/agent/adapter/base/transcript_state.rs` (mock impl signature)

- [ ] **Step 1: Update the `AgentAdapter` trait signature in `mod.rs`**

Replace the trait declaration. Find:

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;

    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError>;

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;
    ...
```

Replace with:

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;

    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;
    ...
```

(Other trait methods unchanged.)

- [ ] **Step 2: Update top-of-file imports in `mod.rs`**

In `agent/adapter/mod.rs`, change the imports near the top of the file. Find:

```rust
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use tauri::AppHandle;

pub use base::AgentWatcherState;

use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
use crate::terminal::types::SessionId;
use crate::terminal::PtyState;
use base::TranscriptHandle;
use claude_code::ClaudeCodeAdapter;
use codex::CodexAdapter;
use types::{BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError};
```

Replace with:

```rust
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use tauri::AppHandle;

pub use base::AgentWatcherState;

use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
use crate::terminal::types::SessionId;
use crate::terminal::PtyState;
use base::TranscriptHandle;
use claude_code::ClaudeCodeAdapter;
use codex::CodexAdapter;
use types::{ParsedStatus, StatusSource, ValidateTranscriptError};
```

(Two diffs: add `Path` to the `std::path` import; drop `BindContext, BindError` from the `types` import.)

- [ ] **Step 3: Rename `for_type` → `for_attach` and update `start`**

Find the `impl<R: tauri::Runtime> dyn AgentAdapter<R>` block. Replace:

```rust
impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new())),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }

    pub fn start(
        self: Arc<Self>,
        app: AppHandle<R>,
        session_id: String,
        cwd: PathBuf,
        pid: u32,
        pty_start: SystemTime,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        base::start_for(self, app, session_id, cwd, pid, pty_start, state)
    }

    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }
}
```

with:

```rust
impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_attach(
        agent_type: AgentType,
        pid: u32,
        pty_start: SystemTime,
    ) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new(pid, pty_start))),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }

    pub fn start(
        self: Arc<Self>,
        app: AppHandle<R>,
        session_id: String,
        cwd: PathBuf,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        base::start_for(self, app, session_id, cwd, state)
    }

    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }
}
```

- [ ] **Step 4: Rewrite `NoOpAdapter::status_source` impl**

Find the `NoOpAdapter` impl block. Replace its `status_source` method:

```rust
fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
    Ok(StatusSource {
        path: ctx
            .cwd
            .join(".vimeflow")
            .join("sessions")
            .join(ctx.session_id)
            .join("status.json"),
        trust_root: ctx.cwd.to_path_buf(),
    })
}
```

with:

```rust
fn status_source(
    &self,
    cwd: &Path,
    session_id: &str,
) -> Result<StatusSource, String> {
    Ok(StatusSource {
        path: cwd
            .join(".vimeflow")
            .join("sessions")
            .join(session_id)
            .join("status.json"),
        trust_root: cwd.to_path_buf(),
    })
}
```

(Other `NoOpAdapter` methods unchanged.)

- [ ] **Step 5: Rewire `start_agent_watcher` to use `for_attach` + drop pid/pty_start from adapter.start()**

Find the `start_agent_watcher` Tauri command. Replace:

```rust
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let (cwd, _shell_pid, pty_start, agent_type, agent_pid) =
        resolve_bind_inputs(&pty_state, &session_id, detect_agent)?;

    let adapter = <dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?;
    let owned_state = (*state).clone();
    let cwd_path = PathBuf::from(cwd);
    // `adapter.start(...)` walks into `base::start_for`, which calls
    // `resolve_status_source_with_retry`. The retry uses
    // `std::thread::sleep` (up to 5 × 100 ms = 500 ms) and
    // `path_security::ensure_status_source_under_trust_root` does
    // synchronous `canonicalize` filesystem I/O. Running that on a
    // tokio worker thread starves other futures scheduled on the same
    // worker; mirror the pattern at `src/git/watcher.rs:399` and hop
    // onto the blocking pool so the async thread returns immediately.
    tokio::task::spawn_blocking(move || {
        adapter.start(
            app_handle,
            session_id,
            cwd_path,
            agent_pid,
            pty_start,
            owned_state,
        )
    })
    .await
    .map_err(|e| format!("start_agent_watcher task panicked: {}", e))?
}
```

with:

```rust
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let (cwd, _shell_pid, pty_start, agent_type, agent_pid) =
        resolve_bind_inputs(&pty_state, &session_id, detect_agent)?;

    let adapter =
        <dyn AgentAdapter<tauri::Wry>>::for_attach(agent_type, agent_pid, pty_start)?;
    let owned_state = (*state).clone();
    let cwd_path = PathBuf::from(cwd);
    // `adapter.start(...)` walks into `base::start_for`, which calls
    // `adapter.status_source(...)`. For codex sessions, that call runs a
    // bounded retry (up to 5 attempts × 100 ms inter-attempt sleeps)
    // using `std::thread::sleep` because codex commits its `logs` row
    // ~300ms after the rollout file opens.
    // `path_security::ensure_status_source_under_trust_root` also does
    // synchronous `canonicalize` filesystem I/O. Running either on a
    // tokio worker thread starves other futures scheduled on the same
    // worker; mirror the pattern at `src/git/watcher.rs:399` and hop
    // onto the blocking pool so the async thread returns immediately.
    tokio::task::spawn_blocking(move || {
        adapter.start(app_handle, session_id, cwd_path, owned_state)
    })
    .await
    .map_err(|e| format!("start_agent_watcher task panicked: {}", e))?
}
```

(Diffs: factory call uses `for_attach`; comment updated to attribute retry to the codex adapter; `adapter.start(...)` drops `agent_pid` and `pty_start` args.)

- [ ] **Step 6: Update `noop_tests` in `mod.rs`**

Find `mod noop_tests { ... }`. Two test edits:

(a) Rename `for_type_returns_real_codex_adapter` → `for_attach_returns_real_codex_adapter` and update its body. Replace:

```rust
#[test]
fn for_type_returns_real_codex_adapter() {
    let adapter = <dyn AgentAdapter<MockRuntime>>::for_type(AgentType::Codex)
        .expect("codex adapter should construct");
    let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;

    let parsed = adapter
        .parse_status("pty-codex", raw)
        .expect("real codex adapter should parse rollout JSONL");
    assert_eq!(parsed.event.agent_session_id, "sess");
}
```

with:

```rust
#[test]
fn for_attach_returns_real_codex_adapter() {
    use std::time::SystemTime;

    let adapter = <dyn AgentAdapter<MockRuntime>>::for_attach(
        AgentType::Codex,
        12345,
        SystemTime::UNIX_EPOCH,
    )
    .expect("codex adapter should construct");
    let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;

    let parsed = adapter
        .parse_status("pty-codex", raw)
        .expect("real codex adapter should parse rollout JSONL");
    assert_eq!(parsed.event.agent_session_id, "sess");
}
```

(b) Update `status_source_uses_claude_shaped_path` to drop the BindContext literal. Replace:

```rust
#[test]
fn status_source_uses_claude_shaped_path() {
    use std::time::SystemTime;

    let adapter = NoOpAdapter::new(AgentType::Aider);
    let cwd = PathBuf::from("/tmp/ws");
    let ctx = BindContext {
        session_id: "sid",
        cwd: &cwd,
        pid: 0,
        pty_start: SystemTime::UNIX_EPOCH,
    };
    let src = <NoOpAdapter as AgentAdapter<MockRuntime>>::status_source(&adapter, &ctx)
        .expect("noop adapter always resolves a status source");
    assert_eq!(
        src.path,
        cwd.join(".vimeflow")
            .join("sessions")
            .join("sid")
            .join("status.json")
    );
    assert_eq!(src.trust_root, cwd);
}
```

with:

```rust
#[test]
fn status_source_uses_claude_shaped_path() {
    let adapter = NoOpAdapter::new(AgentType::Aider);
    let cwd = PathBuf::from("/tmp/ws");
    let src = <NoOpAdapter as AgentAdapter<MockRuntime>>::status_source(
        &adapter, &cwd, "sid",
    )
    .expect("noop adapter always resolves a status source");
    assert_eq!(
        src.path,
        cwd.join(".vimeflow")
            .join("sessions")
            .join("sid")
            .join("status.json")
    );
    assert_eq!(src.trust_root, cwd);
}
```

(Other tests in `noop_tests` are unchanged.)

- [ ] **Step 7: Update `ClaudeCodeAdapter::status_source` impl + test**

In `agent/adapter/claude_code/mod.rs`:

(a) Update the imports near the top of the file. Find:

```rust
use std::path::PathBuf;

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
```

Replace with:

```rust
use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
```

(b) Update the `status_source` impl method:

```rust
fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
    Ok(StatusSource {
        path: ctx
            .cwd
            .join(".vimeflow")
            .join("sessions")
            .join(ctx.session_id)
            .join("status.json"),
        trust_root: ctx.cwd.to_path_buf(),
    })
}
```

→

```rust
fn status_source(
    &self,
    cwd: &Path,
    session_id: &str,
) -> Result<StatusSource, String> {
    Ok(StatusSource {
        path: cwd
            .join(".vimeflow")
            .join("sessions")
            .join(session_id)
            .join("status.json"),
        trust_root: cwd.to_path_buf(),
    })
}
```

(c) Update the test `status_source_returns_claude_path_under_cwd`. Replace:

```rust
#[test]
fn status_source_returns_claude_path_under_cwd() {
    use std::time::SystemTime;

    let adapter = ClaudeCodeAdapter;
    let cwd = PathBuf::from("/tmp/ws");
    let ctx = BindContext {
        session_id: "sess-1",
        cwd: &cwd,
        pid: 0,
        pty_start: SystemTime::UNIX_EPOCH,
    };
    let src = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::status_source(&adapter, &ctx)
        .expect("claude status source is infallible");
    assert_eq!(
        src.path,
        cwd.join(".vimeflow")
            .join("sessions")
            .join("sess-1")
            .join("status.json")
    );
    assert_eq!(src.trust_root, cwd);
}
```

with:

```rust
#[test]
fn status_source_returns_claude_path_under_cwd() {
    let adapter = ClaudeCodeAdapter;
    let cwd = PathBuf::from("/tmp/ws");
    let src = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::status_source(
        &adapter, &cwd, "sess-1",
    )
    .expect("claude status source is infallible");
    assert_eq!(
        src.path,
        cwd.join(".vimeflow")
            .join("sessions")
            .join("sess-1")
            .join("status.json")
    );
    assert_eq!(src.trust_root, cwd);
}
```

- [ ] **Step 8: Refactor `CodexAdapter` struct in `codex/mod.rs`**

Find the existing struct + impl block:

```rust
pub struct CodexAdapter {
    locator_cache: OnceLock<CompositeLocator>,
    resolved_rollout_path: Mutex<Option<PathBuf>>,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
        }
    }

    fn locator(&self) -> &CompositeLocator {
        self.locator_cache.get_or_init(|| {
            let codex_home = Self::codex_home();
            log::info!(
                "codex adapter: locator cache initialized (codex_home={})",
                codex_home.display()
            );
            CompositeLocator::new(codex_home)
        })
    }

    fn codex_home() -> PathBuf {
        dirs::home_dir()
            .map(|home| home.join(".codex"))
            .unwrap_or_else(|| PathBuf::from(".codex"))
    }
}
```

Replace with:

```rust
pub struct CodexAdapter {
    pid: u32,
    pty_start: SystemTime,
    codex_home: PathBuf,
    locator_cache: OnceLock<CompositeLocator>,
    resolved_rollout_path: Mutex<Option<PathBuf>>,
}

impl CodexAdapter {
    pub fn new(pid: u32, pty_start: SystemTime) -> Self {
        Self {
            pid,
            pty_start,
            codex_home: default_codex_home(),
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
        }
    }

    /// Test-only constructor that accepts an explicit `codex_home`. Lets
    /// `status_source_tests` (Task 4) seed a temp `~/.codex` mock without
    /// touching the user's real home. Field initializers duplicate `new`;
    /// the duplication is intentional so the test seam is fully gated and
    /// production builds carry no test-shaped code.
    #[cfg(test)]
    pub(crate) fn with_home(
        pid: u32,
        pty_start: SystemTime,
        codex_home: PathBuf,
    ) -> Self {
        Self {
            pid,
            pty_start,
            codex_home,
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
        }
    }

    fn locator(&self) -> &CompositeLocator {
        self.locator_cache.get_or_init(|| {
            log::info!(
                "codex adapter: locator cache initialized (codex_home={})",
                self.codex_home.display()
            );
            CompositeLocator::new(self.codex_home.clone())
        })
    }
}

fn default_codex_home() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}
```

(Note: the static `Self::codex_home()` method is replaced by the free function `default_codex_home()` plus the per-instance `self.codex_home` field.)

- [ ] **Step 9: Update `codex/mod.rs` imports**

Find the top-of-file imports. Replace:

```rust
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;

use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError, RolloutLocation};
```

with:

```rust
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;

use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError, RolloutLocation};
use self::types::BindContext;
```

(Diffs: add `Path` to `std::path`; add `std::time::SystemTime`; drop `BindContext, BindError` from public types import; add `use self::types::BindContext;`.)

- [ ] **Step 10: Update `CodexAdapter::status_source` impl body**

Find the `impl<R: tauri::Runtime> AgentAdapter<R> for CodexAdapter` block. Replace:

```rust
fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
    match self.locator().resolve_rollout(ctx) {
        Ok(location) => {
            let rollout_path = location.rollout_path;
            if let Ok(mut slot) = self.resolved_rollout_path.lock() {
                *slot = Some(rollout_path.clone());
            }

            Ok(StatusSource {
                path: rollout_path,
                trust_root: Self::codex_home(),
            })
        }
        Err(LocatorError::NotYetReady) => Err(BindError::Pending(
            "codex session row not yet committed".to_string(),
        )),
        Err(LocatorError::Unresolved(reason)) | Err(LocatorError::Fatal(reason)) => {
            Err(BindError::Fatal(reason))
        }
    }
}
```

with:

```rust
fn status_source(
    &self,
    cwd: &Path,
    _session_id: &str,
) -> Result<StatusSource, String> {
    // `session_id` is part of the trait contract (Claude / NoOp use it)
    // but the codex locator never reads it — bind to `_session_id` to
    // satisfy `-D warnings`.
    let ctx = BindContext {
        cwd,
        pid: self.pid,
        pty_start: self.pty_start,
    };

    let location = retry_locator(|| self.locator().resolve_rollout(&ctx))?;

    if let Ok(mut slot) = self.resolved_rollout_path.lock() {
        *slot = Some(location.rollout_path.clone());
    }

    Ok(StatusSource {
        path: location.rollout_path,
        trust_root: self.codex_home.clone(),
    })
}
```

- [ ] **Step 11: Update existing `adapter_tests` to pass sentinel construction args**

In `codex/mod.rs::adapter_tests`, find the three tests that call `CodexAdapter::new()`. Each call must change to `CodexAdapter::new(12345, SystemTime::UNIX_EPOCH)`. Add `use std::time::SystemTime;` (and `use std::path::PathBuf;` if not already imported) at the top of the test module.

Concretely:

```rust
let adapter = CodexAdapter::new();
```

→

```rust
let adapter = CodexAdapter::new(12345, SystemTime::UNIX_EPOCH);
```

Three call sites: `parse_status_delegates_to_parser_with_transcript_path_none`, `parse_status_includes_resolved_rollout_path_when_available`, and `validate_transcript_rejects_outside_codex_root`. Assertion bodies are unchanged — these tests don't exercise `status_source`.

- [ ] **Step 12: Switch `codex/locator.rs` import to private types**

Find line 3 of `codex/locator.rs`:

```rust
use crate::agent::adapter::types::BindContext;
```

Replace with:

```rust
use super::types::BindContext;
```

No other body changes in locator.rs. The `&BindContext<'_>` parameter types in all locator methods now refer to the private codex struct (which has the same `cwd, pid, pty_start` shape as the deleted public one, minus `session_id` which the locator never read).

- [ ] **Step 13: Locator-side test fixture `ctx<'a>` helper updates**

In `codex/locator.rs::tests` there are two `fn ctx<'a>(...)` helpers (around lines 759 and 997 of the pre-refactor file). Both build a `BindContext` literal with all four fields including `session_id`. Update both to drop `session_id`:

```rust
fn ctx<'a>(cwd: &'a Path, pid: u32, pty_start: SystemTime) -> BindContext<'a> {
    BindContext {
        session_id: "sid",
        cwd,
        pid,
        pty_start,
    }
}
```

→

```rust
fn ctx<'a>(cwd: &'a Path, pid: u32, pty_start: SystemTime) -> BindContext<'a> {
    BindContext {
        cwd,
        pid,
        pty_start,
    }
}
```

(Same edit for the second helper around line 997.) Also adjust the test-module imports if `BindContext` was imported via the old public path — change to `use super::super::types::BindContext;` or `use crate::agent::adapter::codex::types::BindContext;`. The existing `super::*;` import may already cover it depending on the file's structure; adjust as needed for compile.

- [ ] **Step 14: Simplify `base::start_for` body**

In `agent/adapter/base/mod.rs`, find `start_for`:

```rust
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: std::time::SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source =
        resolve_status_source_with_retry(adapter.as_ref(), &session_id, &cwd, pid, pty_start)?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        source.path.display()
    );

    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        source.path.display(),
        state.active_count(),
    );

    let handle =
        watcher_runtime::start_watching(adapter, app_handle, session_id.clone(), source.path)?;
    state.insert(session_id, handle);

    Ok(())
}
```

Replace with:

```rust
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source = adapter.status_source(&cwd, &session_id)?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;

    log::debug!(
        "Watcher startup detail: session={}, cwd={}, path={}",
        session_id,
        cwd.display(),
        source.path.display()
    );

    state.remove(&session_id);

    log::info!(
        "Starting agent watcher: session={}, path={}, active_watchers={}",
        session_id,
        source.path.display(),
        state.active_count(),
    );

    let handle =
        watcher_runtime::start_watching(adapter, app_handle, session_id.clone(), source.path)?;
    state.insert(session_id, handle);

    Ok(())
}
```

(Diffs: drop `pid` and `pty_start` parameters; replace `resolve_status_source_with_retry(...)` with a single `adapter.status_source(&cwd, &session_id)?` call.)

- [ ] **Step 15: Delete `resolve_status_source_with_retry`, `BIND_RETRY_*` constants, and `start_for_retry_tests` from `base/mod.rs`**

Delete the constants at the top of `base/mod.rs`:

```rust
const BIND_RETRY_INTERVAL_MS: u64 = 100;
const BIND_RETRY_MAX_ATTEMPTS: u32 = 5;
```

Delete the entire `fn resolve_status_source_with_retry` function (~37 lines).

Delete the entire `#[cfg(test)] mod start_for_retry_tests { ... }` block (~138 lines, including the `PendingThenOkAdapter` mock and both retry tests).

- [ ] **Step 16: Update `base/mod.rs` imports**

Find:

```rust
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::agent::adapter::types::{BindContext, BindError, StatusSource};
use crate::agent::adapter::AgentAdapter;
```

Replace with:

```rust
use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::adapter::AgentAdapter;
```

(Drop `std::time::{Duration, Instant}` — both were only used by the retry helper. Drop the `types` import line entirely — `BindContext`/`BindError` are gone, and `StatusSource` is no longer named in `start_for`'s body.)

- [ ] **Step 17: Update the `OrderingAdapter` mock in `base/transcript_state.rs`**

Find the `impl<R: tauri::Runtime> AgentAdapter<R> for OrderingAdapter` block (around line 451). Replace its `status_source` method:

```rust
fn status_source(
    &self,
    _ctx: &crate::agent::adapter::types::BindContext<'_>,
) -> Result<
    crate::agent::adapter::types::StatusSource,
    crate::agent::adapter::types::BindError,
> {
    unreachable!("status_source not exercised in this test")
}
```

with:

```rust
fn status_source(
    &self,
    _cwd: &std::path::Path,
    _session_id: &str,
) -> Result<crate::agent::adapter::types::StatusSource, String> {
    unreachable!("status_source not exercised in this test")
}
```

(All other types in this mock impl already use FQN, so no further import edits needed.)

- [ ] **Step 18: Verify the workspace builds and all tests pass**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: build succeeds. If there are unused-import warnings, audit and clean before committing.

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::adapter`
Expected: all tests pass. The `start_for_retry_tests` module is gone (deleted in Step 15); `retry_locator_tests` (added in Task 2) covers equivalent semantics.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings. If clippy flags `_session_id` as unused, the underscore prefix should already silence it; if not, add `#[allow(unused_variables)]` only on the codex impl method as a last resort.

- [ ] **Step 19: Commit**

```bash
git add src-tauri/src/agent/adapter/mod.rs \
        src-tauri/src/agent/adapter/claude_code/mod.rs \
        src-tauri/src/agent/adapter/codex/mod.rs \
        src-tauri/src/agent/adapter/codex/locator.rs \
        src-tauri/src/agent/adapter/base/mod.rs \
        src-tauri/src/agent/adapter/base/transcript_state.rs
git commit -m "refactor(agent/adapter): collapse BindContext+retry into CodexAdapter

Trait method status_source returns to (cwd, sid) -> Result<_, String>.
Factory renames for_type → for_attach(agent_type, pid, pty_start).
Codex's pid/pty_start/codex_home move onto CodexAdapter struct;
codex's cold-start retry moves into status_source via the
retry_locator helper added in the previous commit.

base::start_for is now a single-call orchestrator: zero retry/sleep
code, no BindContext construction. start_for_retry_tests is deleted;
retry_locator_tests covers equivalent semantics in isolation.

ClaudeCodeAdapter and NoOpAdapter rewritten for the new sig (drop the
ctx wrapper, use direct cwd/session_id params). Mock OrderingAdapter
in base::transcript_state likewise. Codex's private BindContext
(without session_id, which the locator never read) is wired via
super::types.

No user-visible behavior change. Sleep budget on full exhaustion
shrinks marginally from 5×100ms (current) to 4×100ms (final-attempt
sleep skipped); cold-start window is otherwise identical.

Issue #156. See spec sections 2.1–2.7, 3.2, 3.4, 3.5, 4.1, 4.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add `status_source_tests` for `CodexAdapter`

Spec section 4.3.

**Files:**

- Modify: `src-tauri/src/agent/adapter/codex/mod.rs` (add new `#[cfg(test)] mod status_source_tests`)

The new test module exercises the post-Task-3 `(cwd, sid)` trait method body using `CodexAdapter::with_home` (the `#[cfg(test)]` constructor from Task 3) so the test isolates from the user's real `~/.codex`. The SQLite seeding helper is duplicated inline (~30 LOC) — see spec section 4.3 for the rationale (vs. extracting a shared fixtures module).

- [ ] **Step 1: Write the failing happy-path test**

Append this test module to `codex/mod.rs` after the existing `retry_locator_tests` module:

```rust
#[cfg(test)]
mod status_source_tests {
    use super::*;
    use rusqlite::{params, Connection};
    use std::path::Path;
    use std::time::{Duration, SystemTime};
    use tauri::test::MockRuntime;

    /// Seeds a tempdir with the SQLite logs/threads schema + a thread row
    /// for the given (pid, pty_start) pointing at a writable rollout
    /// path. Returns the rollout path so the test can assert it.
    ///
    /// Inline duplicate of the helper used in `locator::tests`. If a
    /// third call site ever needs this, promote to a shared
    /// `codex/test_fixtures.rs` module then.
    fn seed_codex_home_with_thread(
        codex_home: &Path,
        pid: u32,
        pty_start: SystemTime,
    ) -> std::path::PathBuf {
        // Compute rollout path: ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<pid>.jsonl
        let rollout_path = codex_home
            .join("sessions")
            .join("2026")
            .join("05")
            .join("05")
            .join(format!("rollout-{}.jsonl", pid));
        std::fs::create_dir_all(rollout_path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&rollout_path, b"").expect("seed empty rollout");

        // Compute pty_start as Unix seconds + nanoseconds for the logs row.
        let since_epoch = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("pty_start ≥ epoch");
        let secs = since_epoch.as_secs() as i64;
        let nanos = since_epoch.subsec_nanos() as i64;

        // logs DB at codex_home/logs.sqlite
        let logs_db = codex_home.join("logs.sqlite");
        let logs = Connection::open(&logs_db).expect("open logs db");
        logs.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                process_uuid TEXT NOT NULL,
                thread_id TEXT
            );
            CREATE INDEX idx_logs_ts ON logs(ts DESC, ts_nanos DESC, id DESC);",
        )
        .expect("logs schema");
        logs.execute(
            "INSERT INTO logs (ts, ts_nanos, process_uuid, thread_id) \
             VALUES (?1, ?2, ?3, ?4)",
            params![
                secs + 1,
                nanos,
                format!("pid:{}:abc", pid),
                "tid-test",
            ],
        )
        .expect("insert log row");

        // state DB at codex_home/state.sqlite
        let state_db = codex_home.join("state.sqlite");
        let state = Connection::open(&state_db).expect("open state db");
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    cwd TEXT,
                    updated_at_ms INTEGER NOT NULL
                );",
            )
            .expect("threads schema");
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, cwd, updated_at_ms) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    "tid-test",
                    rollout_path.to_str().expect("utf-8 path"),
                    codex_home.to_str().expect("utf-8 home"),
                    secs * 1000 + nanos / 1_000_000,
                ],
            )
            .expect("insert thread row");

        rollout_path
    }

    #[test]
    fn status_source_returns_resolved_rollout_on_happy_path() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let pty_start = SystemTime::now() - Duration::from_secs(5);
        let rollout_path = seed_codex_home_with_thread(
            codex_home.path(),
            999,
            pty_start,
        );

        let adapter = CodexAdapter::with_home(
            999,
            pty_start,
            codex_home.path().to_path_buf(),
        );
        let cwd = codex_home.path().to_path_buf();

        let src = <CodexAdapter as AgentAdapter<MockRuntime>>::status_source(
            &adapter, &cwd, "sid",
        )
        .expect("status_source should resolve");

        assert_eq!(src.path, rollout_path);
        assert_eq!(src.trust_root, codex_home.path());
    }

    #[test]
    fn status_source_returns_err_on_retry_exhausted() {
        // Empty codex_home → both DB discovery returns Ok(None) → FS
        // fallback also empty → repeated NotYetReady → retry exhausted.
        let codex_home = tempfile::tempdir().expect("tempdir");
        let adapter = CodexAdapter::with_home(
            999,
            SystemTime::now(),
            codex_home.path().to_path_buf(),
        );
        let cwd = codex_home.path().to_path_buf();

        let err = <CodexAdapter as AgentAdapter<MockRuntime>>::status_source(
            &adapter, &cwd, "sid",
        )
        .expect_err("empty codex_home should exhaust retry");
        assert!(err.contains("retry exhausted"), "got: {}", err);
    }
}
```

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml status_source_tests`
Expected: 2 passed. Both tests construct via `with_home` so they bypass `dirs::home_dir()`.

If `status_source_returns_resolved_rollout_on_happy_path` fails because the locator's SQLite query doesn't match the seeded rows, audit the seed helper against `codex/locator.rs`'s actual query:

- The `logs` query gates by `process_uuid LIKE 'pid:' || :pid || ':%'` AND `(ts > pty_start_secs OR (ts = pty_start_secs AND ts_nanos >= pty_start_nanos))`.
- The seed inserts `process_uuid = "pid:999:abc"` and `ts = secs + 1`, so the gate is satisfied.

If the test still fails, log `LocatorError` variants from inside `retry_locator` (temporary) to identify which step (logs vs threads vs FS fallback) is unhappy.

- [ ] **Step 3: Run the full crate's tests to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::adapter`
Expected: all tests pass. New test count should increase by 2.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/adapter/codex/mod.rs
git commit -m "test(agent/adapter): add codex status_source_tests

Two tests exercise the new (cwd, sid) trait-method shape on
CodexAdapter: a happy path that seeds an in-memory ~/.codex via
with_home and asserts the resolved rollout path, and an exhaustion
path that uses an empty codex_home and asserts the retry-exhausted
error string.

The SQLite seed helper is inlined (~30 LOC) per the spec's section
4.3 rationale: only two call sites today (locator tests have their
own private helper). Promote to a shared module if a third call
site emerges.

Issue #156. See spec section 4.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Delete public `BindContext` and `BindError` from `agent/adapter/types.rs`

Spec section 2.6.

This task removes the now-orphaned public types. After Task 3, no production code references them; this finishes the cleanup so `cargo clippy` doesn't warn about unused public types.

**Files:**

- Modify: `src-tauri/src/agent/adapter/types.rs`

- [ ] **Step 1: Delete the `BindContext` struct + its `Display` and `Error` impls**

In `src-tauri/src/agent/adapter/types.rs`, delete these blocks:

```rust
#[derive(Debug, Clone, Copy)]
pub struct BindContext<'a> {
    pub session_id: &'a str,
    pub cwd: &'a Path,
    pub pid: u32,
    pub pty_start: SystemTime,
}

#[derive(Debug, Clone)]
pub enum BindError {
    Pending(String),
    Fatal(String),
}

impl std::fmt::Display for BindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending(reason) => write!(f, "bind pending: {}", reason),
            Self::Fatal(reason) => write!(f, "bind fatal: {}", reason),
        }
    }
}

impl std::error::Error for BindError {}
```

- [ ] **Step 2: Delete the `BindError` Display tests**

In the `#[cfg(test)] mod display_tests` at the bottom of `types.rs`, delete:

```rust
#[test]
fn bind_error_display_pending_format() {
    let e = BindError::Pending("logs row not yet committed".to_string());
    assert_eq!(e.to_string(), "bind pending: logs row not yet committed");
}

#[test]
fn bind_error_display_fatal_format() {
    let e = BindError::Fatal("permission denied on ~/.codex".to_string());
    assert_eq!(e.to_string(), "bind fatal: permission denied on ~/.codex");
}
```

(Other tests in `display_tests` — `display_invalid_path_has_stable_security_prefix`, `display_other_remains_bare_message`, `display_invalid_path_and_other_are_structurally_distinguishable`, `display_not_found_and_outside_root_unchanged` — are about `ValidateTranscriptError` and stay.)

- [ ] **Step 3: Update `types.rs` imports**

The `use std::time::SystemTime;` at the top of the file may be unused after deletion. Check:

```bash
grep -n "SystemTime" src-tauri/src/agent/adapter/types.rs
```

If no remaining matches, delete that `use` line. Same for any `use std::path::Path;` that was only there for `BindContext`.

- [ ] **Step 4: Verify the workspace builds and tests pass**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: success.

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent::adapter`
Expected: all tests pass. Test count drops by 2 (the deleted `bind_error_display_*` tests).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings.

Run the issue's acceptance verification:

```bash
grep -rn 'BindContext\|BindError' src-tauri/src/ --include='*.rs'
```

Expected: matches only inside `src-tauri/src/agent/adapter/codex/types.rs` (private struct definition), `codex/locator.rs` (the import + parameter types), and `codex/mod.rs` (the import + construction in `status_source`). No matches in `agent/adapter/types.rs`, `agent/adapter/mod.rs`, `claude_code/mod.rs`, `base/mod.rs`, `base/transcript_state.rs`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent/adapter/types.rs
git commit -m "refactor(agent/adapter): delete public BindContext + BindError

Both types are now codex-private (BindContext lives in
agent/adapter/codex/types.rs as pub(super); BindError no longer
exists at all because the trait method's error type is plain
String). Verified via grep: no production code outside codex/
references these names.

Drops the BindError Display pinned-format tests; the
ValidateTranscriptError tests in the same module are unaffected.

Issue #156. See spec section 2.6. Acceptance criterion 'BindContext
and BindError no longer appear in agent/adapter/types.rs' satisfied.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Documentation updates

Spec section 5 + 6.2.

**Files:**

- Create: `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`
- Modify: `docs/decisions/CLAUDE.md` (index table)
- Modify: `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` (top header + 2 inline supersede notes)
- Modify: `src-tauri/src/agent/README.md` (lines 67, 98, 116)

- [ ] **Step 1: Write the new ADR**

Create `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` with this content:

```markdown
# Codex adapter trait simplification — collapse BindContext + retry into CodexAdapter

**Date:** 2026-05-05
**Status:** Accepted
**Scope:** Round-3 review on PR #154 flagged that `BindContext` and the bounded retry inside `base::start_for` leak codex-only requirements through the `AgentAdapter` trait surface. This ADR records the decision to move both pieces into `CodexAdapter` itself, supersedes parts of the Stage 2 spec, and inherits (does not re-litigate) the three deviations recorded in the 2026-05-04 scope-expansion ADR.

**Predecessors (still load-bearing):**

- [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](../superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md) — Stage 2 spec.
- [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](./2026-05-04-codex-adapter-stage-2-scope-expansion.md) — Stage 2 deviations (transcript tailer, /proc fast-paths, agent-PID bind).

**Spec mandating this ADR:** [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md).

## Context

Stage 2 (PR #154) introduced `BindContext { session_id, cwd, pid, pty_start }` as the parameter to `AgentAdapter::status_source`, plus a bounded retry inside `base::start_for` that loops on `BindError::Pending` for up to 5 × 100ms = 500ms. Both pieces existed solely to support codex's SQLite-logs cold-start race (the `logs` row arrives ~300ms after the rollout file opens). Claude's adapter ignores `pid`/`pty_start` and never returns `Pending`. Round-3 review on PR #154 ([discussion_r3181677311](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181677311), [discussion_r3181691871](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181691871)) called the leak out as a finding, not a stylistic preference.

## Options considered

1. **Leave as-is** — accept the trait-surface leak.
2. **Move `pid`/`pty_start` to the codex adapter, keep the bounded retry in `base::start_for`** — half-fix.
3. **Move both pieces into `CodexAdapter` itself** — this ADR's choice.

## Decision

Choose option 3.

The trait method becomes `status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>`. `BindContext` and `BindError` are deleted from `agent/adapter/types.rs`. `CodexAdapter` gains `pid`, `pty_start`, and `codex_home` fields plus a `retry_locator` helper that runs the cold-start race privately. `base::start_for` becomes a single-call orchestrator with zero retry/sleep code. The factory renames from `for_type(agent_type)` to `for_attach(agent_type, pid, pty_start)`.

## Justification

1. **Single-responsibility.** The trait describes "what an agent adapter does"; codex's cold-start race is "how the codex adapter does it", not part of the contract.
2. **Future adapters.** Aider, Generic, and other adapters shouldn't need to learn about `BindContext` to implement `status_source`.
3. **Calibration locality.** The retry budget (5 × 100ms) is calibrated against codex-specific commit timings; it doesn't generalize. Hosting it inside the codex adapter keeps the calibration close to the rationale.
4. **Pure internal refactor.** No IPC, no user-visible behavior change, no scope expansion. Sleep-budget shrinks marginally (5 × 100ms → 4 × 100ms — final-attempt sleep skipped), still well under the 500ms safety margin.

## Alternatives rejected

### Option 1 — Leave as-is

Rejected because round-3 review explicitly flagged the leak as a finding, not a stylistic preference. The cost of the leak grows with each new adapter.

### Option 2 — Half-fix

Rejected because the retry budget still has nowhere coherent to live. `base::start_for` would still be branching on a `Pending`/`Fatal` distinction that only one adapter ever produces. The trait surface would be cleaner but the orchestration layer would carry a codex-shaped contract.

## Known risks & mitigations

- **Risk:** A second adapter eventually needs the same retry shape and re-introduces a parallel-but-divergent retry helper.
  **Mitigation:** the `retry_locator` helper is internal to codex and trivially small; if a second adapter needs the same shape, promote a generic `retry_with_budget` to a shared `agent/adapter/util.rs` at that point. Don't preempt.

- **Risk:** Sleep-budget tightening from 5 × 100ms to 4 × 100ms is a real behavior change.
  **Mitigation:** the cold-start window is typically ~300ms (per the 2026-05-04 ADR's `/proc` fast-path rationale), well below 400ms. The exhaustion path rarely fires in practice, and the 500ms safety margin against the 2000ms detection re-poll is preserved.

## References

- Issue [#156](https://github.com/winoooops/vimeflow/issues/156).
- PR [#154](https://github.com/winoooops/vimeflow/pull/154) — Stage 2 implementation.
- Round-3 review threads: [r1](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181677311), [r2](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181691871).
- 2026-05-03 spec: [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](../superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md).
- 2026-05-04 ADR: [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](./2026-05-04-codex-adapter-stage-2-scope-expansion.md).
- 2026-05-05 spec: [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md).
```

- [ ] **Step 2: Append the new ADR to the index in `docs/decisions/CLAUDE.md`**

Find the records table (around line 13). Insert a new row at the top:

```markdown
| 2026-05-05 | [Codex adapter trait simplification](./2026-05-05-codex-adapter-trait-simplification.md) | Accepted |
```

The full table after the edit:

```markdown
| Date       | Decision                                                                                       | Status   |
| ---------- | ---------------------------------------------------------------------------------------------- | -------- |
| 2026-05-05 | [Codex adapter trait simplification](./2026-05-05-codex-adapter-trait-simplification.md)       | Accepted |
| 2026-05-04 | [Codex adapter Stage 2 scope expansion](./2026-05-04-codex-adapter-stage-2-scope-expansion.md) | Accepted |
| 2026-05-03 | [Claude parser JSON boundary](./2026-05-03-claude-parser-json-boundary.md)                     | Accepted |
| 2026-04-22 | [Tooltip library: `@floating-ui/react`](./2026-04-22-tooltip-library.md)                       | Accepted |
```

- [ ] **Step 3: Add the `Amended further by:` line to the Stage 2 spec header**

In `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`, find line 7:

```markdown
**Amended by:** `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` — the implementation expanded past three of this spec's locked rules (Codex transcript tailer, `/proc`-as-chooser, `BindContext.pid` semantics). Where this spec and that ADR conflict, the ADR wins for those three items only; the rest of this spec stands.
```

Insert a new line directly after it:

```markdown
**Amended further by:** `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` — the trait signature change at "Architecture > Trait signature change" and the `start_for` retry rules at "Architecture > `start_for` retry loop" are superseded. The codex-adapter-internal retry, the `(cwd, sid)` trait method, and the `for_attach(agent_type, pid, pty_start)` factory replace those rules. Everything else in this spec stands.
```

- [ ] **Step 4a: Append post-2026-05-05 notes to Stage 2 spec File touch list rows**

In `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`, find the "File touch list (step 1 only)" section (around line 549). Several rows describe Stage 2 deltas to files this refactor also touches. Append a one-line italicised note under the affected rows pointing readers at the post-2026-05-05 spec.

For the `mod.rs` row, after:

```markdown
- `src-tauri/src/agent/adapter/mod.rs` — trait sig update; `start_for` retry on Pending; `start_agent_watcher` builds `BindContext` from `PtyState`.
```

Insert (no replacement; append a continuation line indented 2 spaces):

```markdown
- _Post-2026-05-05 mechanics differ; see [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](./2026-05-05-codex-adapter-trait-simplification-design.md)._
```

Same shape under the `base/mod.rs` row, after:

```markdown
- `src-tauri/src/agent/adapter/base/mod.rs` — `start_for` retry loop, error propagation.
```

Append:

```markdown
- _Post-2026-05-05 mechanics differ; the retry moves into `CodexAdapter`. See the [trait simplification spec](./2026-05-05-codex-adapter-trait-simplification-design.md)._
```

And under the `types.rs` row, after:

```markdown
- `src-tauri/src/agent/adapter/types.rs` — add `BindContext`, `BindError`.
```

Append:

```markdown
- _Post-2026-05-05: both types are deleted. `BindContext` lives privately in `agent/adapter/codex/types.rs`; `BindError` is gone (trait method returns `Result<_, String>`). See the [trait simplification spec](./2026-05-05-codex-adapter-trait-simplification-design.md).\_
```

The Stage 2 row text itself stays — it's a historical record of what Stage 2 added; the appended note tells readers where the current contract lives. This is the "File touch list rows" amendment mandated by spec section 5.2.

- [ ] **Step 4: Add inline supersede markers to Stage 2 spec sections**

In `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`, find the "Trait signature change" subsection (around line 213). It starts with the subheading `### Trait signature change`. Insert this italicised note immediately after the heading, before the existing prose:

```markdown
> _Superseded by [`docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`](../../decisions/2026-05-05-codex-adapter-trait-simplification.md) — the trait method is now `(cwd: &Path, session_id: &str) -> Result<StatusSource, String>`. The discussion below describes the Stage 2 surface as shipped; the current surface is in the [2026-05-05 spec](./2026-05-05-codex-adapter-trait-simplification-design.md)._
```

Find the `start_for` retry loop subsection (around line 225, heading `### \`start_for\` retry loop`). Insert directly after the heading:

```markdown
> _Superseded by [`docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`](../../decisions/2026-05-05-codex-adapter-trait-simplification.md) — the retry now lives inside `CodexAdapter::status_source` (helper: `retry_locator`). `base::start_for` has zero retry code post-2026-05-05._
```

- [ ] **Step 5: Update `src-tauri/src/agent/README.md` (sweep all stale references)**

The README has stale references to the pre-refactor contract beyond the three lines flagged in spec section 5.3. The plan expands the sweep to keep the README consistent with the post-2026-05-05 contract — line numbers approximate; locate by anchor text.

**(a) Line ~67 — file-tree comment for `types.rs`.** Find:

```
    ├── types.rs             ← StatusSource, ParsedStatus, BindContext, BindError, ValidateTranscriptError
```

Replace with:

```
    ├── types.rs             ← StatusSource, ParsedStatus, ValidateTranscriptError
```

**(b) Lines ~86-99 — `<dyn AgentAdapter<R>>::for_type` heading + code block + bullets + follow-up blockquote.** Find the entire section starting at the heading and ending at the blockquote:

````markdown
### `<dyn AgentAdapter<R>>::for_type`

```rust
pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String>
```

Constructs the right adapter for a detected agent type. Returns `Arc<dyn AgentAdapter<R>>`:

- `AgentType::ClaudeCode` → `ClaudeCodeAdapter`
- `AgentType::Codex` → `CodexAdapter::new()`
- everything else → `NoOpAdapter::new(t)` (returns errors from `parse_status` / `validate_transcript` / `tail_transcript`; `status_source` returns a `.vimeflow/sessions/{sid}/status.json` placeholder)

> **Follow-up tracking:** issue [#156](https://github.com/winoooops/vimeflow/issues/156) collapses `BindContext` and the central retry into `CodexAdapter::new(pid, pty_start)`. After that lands, `for_type` becomes `for_attach(ctx)` and the Claude impl drops the unused `ctx` parameter from `status_source`.
````

Replace with:

````markdown
### `<dyn AgentAdapter<R>>::for_attach`

```rust
pub fn for_attach(
    agent_type: AgentType,
    pid: u32,
    pty_start: SystemTime,
) -> Result<Arc<Self>, String>
```

Constructs the right adapter for a detected agent type. Returns `Arc<dyn AgentAdapter<R>>`:

- `AgentType::ClaudeCode` → `ClaudeCodeAdapter` (`pid`/`pty_start` discarded)
- `AgentType::Codex` → `CodexAdapter::new(pid, pty_start)`
- everything else → `NoOpAdapter::new(t)` (returns errors from `parse_status` / `validate_transcript` / `tail_transcript`; `status_source` returns a `.vimeflow/sessions/{sid}/status.json` placeholder; `pid`/`pty_start` discarded)

> **Resolved 2026-05-05** by [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../../docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md) (issue [#156](https://github.com/winoooops/vimeflow/issues/156)): `BindContext` is now private to `codex/`, `BindError` is deleted, the trait method is `status_source(cwd, sid) -> Result<_, String>`, and codex's cold-start retry lives inside `CodexAdapter::status_source` via the `retry_locator` helper.
````

**(c) Lines ~102-112 — `<dyn AgentAdapter<R>>::start` code block.** Find:

```rust
pub fn start(
    self: Arc<Self>,
    app: AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: SystemTime,
    state: AgentWatcherState,
) -> Result<(), String>
```

Replace with:

```rust
pub fn start(
    self: Arc<Self>,
    app: AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String>
```

(Drops `pid` and `pty_start` parameters — these now live on `CodexAdapter` from `for_attach`.)

**(d) Line ~116 — bind-flow description.** Find:

```markdown
`pid` is the detected agent PID (returned by `detector::detect_agent`), not the shell PID at the PTY root — Codex's `logs.process_uuid` indexes by the codex child PID. `pty_start` is captured at PTY spawn (`ManagedSession.started_at`) so the logs query can filter out PID-reuse and stale-loaded-thread matches. Both arguments are passed through to the adapter as fields of `BindContext` (delegated through `base::start_for` → `resolve_status_source_with_retry` → `adapter.status_source(&ctx)`). Claude's impl ignores them; Codex's locator depends on them.
```

Replace with:

```markdown
`pid` is the detected agent PID (returned by `detector::detect_agent`), not the shell PID at the PTY root — Codex's `logs.process_uuid` indexes by the codex child PID. `pty_start` is captured at PTY spawn (`ManagedSession.started_at`) so the logs query can filter out PID-reuse and stale-loaded-thread matches. Both arguments are stored on `CodexAdapter` at construction (`CodexAdapter::new(pid, pty_start)` via the `for_attach(agent_type, pid, pty_start)` factory). The codex adapter wraps them in a private `BindContext` for its locator on each `status_source` call. `base::start_for` invokes `adapter.status_source(cwd, session_id)` once and codex's internal retry lives in `retry_locator` (5 attempts, 4 × 100ms inter-attempt sleeps, 400ms sleep budget on full exhaustion). Claude's impl ignores these fields — Claude's `status_source(cwd, sid)` is infallible.
```

**(e) Line ~147 — trait declaration in "The trait (provider hooks)" section.** Find:

```rust
    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource;
```

Replace with:

```rust
    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;
```

**(f) Line ~165 — `status_source` row in the trait-hook table.** Find:

```markdown
| `status_source` | `StatusSource { path, trust_root }` | Where the agent writes its status snapshot, plus the trust root the path must canonicalize under. |
```

Replace with:

```markdown
| `status_source` | `Result<StatusSource, String>` | Where the agent writes its status snapshot, plus the trust root the path must canonicalize under. Failures (codex bind retry exhausted; codex locator fatal) surface as `Err(String)`. |
```

**(g) Lines ~183-188 — `ClaudeCodeAdapter::status_source` example body.** Find inside the `impl ... for ClaudeCodeAdapter` code block:

```rust
    fn status_source(&self, cwd, sid) -> StatusSource {
        StatusSource {
            path: cwd.join(".vimeflow/sessions").join(sid).join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }
```

Replace with:

```rust
    fn status_source(&self, cwd, sid) -> Result<StatusSource, String> {
        Ok(StatusSource {
            path: cwd.join(".vimeflow/sessions").join(sid).join("status.json"),
            trust_root: cwd.to_path_buf(),
        })
    }
```

**(h) Lines ~218-225 — `NoOpAdapter::status_source` example body.** Find inside the `impl ... for NoOpAdapter` code block:

```rust
    fn status_source(&self, cwd, sid) -> StatusSource {
        // Same path Claude uses → watcher's create_dir_all + watch
        // matches today's silent-no-op UX for unsupported agents.
        StatusSource {
            path: cwd.join(".vimeflow/sessions").join(sid).join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }
```

Replace with:

```rust
    fn status_source(&self, cwd, sid) -> Result<StatusSource, String> {
        // Same path Claude uses → watcher's create_dir_all + watch
        // matches today's silent-no-op UX for unsupported agents.
        Ok(StatusSource {
            path: cwd.join(".vimeflow/sessions").join(sid).join("status.json"),
            trust_root: cwd.to_path_buf(),
        })
    }
```

**(i) Line ~232 — "Why this exists" prose for NoOpAdapter.** Two `for_type` mentions to update. Find:

```markdown
**Why this exists:** if `for_type` returned `Err` for unsupported variants, the frontend's exit-collapse path (`useAgentStatus.ts:139-154`, gated on `watcherStartedRef.current`) would never run after a Codex / Aider session exits — the panel would stay in `isActive: true` indefinitely. `NoOpAdapter` returns Claude's status path so the watcher starts successfully (no events ever fire because nothing writes to that path under non-Claude agents), `watcherStartedRef.current` flips to `true`, and exit-collapse runs naturally. See spec IDEA "NoOpAdapter for non-Claude agents in for_type" for the full rationale.
```

Replace with:

```markdown
**Why this exists:** if `for_attach` returned `Err` for unsupported variants, the frontend's exit-collapse path (`useAgentStatus.ts:139-154`, gated on `watcherStartedRef.current`) would never run after a Codex / Aider session exits — the panel would stay in `isActive: true` indefinitely. `NoOpAdapter` returns Claude's status path so the watcher starts successfully (no events ever fire because nothing writes to that path under non-Claude agents), `watcherStartedRef.current` flips to `true`, and exit-collapse runs naturally. See spec IDEA "NoOpAdapter for non-Claude agents in for_attach" for the full rationale.
```

**(j) Line ~400 — detector dispatch reference.** Find:

```markdown
`detector.rs` is shared across every adapter — it inspects the PTY process tree and matches the bare binary name (`claude`, `codex`, `aider`) against `AgentType` variants. No adapter-specific logic; the result feeds `<dyn AgentAdapter<R>>::for_type`.
```

Replace with:

```markdown
`detector.rs` is shared across every adapter — it inspects the PTY process tree and matches the bare binary name (`claude`, `codex`, `aider`) against `AgentType` variants. No adapter-specific logic; the result feeds `<dyn AgentAdapter<R>>::for_attach`.
```

(Line ~11 — the scope-expansion ADR pointer — stays unchanged. It's a historical reference that remains accurate. Line ~60's file-tree comment for `mod.rs` also stays; the description still applies post-refactor.)

After the sweep, run sanity greps:

```bash
grep -n 'for_type\b' src-tauri/src/agent/README.md
```

Expected: no matches.

```bash
grep -n 'BindError' src-tauri/src/agent/README.md
```

Expected: no matches.

```bash
grep -n 'status_source.*-> StatusSource\b' src-tauri/src/agent/README.md
```

Expected: no matches (all four `status_source` mentions now show `Result<StatusSource, String>`).

- [ ] **Step 6: Verify links resolve and prose reads correctly**

Spot-check the new ADR loads in a markdown viewer (or `glow docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` if available). Open `src-tauri/src/agent/README.md` and verify the three line-targeted edits read coherently.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/2026-05-05-codex-adapter-trait-simplification.md \
        docs/decisions/CLAUDE.md \
        docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md \
        src-tauri/src/agent/README.md
git commit -m "docs: add 2026-05-05 trait-simplification ADR + amend Stage 2 spec

New ADR records the decision to collapse BindContext + retry into
CodexAdapter (issue #156). decisions/CLAUDE.md index updated.

Stage 2 spec gains an 'Amended further by' header pointer, inline
supersede notes on the trait-signature-change and start_for-retry-loop
subsections, plus continuation lines under three File touch list rows
(mod.rs, base/mod.rs, types.rs) so future readers find the current
contract via the post-2026-05-05 spec.

agent/README.md updated across nine line-targeted edits (file-tree
types row; for_attach section incl. heading + signature; start
section signature; bind-flow paragraph; trait declaration; hook
table row; ClaudeCodeAdapter and NoOpAdapter examples; NoOp
'Why this exists' paragraph; detector dispatch reference). Line 11
historical pointer + line 60 file-tree mod.rs description stay.

Historical docs (CHANGELOG.md/.zh-CN.md, scope-expansion ADR,
Stage 2 plan) are deliberately not edited — their references
describe past state, not current state.

Issue #156. See spec section 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

After all six tasks land, run the issue #156 acceptance checklist (spec section 6.1):

- [ ] **Verify trait signature**

```bash
grep -rn 'fn status_source' src-tauri/src/agent/adapter/
```

Expected output (one line per file, all showing the `(cwd: &Path, session_id: &str) -> Result<StatusSource, String>` shape):

```
src-tauri/src/agent/adapter/mod.rs:    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;
src-tauri/src/agent/adapter/mod.rs:    fn status_source(...) [NoOpAdapter impl]
src-tauri/src/agent/adapter/claude_code/mod.rs:    fn status_source(...) [Claude impl]
src-tauri/src/agent/adapter/codex/mod.rs:    fn status_source(...) [Codex impl]
src-tauri/src/agent/adapter/base/transcript_state.rs:    fn status_source(...) [OrderingAdapter mock]
```

- [ ] **Verify type removal**

```bash
grep -rn 'BindContext\|BindError' src-tauri/src/ --include='*.rs'
```

Expected: matches only inside `src-tauri/src/agent/adapter/codex/types.rs`, `codex/mod.rs`, and `codex/locator.rs`. No matches outside `codex/`.

- [ ] **Verify start_for has no retry/sleep code**

```bash
grep -n 'sleep\|retry\|RETRY' src-tauri/src/agent/adapter/base/mod.rs
```

Expected: no matches.

- [ ] **Run the full test suite**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass. Test count delta vs. pre-refactor: -2 (deleted `bind_error_display_*` tests) +4 (`retry_locator_tests`) +2 (`status_source_tests`) = net +4. Plus -2 (deleted `start_for_retry_tests`) = net +2.

- [ ] **Run clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: no warnings.

- [ ] **Run formatting checks**

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
npm run format:check
```

Expected: both commands succeed with no output (or "All matched files use Prettier code style!" for the JS side). The pre-commit hook (lint-staged + prettier) handles incremental formatting on staged files, but per `rules/rust/hooks.md` `cargo fmt --check` is the authoritative Rust-side gate; CI runs `npm run format:check` for the workspace-wide check.

- [ ] **Manual end-to-end check**

Per spec section 4.5:

1. `npm run tauri dev`, open a terminal in the app.
2. Run `codex` in the PTY → wait one turn → status panel populates within ~1s.
3. Run `codex resume --last` in another fresh terminal → status panel populates immediately.
4. Run `claude` in a third terminal → Claude path unaffected.
5. Trigger an artificial bind-fatal: `chmod 000 ~/.codex` temporarily → frontend stays in silent-retry; restore permissions; next 2000ms re-poll resolves.

- [ ] **Confirm PR-scope discipline (per spec section 6.3)**

```bash
git diff --stat main..HEAD
```

Expected: only the 12 files in the spec's File touch list (Section 6.2) — 7 modified Rust + 1 added Rust + 1 added doc + 3 modified docs = 12 total. If any other file appears, audit and either justify in the PR description or split into a separate `chore(fmt):` commit per the PR-scope rule (PR #155).

```bash
git diff -w --stat main..HEAD
```

Expected: whitespace-stripped delta close to the regular delta. Any large gap is a formatting drive-by — surface and revert before opening the PR.
