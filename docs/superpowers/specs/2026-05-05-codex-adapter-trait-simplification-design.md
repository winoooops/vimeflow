# Codex adapter trait simplification — collapse BindContext + retry into CodexAdapter

**Date:** 2026-05-05
**Status:** Design
**Issue:** [#156](https://github.com/winoooops/vimeflow/issues/156)
**Scope:** Collapse the bind-time orchestration introduced in Stage 2 (PR #154)
— `BindContext` parameterization of `AgentAdapter::status_source` plus the
bounded retry inside `base::start_for` — back into the codex adapter, where the
requirement originates. The trait method returns to `(&Path, &str)` and
`base::start_for` becomes a single-call orchestrator.

**Predecessors (still load-bearing):**

- `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` — Stage 2
  spec. This design supersedes the trait-signature change at "Architecture >
  Trait signature change" (line ~213) and the `start_for` retry section at
  "Architecture > `start_for` retry loop" (line ~225); everything else stands.
- `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` —
  Stage 2 scope-expansion ADR (transcript tailer, /proc fast-paths, agent-PID
  bind). All three deviations remain in force; this refactor inherits them.

**Successor (mandated by this spec):**

- `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` — new ADR
  recording the trait-simplification decision and the spec sections it
  supersedes.

## Goal

`AgentAdapter::status_source` should not encode codex-only requirements.
Currently the trait signature carries `BindContext { session_id, cwd, pid,
pty_start }` and a `BindError { Pending, Fatal }` retry contract — both exist
solely to support codex's SQLite-logs cold-start race. Claude's
`status_source` ignores `pid`/`pty_start` and never returns `Pending`.

Round-3 review on PR #154 ([discussion_r3181677311][r1],
[discussion_r3181691871][r2]) flagged the leak. This spec moves both pieces
out of the trait surface:

1. Drop `BindContext` from the trait. `status_source(&self, cwd: &Path,
session_id: &str) -> Result<StatusSource, String>`. Adapters that need
   richer context construct it privately.
2. Drop the bounded retry from `base::start_for`. `CodexAdapter` runs its own
   internal retry loop. **Sleep budget on full exhaustion: 400ms** (5
   attempts × 100ms inter-attempt sleep, with the trailing sleep skipped —
   see Section 3.3 for the loop). **Total wall clock**: sleep budget plus
   5 × per-attempt `resolve()` overhead, ~10ms in practice. Marginally
   under the current implementation's 500ms sleep / ~510ms wall clock;
   neither threatens the frontend's 2000ms re-poll. Retry uses `pid` and
   `pty_start` stored on the adapter struct.
3. Rename `for_type(agent_type)` → `for_attach(agent_type, pid, pty_start)`
   so the factory threads codex's bind facts at construction time. Claude
   and `NoOpAdapter` constructors discard the codex-only fields.

User-visible behavior is unchanged. Codex still binds within ~500ms; Claude's
status panel populates identically; no IPC bump; no frontend change.

## Non-goals

- **No change to user-visible behavior.** The cold-start binding window
  (well under the frontend's 2000ms detection re-poll), error surfacing
  (silent retry), and the success/failure shape stay identical. The only
  sub-budget change is full-exhaustion sleep total shrinking from 500ms to
  400ms (sleep total; wall-clock total is sleep + 5 × per-attempt
  `resolve()` overhead — see Section 3.3 for the precise figures).
  Invisible to users because in practice codex commits its `logs` row well
  before 400ms, so the exhaustion path rarely fires (cf. 2026-05-04 ADR's
  `/proc` fast-path rationale).
- **No new error type on the trait.** `Result<StatusSource, String>` matches
  the existing `parse_status` / `tail_transcript` shape. Codex's internal
  retry distinguishes Fatal from retry-exhausted in the message string;
  callers (`base::start_for`) propagate verbatim and don't branch on
  variants.
- **No revisit of the 2026-05-04 ADR's three deviations.** Codex transcript
  tailer, `/proc`-as-chooser-when-SQLite-empty, and agent-PID-as-`BindContext.pid`
  remain in force. This refactor inherits them.
- **No change to `CodexSessionLocator`'s external semantics.** It still
  resolves `RolloutLocation` from `(cwd, sid, pid, pty_start)` and still
  emits `LocatorError::{NotYetReady, Unresolved, Fatal}`. The only
  locator-side change is that internal method signatures may take individual
  params instead of `&BindContext` — see Section 3.
- **No removal of the `spawn_blocking` wrap in `start_agent_watcher`.** The
  codex internal retry still uses `std::thread::sleep`, and
  `path_security::ensure_status_source_under_trust_root` still does sync
  `canonicalize` I/O. Both still need to run off the tokio worker.
- **No bundling of unrelated changes.** Per the PR-scope discipline tracked
  in [PR #155][pr155], this PR's diff answers "what does issue #156 say to
  do?" and nothing else. Drive-by formatting, comment polish, or other
  improvements go in separate commits. (PR #155 is OPEN as of this spec's
  write date; once merged, the canonical home is `rules/common/pr-scope.md`.
  Until then, reference the PR.)

## References

- Issue: [#156](https://github.com/winoooops/vimeflow/issues/156)
- Stage 2 PR: [#154](https://github.com/winoooops/vimeflow/pull/154)
- Round-3 review threads: [r1][r1], [r2][r2]
- PR-scope discipline (in flight): [PR #155][pr155]
- Stage 2 spec: [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](./2026-05-03-codex-adapter-stage-2-design.md)
- Stage 2 scope-expansion ADR: [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](../../decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md)

[r1]: https://github.com/winoooops/vimeflow/pull/154#discussion_r3181677311
[r2]: https://github.com/winoooops/vimeflow/pull/154#discussion_r3181691871
[pr155]: https://github.com/winoooops/vimeflow/pull/155

## Public surface changes

### 2.1 Trait `AgentAdapter::status_source`

Before (current, post-PR #154):

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;
    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError>;
    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;
    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;
    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
```

After:

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;
    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;
    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;
    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;
    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
```

Two changes from current:

- `(ctx: &BindContext<'_>)` → `(cwd: &Path, session_id: &str)`. The two facts
  every adapter actually consumes are surfaced as separate params. Codex's
  `pid` and `pty_start` move to the `CodexAdapter` struct (Section 3).
- `Result<StatusSource, BindError>` → `Result<StatusSource, String>`.
  `BindError` is deleted from `agent/adapter/types.rs`. There is no longer
  a Pending/Fatal distinction at the trait surface — the only consumer of
  that distinction was `base::start_for`'s retry loop, which moves into
  `CodexAdapter` (Section 3).

### 2.2 Factory `dyn AgentAdapter<R>::for_attach`

Before:

```rust
impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new())),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }
    // ... start, stop
}
```

After:

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
    // ... start, stop
}
```

`pid` and `pty_start` are passed through to `CodexAdapter::new`. Claude and
NoOp constructors discard them; the cost is two ignored arguments at one
call site, which is cheaper than a parallel factory.

### 2.3 `dyn AgentAdapter<R>::start` simplification

Before:

```rust
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
```

After:

```rust
pub fn start(
    self: Arc<Self>,
    app: AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    state: AgentWatcherState,
) -> Result<(), String> {
    base::start_for(self, app, session_id, cwd, state)
}
```

`pid` and `pty_start` drop from the parameter list — they no longer flow
through the orchestration layer because they're already baked into the
codex adapter at construction time.

### 2.4 `base::start_for` collapse

Before (excerpt):

```rust
pub(crate) fn start_for<R: tauri::Runtime>(
    adapter: Arc<dyn AgentAdapter<R>>,
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: PathBuf,
    pid: u32,
    pty_start: SystemTime,
    state: AgentWatcherState,
) -> Result<(), String> {
    let source =
        resolve_status_source_with_retry(adapter.as_ref(), &session_id, &cwd, pid, pty_start)?;
    path_security::ensure_status_source_under_trust_root(&source.path, &source.trust_root)?;
    // ... watcher startup
}

fn resolve_status_source_with_retry<R: tauri::Runtime>(...) -> Result<StatusSource, String> {
    // 5 × 100ms loop on BindError::Pending
    // ...
}

const BIND_RETRY_INTERVAL_MS: u64 = 100;
const BIND_RETRY_MAX_ATTEMPTS: u32 = 5;
```

After:

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
    // ... watcher startup unchanged
}
```

`resolve_status_source_with_retry` is deleted. The `BIND_RETRY_INTERVAL_MS`
and `BIND_RETRY_MAX_ATTEMPTS` constants move into `codex/mod.rs` as
`CODEX_BIND_RETRY_INTERVAL_MS` / `CODEX_BIND_RETRY_MAX_ATTEMPTS` (Section 3).

Imports removed from `base/mod.rs`:

- `std::time::Duration` — only used by `std::thread::sleep` in the deleted
  retry helper.
- `std::time::Instant` — only used to log retry-budget elapsed time in the
  deleted helper.
- `BindContext`, `BindError` — both gone with the helper.
- `StatusSource` — `start_for` references `source.path` / `source.trust_root`
  via field access, so the type name is no longer named in this file once the
  retry helper and its `start_for_retry_tests` mocks are removed.

The remaining imports (`std::path::PathBuf`, `std::sync::Arc`, the
`AgentAdapter` trait, the `path_security` / `transcript_state` /
`watcher_runtime` submodules) are unaffected.

### 2.5 `start_agent_watcher` rewire

The Tauri command at `agent/adapter/mod.rs:130-164` keeps its existing shape
but threads the agent PID + pty_start through the new factory:

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
    // bounded retry (5 × 100 ms) using `std::thread::sleep` because
    // codex commits its `logs` row ~300ms after the rollout file opens.
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

Two surface deltas from current:

- `for_type(agent_type)?` → `for_attach(agent_type, agent_pid, pty_start)?`.
  The `agent_pid` is the codex child PID returned by `detect_agent` (per the
  2026-05-04 ADR), not the shell PID at the PTY root.
- `adapter.start(...)` drops the `pid` and `pty_start` arguments.
- The rationale comment is updated to attribute the retry to the codex
  adapter rather than to `start_for`. Functional content (sleep + sync I/O
  → spawn_blocking) is unchanged.

`resolve_bind_inputs` is unchanged: it still returns `(cwd, shell_pid,
pty_start, agent_type, agent_pid)` and the test at
`agent/adapter/mod.rs:298` still asserts the agent-PID-not-shell-PID
invariant.

### 2.6 Removed types

`agent/adapter/types.rs` loses two public types:

- `pub struct BindContext<'a>` — deleted. (May be reintroduced as a
  `pub(super)`/private struct inside `codex/`; see Section 3.)
- `pub enum BindError` — deleted along with its `Display` and `Error` impls.
  No external callers depend on `BindError::{Pending, Fatal}` discrimination
  after `base::start_for` stops branching on it.

Two pinned-format regression tests at `types.rs:135-145`
(`bind_error_display_pending_format`, `bind_error_display_fatal_format`) are
deleted with `BindError`. The `ValidateTranscriptError` Display tests
(`types.rs:93-133`) are unaffected.

**NoOpAdapter rewrite** (`agent/adapter/mod.rs`). The current impl threads
`ctx.cwd` / `ctx.session_id` through; the new impl receives them directly:

```rust
impl<R: tauri::Runtime> AgentAdapter<R> for NoOpAdapter {
    fn agent_type(&self) -> AgentType { self.agent_type.clone() }

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

    // parse_status / validate_transcript / tail_transcript bodies unchanged
}
```

The corresponding test (`mod.rs:222-243`,
`status_source_uses_claude_shaped_path`) drops the `BindContext` literal
and calls the trait method with `(&cwd, "sid")` directly. Assertions on
`src.path` / `src.trust_root` are unchanged.

**ClaudeCodeAdapter rewrite** (`agent/adapter/claude_code/mod.rs`).
Identical mechanical edit — body still uses `cwd` / `session_id`, the
former `ctx.cwd` / `ctx.session_id` accesses become the parameter names
directly:

```rust
impl<R: tauri::Runtime> AgentAdapter<R> for ClaudeCodeAdapter {
    fn agent_type(&self) -> AgentType { AgentType::ClaudeCode }

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

    // parse_status / validate_transcript / tail_transcript bodies unchanged
}
```

The Claude test (`claude_code/mod.rs:74-96`,
`status_source_returns_claude_path_under_cwd`) drops its `BindContext`
literal the same way. The `pid: 0, pty_start: SystemTime::UNIX_EPOCH`
filler that the test currently passes goes away — those fields no longer
exist in the trait input.

### 2.7 Import deltas across adapter files

Two `use`-statement edits propagate through every file that previously
imported `BindContext` / `BindError`. Per-file enumeration:

- **`agent/adapter/mod.rs`**:
  - `use std::path::PathBuf;` → `use std::path::{Path, PathBuf};` (trait sig
    now names `Path`).
  - `use types::{BindContext, BindError, ParsedStatus, StatusSource,
ValidateTranscriptError};` →
    `use types::{ParsedStatus, StatusSource, ValidateTranscriptError};`.
  - `use std::time::SystemTime;` retained — `for_attach` still names it.
- **`agent/adapter/claude_code/mod.rs`**:
  - `use std::path::PathBuf;` → `use std::path::{Path, PathBuf};`.
  - Drop `BindContext`, `BindError` from the types import.
- **`agent/adapter/codex/mod.rs`**:
  - `use std::path::PathBuf;` → `use std::path::{Path, PathBuf};` (the new
    `status_source(&self, cwd: &Path, …)` trait method names `Path`).
  - Add `use std::time::SystemTime;` (the `pty_start: SystemTime` adapter
    field names it).
  - Drop `BindContext`, `BindError` from the existing
    `use crate::agent::adapter::types::{…}` import.
  - Add `mod types;` declaration alongside the existing `mod locator;` /
    `mod parser;` / `mod transcript;` lines, plus
    `use self::types::BindContext;`.
  - Update the locator import:
    `use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError};`
    becomes `use self::locator::{CodexSessionLocator, CompositeLocator,
LocatorError, RolloutLocation};` (the new `retry_locator` helper names
    `RolloutLocation`).
- **`agent/adapter/codex/locator.rs`**:
  - `use crate::agent::adapter::types::BindContext;` →
    `use super::types::BindContext;`.
  - All `&BindContext<'_>` parameter types remain unchanged.
- **`agent/adapter/base/mod.rs`** — see the import list under Section 2.4.
- **`agent/adapter/base/transcript_state.rs`** — the `OrderingAdapter` mock
  at `base/transcript_state.rs:458` updates its `status_source` impl
  signature from
  `(&self, _ctx: &crate::agent::adapter::types::BindContext<'_>) -> Result<crate::agent::adapter::types::StatusSource, crate::agent::adapter::types::BindError>`
  to `(&self, _cwd: &std::path::Path, _session_id: &str) -> Result<crate::agent::adapter::types::StatusSource, String>`.
  Body stays `unreachable!()`. Other types in this mock impl (`ParsedStatus`,
  `ValidateTranscriptError`) are already fully-qualified so no further
  import edits are needed.

Both common-rules (`rules/common/coding-style.md`) and Rust-specific style
(`rules/rust/coding-style.md`) flag unused imports. The edits above are
mechanical; CI will surface any drift.

## Codex internals

### 3.1 Private `BindContext` inside `codex/`

`BindContext` is removed from `agent/adapter/types.rs` (Section 2.6) but the
locator's internal API still benefits from a single bag-of-attach-facts
parameter (10+ method signatures take `&BindContext<'_>` today). Reintroduce
it as a private codex-internal struct at `agent/adapter/codex/types.rs`:

```rust
// agent/adapter/codex/types.rs (new file)

use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, Copy)]
pub(super) struct BindContext<'a> {
    pub(super) session_id: &'a str,
    pub(super) cwd: &'a Path,
    pub(super) pid: u32,
    pub(super) pty_start: SystemTime,
}
```

Field shape and `Copy`/`Clone` semantics match the deleted public type
verbatim, so `codex/locator.rs` body changes are minimal — only the import
path moves (`use crate::agent::adapter::types::BindContext` →
`use super::types::BindContext`).

Visibility is `pub(super)`, restricting the struct to the `codex/` module
tree. External callers cannot construct or observe it.

**Module wiring (mechanical, three edits):**

- `codex/mod.rs` adds `mod types;` alongside the existing `mod locator;` /
  `mod parser;` / `mod transcript;` declarations.
- `codex/mod.rs` adds `use self::types::BindContext;` to bring the private
  type into scope for `CodexAdapter::status_source` (Section 3.4).
- `codex/locator.rs` switches its existing
  `use crate::agent::adapter::types::BindContext;` to
  `use super::types::BindContext;`. No locator method body changes.

The new `types.rs` is the only added file in this section. It is two
imports + one struct declaration, ~12 lines total.

### 3.2 `CodexAdapter` struct

Before:

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
    // ...
}
```

After:

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
    /// `status_source_tests` seed a temp `~/.codex` mock without touching
    /// the user's real home. Field initializers duplicate `new`; the
    /// duplication is intentional so the test seam is fully gated and
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
    // ...
}

fn default_codex_home() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}
```

Two changes from current beyond the `pid`/`pty_start` addition:

- New field `codex_home: PathBuf`. Resolved once in `new()` via
  `default_codex_home()`; stored on the adapter so `status_source` and the
  locator can both reference `self.codex_home` rather than the static
  `Self::codex_home()` getter.
- The current `fn codex_home() -> PathBuf` static method is replaced by the
  free function `default_codex_home()` (used only in `new()`). The static
  method is deleted; all in-impl call sites switch to `&self.codex_home` /
  `self.codex_home.clone()`.
- The release build path is unchanged: `new()` continues to derive the
  codex home from `dirs::home_dir()`. The `with_home` constructor exists
  only under `#[cfg(test)]`, so production has no extra branch.

`pid`, `pty_start`, and `codex_home` are owned by the adapter for its
lifetime — one attach. The cache scoping reasoning from the 2026-05-03
stage-2 spec ("`<dyn AgentAdapter<R>>::for_type(...)` constructs a fresh
`Arc<CodexAdapter>`, so the cache scope is 'one attach'; across attaches,
discovery re-runs against a new instance") still holds — substituting
`for_type` (Stage 2's name) with `for_attach` (this spec's rename) is a
mechanical change. Each new attach produces a fresh `CodexAdapter` with
its own snapshot, so there's no cross-session state to invalidate.

`CodexAdapter::new()` becomes `CodexAdapter::new(pid, pty_start)`. Tests
that previously called `CodexAdapter::new()` (e.g. the `adapter_tests`
module at `codex/mod.rs:104-153`) update their construction sites to pass
test-shaped `pid` / `pty_start` values; tests that need to exercise
`status_source` or trust-root assertions use `with_home(pid, pty_start,
temp_dir.path().to_path_buf())` instead.

### 3.3 Internal retry helper

The retry logic moves from `base::resolve_status_source_with_retry` into a
small private helper inside `codex/mod.rs`. It takes a closure that returns
`Result<RolloutLocation, LocatorError>` (the existing locator error shape),
so tests can drive it without constructing a real `CompositeLocator`:

```rust
// agent/adapter/codex/mod.rs

const CODEX_BIND_RETRY_INTERVAL_MS: u64 = 100;
const CODEX_BIND_RETRY_MAX_ATTEMPTS: u32 = 5;

/// Retry a codex locator resolution up to the bind budget. Returns the
/// resolved location on success, or a formatted error string on:
///
/// - The first non-`NotYetReady` error from the closure (Fatal /
///   Unresolved → bubble up immediately, no further attempts).
/// - Budget exhaustion (`CODEX_BIND_RETRY_MAX_ATTEMPTS` consecutive
///   `NotYetReady` returns).
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
                // Skip the trailing sleep on the final attempt — we are
                // about to bail with `retry exhausted` anyway, so an
                // additional `sleep` only inflates wall clock without
                // giving codex more time to commit its row.
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

Key invariants preserved from the deleted `resolve_status_source_with_retry`:

- **Sleep budget = 400ms on full exhaustion.** 5 attempts with a sleep
  _between_ attempts (skipped after the final attempt — see the
  `attempt + 1 < CODEX_BIND_RETRY_MAX_ATTEMPTS` guard above) gives 4 ×
  100ms = 400ms of sleep on the worst-case exhaustion path. The deleted
  `resolve_status_source_with_retry` slept after every attempt for 5 ×
  100ms = 500ms of sleep — both budgets are about the _sleep_ total, not
  the total wall clock.
- **Total wall clock = sleep + 5 × `resolve()` overhead.** Each
  `resolve()` call performs SQLite reads (typically a few ms each). New
  worst case: ~400ms + ~10ms = ~410ms. Old worst case: ~500ms + ~10ms =
  ~510ms. Both fit under `DETECTION_POLL_MS / 2 = 1000ms` (a much wider
  margin than the spec's 500ms claim implies, but neither implementation
  threatens the frontend's 2000ms re-poll cadence at
  `useAgentStatus.ts:19`). The new helper trims roughly 100ms off the
  exhaustion-case wall clock; in practice the cold-start race resolves in
  <300ms anyway, so users almost never see exhaustion.
- **Pending-only retries.** `LocatorError::NotYetReady` is the sole retry
  trigger. Both `Unresolved` and `Fatal` short-circuit immediately — they
  represent structural failures that will not resolve by waiting.
- **Diagnostic warn on exhaustion.** A `log::warn!` line includes the
  attempt count and elapsed time, matching the existing diagnostic at
  `base/mod.rs:92-96`.
- **Error string format.** "codex bind fatal: <reason>" and "codex bind
  retry exhausted: <last>" are the two shapes. Both flow through
  `start_for`'s error propagation to the frontend's silent-retry path
  unchanged.

The helper is `fn` not method-on-`Self` so it can be tested in isolation
with synthesized closures. It does not need access to adapter state.

### 3.4 `CodexAdapter::status_source` body

```rust
impl<R: tauri::Runtime> AgentAdapter<R> for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<StatusSource, String> {
        let ctx = BindContext {
            session_id,
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

    // parse_status, validate_transcript, tail_transcript: unchanged
}
```

The `BindContext` constructed inside `status_source` uses the adapter's
stored `pid`/`pty_start` for the codex-only fields and the trait-method
params for `cwd`/`session_id`. The `&ctx` reference is captured by the
closure passed to `retry_locator`.

Mutex update of `resolved_rollout_path` happens once on success, identical
to the current implementation. The 2026-05-04 ADR's "lifecycle invariant
that `parse_status` must run after `status_source`" remains in force; the
`Arc<CodexAdapter>` lifetime is one attach, and the slot is only ever
written once before any `parse_status` call could observe it.

### 3.5 Locator integration

`agent/adapter/codex/locator.rs` keeps its existing trait, struct shapes,
and method bodies. The only diff is the import:

```rust
// before
use crate::agent::adapter::types::BindContext;

// after
use super::types::BindContext;
```

Internal method signatures (`fn resolve_rollout(&self, ctx: &BindContext<'_>)
-> Result<RolloutLocation, LocatorError>` and the various `pub(super)`
helpers that take `&BindContext<'_>`) are unchanged because the private
struct's field shape matches the deleted public type. `LocatorError` is
unchanged (the trait still distinguishes `NotYetReady` / `Unresolved` /
`Fatal`; the discrimination is consumed by the new `retry_locator` helper
above).

The ~30+ test fixtures in `locator.rs::tests` that build a `BindContext`
literal also keep working with one mechanical edit (the `use` path), since
field names and types match. Test-module imports use either
`super::super::types::BindContext` (because from inside `locator.rs::tests`,
`super` is the `locator` module and `super::super` is `codex`) or the
fully-qualified `crate::agent::adapter::codex::types::BindContext`.
The non-test top-of-file `use super::types::BindContext;` (where `super`
is `codex`) does not apply inside the nested test submodule.

## Tests migration plan

The bind-retry test surface has three buckets after this refactor: tests
deleted, tests adapted, tests added. Total is roughly net-zero — no
coverage regression, no new heavy fixtures.

### 4.1 Tests deleted

Two test modules / blocks go away because the symbols they exercise are
deleted:

- **`agent/adapter/base/mod.rs::start_for_retry_tests`** (lines 103-240,
  ~138 LOC). The `start_for_retries_on_pending_then_succeeds_under_budget`
  and `start_for_returns_err_when_pending_budget_exhausted` tests assert
  retry semantics on `start_for`. After the refactor `start_for` has zero
  retry code; the assertions become tautological. Equivalent coverage
  moves to `codex/mod.rs::retry_locator_tests` (Section 4.3).
- **`agent/adapter/types.rs::display_tests::bind_error_display_pending_format`
  / `bind_error_display_fatal_format`** (lines 135-145). `BindError` is
  deleted; its Display impl goes with it. The `ValidateTranscriptError`
  Display tests in the same module (lines 93-133) stay.

Net deletion: ~2 test modules, ~150 LOC.

### 4.2 Tests adapted

Mechanical sig + literal updates. No assertion changes:

- **`agent/adapter/mod.rs::noop_tests::status_source_uses_claude_shaped_path`**
  (lines 222-243) — drop the `BindContext` literal; pass `(&cwd, "sid")`
  to the trait method. Assertions on `src.path` / `src.trust_root`
  unchanged.
- **`agent/adapter/claude_code/mod.rs::tests::status_source_returns_claude_path_under_cwd`**
  (lines 74-96) — same shape edit. Drop the `pid: 0, pty_start: UNIX_EPOCH`
  filler that no longer has any analog in the new sig.
- **`agent/adapter/mod.rs::noop_tests::for_type_returns_real_codex_adapter`**
  (lines 257-267) — renames to `for_attach_returns_real_codex_adapter` and
  updates the call site to
  `<dyn AgentAdapter<MockRuntime>>::for_attach(AgentType::Codex, 12345,
SystemTime::UNIX_EPOCH)`. The `parse_status` round-trip assertion stays
  unchanged.
- **`agent/adapter/codex/mod.rs::adapter_tests`** (lines 104-153) — the
  three existing tests construct `CodexAdapter::new()` and drive
  `parse_status` / `validate_transcript`. Update construction to
  `CodexAdapter::new(test_pid, test_pty_start)`. Test pid/pty_start values
  can be sentinel: `CodexAdapter::new(12345, SystemTime::UNIX_EPOCH)`.
  No assertion changes — these tests don't exercise `status_source`.
- **`agent/adapter/codex/locator.rs::tests`** (~30+ tests, the `ctx<'a>`
  helper at lines 759-770 and 997-1008). The helper builds a
  `BindContext` literal; only the `use` statement at the top of the test
  module changes (`use crate::agent::adapter::types::BindContext` →
  `use super::super::types::BindContext` or equivalent path-relative
  import). Field shapes are identical so the literal builders compile
  unchanged.
- **`agent/adapter/base/transcript_state.rs::replace_on_cwd_change_stops_old_before_spawning_new`'s
  `OrderingAdapter`** (lines 446-464) — the `unreachable!` mock impl's
  signature updates from
  `(&self, _ctx: &BindContext<'_>) -> Result<StatusSource, BindError>`
  to `(&self, _cwd: &Path, _session_id: &str) -> Result<StatusSource, String>`.
  Body stays `unreachable!()`.

Net adaptation: ~6 tests + 1 mock-adapter sig + 1 import path. All edits
are mechanical and lint-checkable.

### 4.3 Tests added

Two new test groups in `agent/adapter/codex/mod.rs`. They cover the retry
semantics that move out of `base/start_for_retry_tests`, plus the new
trait-method signature on `CodexAdapter`:

**`retry_locator_tests`** — drives the new `retry_locator` helper directly
with synthesized closures, no real `CompositeLocator` needed:

```rust
#[cfg(test)]
mod retry_locator_tests {
    use super::*;
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
        assert!(result.is_ok());
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
        assert!(result.unwrap_err().contains("retry exhausted"));
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
        assert!(result.unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // Generous bound — fatal should not sleep at all, so ~0ms in
        // practice; 100ms covers loaded-CI scheduler delay.
        assert!(started.elapsed() < std::time::Duration::from_millis(100));
    }

    #[test]
    fn unresolved_short_circuits_immediately() {
        let calls = AtomicUsize::new(0);
        let result = retry_locator(|| {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(LocatorError::Unresolved("ambiguous candidates".to_string()))
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("codex bind fatal"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
```

Coverage: retry call-count discipline + Pending/Fatal/Unresolved
discrimination, all without touching the filesystem or constructing a real
`CompositeLocator`. Wall-clock assertions are dropped from the
budget-exhaustion tests because scheduler delay on loaded CI runners can
push 4 × `thread::sleep(100ms)` past tight bounds without a behavior
regression — call count is the load-bearing assertion, time is incidental.
The fatal short-circuit keeps a `< 100ms` bound because that path takes
zero sleeps and a wall-clock check protects against an accidental sleep
being added to the no-retry branches.

**`status_source_tests`** — covers the new `(cwd, sid)` trait-method
signature on `CodexAdapter`. Uses `CodexAdapter::with_home` (Section 3.2,
`#[cfg(test)]` constructor) to inject a tempdir-backed codex home so the
test isolates from the user's real `~/.codex`:

```rust
#[cfg(test)]
mod status_source_tests {
    use super::*;
    use tauri::test::MockRuntime;

    /// Seeds a tempdir with the SQLite logs/threads schema + a thread row
    /// for the given (pid, pty_start) pointing at a writable rollout
    /// path. Returns the rollout path so the test can assert it.
    /// Existing helpers in `locator::tests::fixtures` model what to
    /// reuse / extract into a shared test module here.
    fn seed_codex_home_with_thread(
        codex_home: &Path,
        pid: u32,
        pty_start: SystemTime,
    ) -> PathBuf { /* ... */ }

    #[test]
    fn status_source_returns_resolved_rollout_on_happy_path() {
        let codex_home = tempfile::tempdir().expect("tempdir");
        let pty_start = SystemTime::now() - std::time::Duration::from_secs(5);
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

Net addition: 1 retry helper test module (~80 LOC `retry_locator_tests`) +
1 trait-method shape test module (~50 LOC `status_source_tests`).
Counterbalances the deletion of `start_for_retry_tests`.

### 4.4 Coverage target

Per `rules/rust/testing.md` (which inherits the 80% target from
`rules/common/testing.md`): every new code path needs ≥80% line coverage.

- The `retry_locator` helper is small (~25 LOC); the four `retry_locator_tests`
  above cover all four exit paths (Ok, NotYetReady-exhaustion, Fatal,
  Unresolved). Line coverage ≥95%.
- `CodexAdapter::new(pid, pty_start)` and `with_home(pid, pty_start, codex_home)`
  are constructors; coverage flows from any test that calls them. `new` is
  exercised by `adapter_tests` (sentinel-arg construction); `with_home` is
  exercised by `status_source_tests`.
- `CodexAdapter::status_source(cwd, sid)` is exercised by the
  `status_source_tests` above (happy + retry-exhausted). Line coverage ≥80%.
- The mechanical adapter rewrites in NoOp / Claude have existing tests that
  cover their bodies; coverage is unaffected.

### 4.5 Manual verification (dev-time, before opening PR)

1. `npm run tauri dev`, open a terminal in the app.
2. Run `codex` in the PTY → wait one turn → status panel populates within
   ~1s. Check the dev-tools console for any errors mentioning bind /
   retry. (No regressions vs. PR #154's manual-verification step.)
3. Run `codex resume --last` in another fresh terminal → status panel
   populates immediately from the rolled-up history.
4. Spawn a third terminal; run `claude` → Claude path unaffected, no cost
   regressions.
5. Trigger an artificial bind-fatal (most reliable: chmod 000 ~/.codex
   temporarily) → verify the frontend stays in the silent-retry loop and
   does not crash. Restore permissions; the next 2000ms re-poll resolves
   normally.
6. Run `cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow
agent::adapter` (from the repo root) and confirm all listed migrations
   / additions pass. The `--manifest-path` flag is required because the
   crate's `Cargo.toml` lives under `src-tauri/`, not at the repo root.

## Documentation changes

The doc trail mirrors the 2026-05-04 scope-expansion ADR pattern: a new
ADR records the decision and what spec sections it supersedes; the stage-2
spec is amended in place with an "Amended by" pointer at the top + inline
supersede notes on the affected sections.

### 5.1 New ADR — `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`

File added under `docs/decisions/`. Structure follows the dated-record
template documented at `docs/decisions/CLAUDE.md` (Context → Options →
Decision → Justification → Alternatives rejected → Known risks →
References). Concrete outline:

- **Context**: Round-3 review on PR #154 flagged that `BindContext` and the
  `start_for` retry leak codex-only requirements through the trait
  surface. Quote the two relevant review threads. Note that this ADR is a
  partial reversal of decisions made in the 2026-05-03 stage-2 spec, but
  not of the scope-expansion deviations recorded in the 2026-05-04 ADR
  (transcript tailer, `/proc` fast-paths, agent-PID bind — those stay).
- **Options considered**:
  1. Leave as-is — accept the trait-surface leak.
  2. Move `pid`/`pty_start` to the codex adapter, but keep the bounded
     retry in `start_for`. Half-fix.
  3. Move both pieces into the codex adapter (this spec's choice).
- **Decision**: Choose option 3.
- **Justification** (numbered list, drawing on the same arguments as
  Section 1 of this spec):
  1. Single-responsibility: the trait describes "what an agent adapter
     does"; codex's cold-start race is "how the codex adapter does it",
     not part of the contract.
  2. Future adapters (Aider, Generic, etc.) shouldn't need to learn about
     `BindContext` to implement `status_source`.
  3. The retry budget is calibrated against codex-specific commit
     timings; it doesn't generalize. Hosting it inside the codex adapter
     keeps the calibration close to the rationale.
  4. The change is a pure internal refactor — no IPC, no user-visible
     behavior change, no scope expansion.
- **Alternatives rejected**:
  - Option 1: leaves the leak; round-3 review explicitly called this out
    as a finding, not a stylistic preference.
  - Option 2: half-fix. The retry budget still has nowhere coherent to
    live — `start_for` would still be branching on a Pending/Fatal
    distinction that only one adapter ever produces.
- **Known risks & mitigations**:
  - **Risk:** A second adapter eventually needs the same retry shape and
    will re-introduce a parallel-but-divergent retry helper. **Mitigation:**
    the `retry_locator` helper is internal to codex and trivially small;
    if a second adapter needs the same shape, promote a generic
    `retry_with_budget` to a shared `agent/adapter/util.rs` at that point,
    not preemptively.
  - **Risk:** Sleep-budget tightening from 5 × 100ms to 4 × 100ms is a
    real behavior change. **Mitigation:** the cold-start window is
    typically ~300ms (per the 2026-05-04 ADR's `/proc` fast-path
    rationale), well below 400ms. The exhaustion path is rare in practice.
- **References**:
  - Issue #156, PR #154, round-3 threads
  - 2026-05-03 stage-2 spec
  - 2026-05-04 scope-expansion ADR
  - This new spec (2026-05-05 trait simplification)

The ADR is committed in the same PR as the spec (and code), per the
template at `docs/decisions/CLAUDE.md`.

### 5.2 Stage-2 spec amendment

`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` is
already marked "Implemented (with documented scope expansion)" with an
"Amended by" line at the top pointing to the 2026-05-04 ADR. Add a second
"Amended by" line for this refactor:

```diff
 **Amended by:** `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` — the implementation expanded past three of this spec's locked rules (Codex transcript tailer, `/proc`-as-chooser, `BindContext.pid` semantics). Where this spec and that ADR conflict, the ADR wins for those three items only; the rest of this spec stands.
+**Amended further by:** `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` — the trait signature change at "Architecture > Trait signature change" and the `start_for` retry rules at "Architecture > `start_for` retry loop" are superseded by the new ADR. The codex-adapter-internal retry, the `(cwd, sid)` trait method, and the `for_attach(agent_type, pid, pty_start)` factory replace those rules. Everything else in this spec stands.
```

Specific spec lines that get inline supersede markers (HTML comments + a
strikethrough is overkill; a single italic-prefixed sentence works):

- Line ~213 ("Architecture > Trait signature change", showing the
  `(ctx: &BindContext)` sig): prepend an italicised note: _Superseded by
  `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md` —
  the trait method is now `(cwd: &Path, session_id: &str) -> Result<…,
String>`. The discussion below describes the Stage 2 surface as
  shipped; current surface is in the new spec._
- Line ~225 ("Architecture > `start_for` retry loop"): same shape note
  — _Superseded; the retry now lives inside `CodexAdapter`. `start_for`
  has zero retry code post-2026-05-05._
- "File touch list" section's `mod.rs` and `base/mod.rs` rows: append a
  note that the post-2026-05-05 mechanics differ; the original rows
  stand for Stage 2's history.

Per `rules/common/coding-style.md`'s "documentation accuracy" pattern (and
the `docs/reviews/` review-knowledge-base), broken doc references trigger
LOW-severity review findings; the supersede markers are the cheapest way
to keep the historical spec text intact while making the current contract
discoverable.

### 5.3 `src-tauri/src/agent/README.md` updates

The agent module's README documents the current state of the code, so it
must update alongside the code (unlike the historical CHANGELOG entries
or the 2026-05-04 ADR/plan, which record what was true at their dates and
must not be edited). Three line-targeted edits:

- **Line 67** (file-tree comment for `types.rs`):
  - Current: `├── types.rs             ← StatusSource, ParsedStatus, BindContext, BindError, ValidateTranscriptError`
  - New: `├── types.rs             ← StatusSource, ParsedStatus, ValidateTranscriptError`
  - Reason: `BindContext` and `BindError` are deleted from `types.rs`
    (Section 2.6).
- **Line 98** (follow-up tracking blockquote):
  - Current: `> **Follow-up tracking:** issue [#156] collapses BindContext and the central retry into CodexAdapter::new(pid, pty_start)…`
  - New: `> **Resolved 2026-05-05** by [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`] (issue [#156] / PR #<TBD>): BindContext is now private to codex/, BindError is deleted, the trait method is `(cwd, sid) -> Result<\_, String>`, and codex's cold-start retry lives in CodexAdapter::status_source.`
  - Reason: this spec is the resolution of that follow-up, so the
    blockquote shifts from "tracking" to "resolved" once this PR merges.
- **Line 116** (description of the bind flow):
  - Current: `…both arguments are passed through to the adapter as fields of BindContext (delegated through base::start_for → resolve_status_source_with_retry → adapter.status_source(&ctx))…`
  - New: `…both arguments are stored on CodexAdapter at construction (CodexAdapter::new(pid, pty_start)). The codex adapter wraps them in a private BindContext for its locator on each status_source call. base::start_for invokes adapter.status_source(cwd, session_id) once and the codex internal retry lives in retry_locator (5 attempts, 4 × 100ms inter-attempt sleeps, total 400ms sleep budget).`
  - Reason: factually describes the post-2026-05-05 flow.

Line 11 stays unchanged. It's a pointer to the 2026-05-04 scope-expansion
ADR; that ADR's mention of `BindContext.pid` semantics is a historical
deviation record (one of the three Stage 2 spec rules the implementation
relaxed). The historical mention is still accurate; this spec doesn't
re-litigate it.

### 5.4 No CHANGELOG entry yet

Per `CHANGELOG.md` / `CHANGELOG.zh-CN.md` convention (one entry per merged
PR, paired with review patterns), the CHANGELOG entry lands at PR-merge
time, not at spec-write time. The bilingual entry mirrors the standard
template:

```
- **refactor(agent/adapter)**: collapse BindContext + retry into CodexAdapter (#<pr-number>).
  Trait method is `(cwd, sid) -> Result<_, String>` again; codex's
  cold-start retry lives inside the adapter. No user-visible change.
  Spec: `2026-05-05-codex-adapter-trait-simplification-design.md`. ADR:
  `2026-05-05-codex-adapter-trait-simplification.md`.
```

The Chinese mirror is added in the same commit. PR template fills in
`<pr-number>` post-merge.

## Acceptance criteria & file touch list

### 6.1 Acceptance criteria checklist

Reproduces the issue #156 criteria as a verifiable checklist. Each item is
a build/test/lint pass that gates PR merge:

- [ ] `AgentAdapter::status_source` signature is
      `fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>`.
      Verified by `grep -rn 'fn status_source' src-tauri/src/agent/adapter/`
      showing the new shape across mod.rs, claude_code/mod.rs, codex/mod.rs.
- [ ] `BindContext` and `BindError` no longer appear in `agent/adapter/types.rs`.
      Verified by
      `grep -rn 'BindContext\|BindError' src-tauri/src/ --include='*.rs'`
      returning matches only inside `agent/adapter/codex/` (the private
      codex-internal `BindContext`). The `--include='*.rs'` flag scopes the
      check to source so the README's prose mentions of those former type
      names (which Section 5.3 rewrites) don't pollute the result.
- [ ] `base::start_for` body has zero retry/sleep code. Verified by
      `grep -n 'sleep\|retry\|RETRY' src-tauri/src/agent/adapter/base/mod.rs`
      returning no matches.
- [ ] All existing PR #154 functionality preserved:
  - Codex cold-start still binds within ~500ms (manual-verification step
    2 in Section 4.5).
  - Claude's status panel populates the same way (manual-verification
    step 4).
  - No IPC bump (`src/bindings/` regeneration produces no diff beyond
    what the rust struct field names emit).
- [ ] New ADR `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`
      exists and supersedes the relevant sections of the stage-2 spec. Stage-2
      spec has the `Amended further by:` line at top + inline supersede
      markers (Section 5.2).
- [ ] Tests pass: `cargo test --manifest-path src-tauri/Cargo.toml
agent::adapter`. The `start_for_retry_tests` module no longer exists;
      `codex/mod.rs::retry_locator_tests` and `status_source_tests` exist and
      pass.
- [ ] Lint clean: `cargo clippy --manifest-path src-tauri/Cargo.toml
--all-targets -- -D warnings` with no unused-import findings.

### 6.2 File touch list

Per `rules/common/coding-style.md`'s "explicit file touch list" pattern
(also reflected in stage-2 spec's File touch list section). Each row
answers: "what does this file change implement, per Section X of this
spec?"

**Backend (Rust) — modified:**

| File                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                       | Section                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src-tauri/src/agent/adapter/types.rs`                 | Delete `BindContext` struct + `BindError` enum + their Display tests                                                                                                                                                                                                                                                                                                                                                                         | 2.6                          |
| `src-tauri/src/agent/adapter/mod.rs`                   | Trait sig change; rename `for_type` → `for_attach` taking `(agent_type, pid, pty_start)`; `start` drops `pid`/`pty_start` params; `start_agent_watcher` uses new factory; rewrite `NoOpAdapter::status_source`; update tests; import `Path`+`SystemTime` already present                                                                                                                                                                     | 2.1, 2.2, 2.3, 2.5, 2.6, 4.2 |
| `src-tauri/src/agent/adapter/base/mod.rs`              | Delete `resolve_status_source_with_retry`; delete `BIND_RETRY_*` constants; simplify `start_for` body; delete `start_for_retry_tests` module; clean unused imports                                                                                                                                                                                                                                                                           | 2.4, 4.1                     |
| `src-tauri/src/agent/adapter/base/transcript_state.rs` | Update `OrderingAdapter` mock `status_source` impl signature only (FQN-style refs)                                                                                                                                                                                                                                                                                                                                                           | 2.7, 4.2                     |
| `src-tauri/src/agent/adapter/claude_code/mod.rs`       | Trait sig change in impl block; rewrite `status_source` body to use direct `cwd`/`session_id` params; update `status_source_returns_claude_path_under_cwd` test                                                                                                                                                                                                                                                                              | 2.1, 4.2                     |
| `src-tauri/src/agent/adapter/codex/mod.rs`             | Add `pid`/`pty_start`/`codex_home` fields; `new(pid, pty_start)` + `#[cfg(test)] with_home`; `default_codex_home()` free fn; private `BindContext` import via `use self::types::BindContext`; new `retry_locator` helper + tests; new `status_source_tests`; trait impl uses new sig; locator import gains `RolloutLocation`; existing `adapter_tests` updated to pass sentinel construction args; delete static `Self::codex_home()` method | 3.2, 3.3, 3.4, 4.2, 4.3      |
| `src-tauri/src/agent/adapter/codex/locator.rs`         | Single import edit: `crate::agent::adapter::types::BindContext` → `super::types::BindContext`. No body changes                                                                                                                                                                                                                                                                                                                               | 3.5, 2.7                     |

**Backend (Rust) — added:**

| File                                         | Purpose                                                               | Section |
| -------------------------------------------- | --------------------------------------------------------------------- | ------- |
| `src-tauri/src/agent/adapter/codex/types.rs` | Private `pub(super) struct BindContext` + supporting imports. ~12 LOC | 3.1     |

**Documentation — added:**

| File                                                                             | Purpose   | Section |
| -------------------------------------------------------------------------------- | --------- | ------- |
| `docs/decisions/2026-05-05-codex-adapter-trait-simplification.md`                | New ADR   | 5.1     |
| `docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md` | This spec | n/a     |

**Documentation — modified:**

| File                                                                | Change                                                                                                                                                                                                                                | Section                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` | Add `Amended further by:` line at top; inline supersede notes on the trait-sig and `start_for` retry sections                                                                                                                         | 5.2                           |
| `docs/decisions/CLAUDE.md`                                          | Append the new ADR to the index table (date, decision title, status `Accepted`)                                                                                                                                                       | n/a (mechanical index update) |
| `src-tauri/src/agent/README.md`                                     | Lines 67, 98, 116 updated to describe the post-2026-05-05 flow (private codex BindContext; trait method `(cwd, sid)`; CodexAdapter::new takes pid/pty_start). Line 11 stays — the scope-expansion ADR pointer is a historical record. | 5.3                           |

**Historical docs deliberately NOT touched** (the references they carry
are accurate descriptions of past state):

- `CHANGELOG.md`, `CHANGELOG.zh-CN.md` — Stage 2 entry mentions `BindContext` /
  `BindError` as part of what shipped at that time. Editing it rewrites
  history.
- `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` —
  scope-expansion ADR; its references to `BindContext.pid` describe Stage
  2's deviation from the spec, not the current code state.
- `docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md` — Stage 2
  implementation plan; its task lists describe what was implemented at
  that time. The plan-side "Resolved by 2026-05-05" pointer (if any) goes
  in the new ADR or in this spec's Section 5.2, not by editing the plan.

**Frontend (TypeScript):** none. This refactor is backend-only with no IPC
shape changes.

**Tests touched:** all enumerated under Section 4 (deleted, adapted,
added). No new fixture files. No new helper crates.

### 6.3 PR-scope discipline

This refactor is exactly one of the two cases the [PR-scope rule][pr155]
admits as in-scope: the spec / plan / issue says to do it. The diff
answers "what does issue #156 say to do?":

- The 7 modified Rust files all implement Sections 2–4 of this spec.
- The 1 added Rust file (`codex/types.rs`) is named in Section 3.1.
- The 1 added doc file (the new ADR) is named in Section 5.1 and is
  required by issue #156's acceptance criteria.
- The 2 modified doc files are the standard amendment shape from the
  2026-05-04 ADR pattern.

Out of scope, explicitly listed here so the PR review can rule them out at
a glance:

- No `cargo fmt` reflows on unrelated files. If the formatter touches
  files outside the touch list above, those edits go in a separate
  `chore(fmt):` precursor commit on `main`, not this PR.
- No drive-by comment polish in `agent/adapter/` or anywhere else. The
  rationale comment in `start_agent_watcher` (Section 2.5) is the one
  comment edit this PR does include — it's a forced consequence of
  moving the retry, not a drive-by.
- No new dependencies. `tempfile`, `dirs`, `rusqlite` are all already
  pulled by the existing `codex/` module.
- No additional refactors that "feel related" — e.g. promoting
  `LocatorError::Fatal`'s shape to `thiserror`, or unifying the
  `Result<_, String>` pattern across the adapter trait. Track those as
  separate follow-up issues if desired.

The pre-PR checklist from PR #155's `pr-scope.md` (sections 1–4) applies
literally:

1. Re-read this spec's Goal section. Walk the diff. Each file's diff
   should map to one of the sections above.
2. `git diff --stat <base>..HEAD`. Files appearing here that aren't in the
   File touch list above need an explicit answer.
3. `git diff -w <base>..HEAD --stat` alongside `git diff --stat`.
   Whitespace-stripped delta should match the regular delta closely; any
   gap is a formatting drive-by to drop.
4. Drive-by formatting → separate commit / PR.
