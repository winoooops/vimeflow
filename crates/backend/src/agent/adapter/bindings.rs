//! `AgentBindings` — the typed bundle of one session's split-trait
//! views.
//!
//! Step B' of the v4-frozen refactor plan (#246). Replaces the
//! pre-B' practice of constructing an `Arc<dyn AgentAdapter>` and
//! plumbing it through `start_for` / `watcher_runtime`. Production
//! callers now receive `AgentBindings` from
//! [`AgentBindings::for_attach`] and read the trait surface they
//! need:
//!
//! - `bindings.locator` — where the statusline file is.
//! - `bindings.decoder` — raw JSON → status snapshot.
//! - `bindings.transcript_paths` — dynamic / static transcript hints.
//! - `bindings.validator` — raw path → canonical path (security
//!   check).
//! - `bindings.streamer` — spawn the tail thread.
//!
//! Plus one transitional field:
//!
//! - `bindings.adapter_for_transcript_state` — the `Arc<dyn AgentAdapter>`
//!   that `TranscriptState::start_or_replace` STILL takes in B'.
//!   B'' migrates that signature onto `Arc<dyn TranscriptStreamer>`
//!   directly; until then bindings carry both views of the same
//!   underlying adapter struct so the two paths agree.

use std::path::PathBuf;
use std::sync::Arc;

use super::claude_code::ClaudeCodeAdapter;
use super::codex::{default_codex_home, CodexAdapter, CompositeLocator};
use super::error::AttachError;
use super::traits::{
    StateDecoder, StatusSourceLocator, TranscriptPathValidator, TranscriptStreamer,
};
use super::types::TranscriptPathSource;
use super::{AgentAdapter, AttachContext, ClaudeStatusFileLocator, NoOpAdapter};
use crate::agent::types::AgentType;

/// One session's typed adapter views, assembled from the
/// [`AttachContext`] by [`AgentBindings::for_attach`].
///
/// `agent_type` and `streamer` carry `#[allow(dead_code)]` for the
/// duration of B': `agent_type` is for diagnostics / future
/// telemetry, and `streamer` is the next-step migration target
/// (B'' rewires `TranscriptState::start_or_replace` from
/// `Arc<dyn AgentAdapter>` onto `Arc<dyn TranscriptStreamer>`).
/// The bindings test in this module reads `agent_type` so the
/// `#[allow]` only suppresses the production-build warning.
pub(crate) struct AgentBindings {
    #[allow(dead_code)]
    pub(crate) agent_type: AgentType,
    pub(crate) locator: Arc<dyn StatusSourceLocator>,
    pub(crate) decoder: Arc<dyn StateDecoder>,
    pub(crate) transcript_paths: Arc<dyn TranscriptPathSource>,
    pub(crate) validator: Arc<dyn TranscriptPathValidator>,
    #[allow(dead_code)]
    pub(crate) streamer: Arc<dyn TranscriptStreamer>,
    /// Transitional: B'' migrates `TranscriptState::start_or_replace`
    /// to take `Arc<dyn TranscriptStreamer>` directly; until then
    /// the runtime hands it `Arc<dyn AgentAdapter>` carried here.
    /// Removable post-B''.
    pub(crate) adapter_for_transcript_state: Arc<dyn AgentAdapter>,
}

impl AgentBindings {
    /// Build a session's bindings from the attach context.
    ///
    /// Dispatches by `ctx.agent_type` and wires each variant to the
    /// concrete adapter + locator. The return type is
    /// `Result<Self, AttachError>` for forward-compatibility with the
    /// D' service boundary, but today's implementation is
    /// infallible — Codex with `provider_home == None` falls back to
    /// `default_codex_home()` rather than failing (PR #261 codex
    /// review F3). The `AttachError` variants are reserved per #246
    /// acceptance for failure modes that become observable when D'
    /// retypes the locator/validator path.
    pub(crate) fn for_attach(ctx: &AttachContext) -> Result<Self, AttachError> {
        match ctx.agent_type {
            AgentType::ClaudeCode => {
                let adapter: Arc<ClaudeCodeAdapter> = Arc::new(ClaudeCodeAdapter);
                Ok(Self {
                    agent_type: ctx.agent_type,
                    locator: Arc::new(ClaudeStatusFileLocator),
                    decoder: adapter.clone(),
                    transcript_paths: adapter.clone(),
                    validator: adapter.clone(),
                    streamer: adapter.clone(),
                    adapter_for_transcript_state: adapter,
                })
            }
            AgentType::Codex => {
                // Codex's locator needs `codex_home` + `pid` +
                // `pty_start`. `ctx.provider_home` carries the typed
                // value from the central config registry when
                // `dirs::home_dir()` resolved successfully; in headless
                // / service sessions where it didn't, fall back to
                // `default_codex_home()` (relative `.codex`) so attach
                // still works — matching the pre-B' behavior of
                // `CodexAdapter::new` (PR #261 codex review F3).
                //
                // The same `codex_home` value is then passed into BOTH
                // the outer `CompositeLocator` AND the adapter's
                // internal locator via `CodexAdapter::with_home`. The
                // earlier `CodexAdapter::new` re-derived its own home
                // from `default_codex_home()`, which could diverge from
                // `ctx.provider_home` whenever a test (or future caller)
                // supplied a non-default value (PR #261 Claude review F1).
                let codex_home = ctx
                    .provider_home
                    .clone()
                    .unwrap_or_else(default_codex_home);
                // `ctx.proc_root` carries `Some("/proc")` on Linux,
                // `None` on non-Linux, and `Some(tempdir)` in test
                // harnesses that inject a fake `/proc`. Both the outer
                // and adapter-internal `CompositeLocator` need the same
                // value so test fakes flow through to the locator's
                // `proc` fast-paths (PR #261 cycle 8 F22 — was
                // dead-letter pre-fix because `CompositeLocator::new`
                // hardcoded `/proc`). The `unwrap_or_else` fallback
                // matches the previous hardcoded default for
                // non-Linux callers that don't supply `proc_root`.
                let proc_root = ctx
                    .proc_root
                    .clone()
                    .unwrap_or_else(|| PathBuf::from("/proc"));
                // Attach-once observability for production Codex
                // sessions (PR #261 cycle 3 F11 + cycle 4 F13). Logging
                // inside `CompositeLocator::new` would double-emit
                // because this arm constructs two locators per attach
                // (outer + adapter-internal); logging in `CodexAdapter::new`
                // would miss the `for_attach` → `with_home` path entirely.
                // One log here covers every production attach exactly once.
                log::info!(
                    "codex adapter: locator initialized (codex_home={}, pid={})",
                    codex_home.display(),
                    ctx.agent_pid,
                );
                let locator: Arc<CompositeLocator> = Arc::new(CompositeLocator::new(
                    codex_home.clone(),
                    ctx.agent_pid,
                    ctx.pty_start,
                    proc_root.clone(),
                ));
                let adapter: Arc<CodexAdapter> = Arc::new(CodexAdapter::with_home(
                    ctx.agent_pid,
                    ctx.pty_start,
                    codex_home,
                    proc_root,
                ));
                Ok(Self {
                    agent_type: ctx.agent_type,
                    locator,
                    decoder: adapter.clone(),
                    transcript_paths: adapter.clone(),
                    validator: adapter.clone(),
                    streamer: adapter.clone(),
                    adapter_for_transcript_state: adapter,
                })
            }
            other => {
                // NoOp adapter for Aider / Generic — covers every
                // non-Claude / non-Codex variant. `UnsupportedAgent`
                // is reserved per the acceptance enum for a future
                // refusal mode; today's behavior matches the
                // pre-B' `<dyn AgentAdapter>::for_attach` (always
                // returns Ok with a NoOp wrapper).
                let adapter: Arc<NoOpAdapter> = Arc::new(NoOpAdapter::new(other));
                Ok(Self {
                    agent_type: other,
                    locator: adapter.clone(),
                    decoder: adapter.clone(),
                    transcript_paths: adapter.clone(),
                    validator: adapter.clone(),
                    streamer: adapter.clone(),
                    adapter_for_transcript_state: adapter,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::adapter::types::LocatedStatusSource;
    use std::path::PathBuf;
    use std::time::SystemTime;

    fn claude_ctx() -> AttachContext {
        AttachContext {
            session_id: "sid".to_string(),
            initial_cwd: PathBuf::from("/tmp/ws"),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            provider_home: Some(PathBuf::from("/home/u/.claude")),
            proc_root: None,
        }
    }

    fn codex_ctx(home: Option<PathBuf>) -> AttachContext {
        AttachContext {
            session_id: "sid".to_string(),
            initial_cwd: PathBuf::from("/tmp/ws"),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::Codex,
            provider_home: home,
            proc_root: None,
        }
    }

    fn aider_ctx() -> AttachContext {
        AttachContext {
            session_id: "sid".to_string(),
            initial_cwd: PathBuf::from("/tmp/ws"),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::Aider,
            provider_home: None,
            proc_root: None,
        }
    }

    /// for_attach dispatches by `ctx.agent_type` — three variants,
    /// three branches. The `agent_type` field on the returned
    /// bindings round-trips, proving the dispatch hit the right arm.
    #[test]
    fn for_attach_dispatches_by_agent_type() {
        let claude = AgentBindings::for_attach(&claude_ctx()).expect("claude binds");
        assert_eq!(claude.agent_type, AgentType::ClaudeCode);

        let codex = AgentBindings::for_attach(&codex_ctx(Some(PathBuf::from("/home/u/.codex"))))
            .expect("codex binds");
        assert_eq!(codex.agent_type, AgentType::Codex);

        let noop = AgentBindings::for_attach(&aider_ctx()).expect("noop binds aider");
        assert_eq!(noop.agent_type, AgentType::Aider);
    }

    /// Claude's locator is the stateless `ClaudeStatusFileLocator` —
    /// `locate(cwd, sid)` should return the same path shape the
    /// pre-B' `ClaudeCodeAdapter::located_status_source` did, with
    /// `static_transcript_hint == None`.
    #[test]
    fn for_attach_claude_locator_returns_static_path() {
        let ctx = claude_ctx();
        let bindings = AgentBindings::for_attach(&ctx).expect("claude binds");
        let cwd = PathBuf::from("/tmp/ws");
        let located: LocatedStatusSource = bindings
            .locator
            .locate(&cwd, "sess-1")
            .expect("locator infallible for claude");
        assert_eq!(
            located.status_path,
            cwd.join(".vimeflow")
                .join("sessions")
                .join("sess-1")
                .join("status.json"),
        );
        assert_eq!(located.trust_root, cwd);
        assert_eq!(located.static_transcript_hint, None);
    }

    /// Codex `for_attach` with `provider_home == None` falls back to
    /// `default_codex_home()` rather than failing. Pin the behavior so
    /// headless / service sessions (where `dirs::home_dir()` returns
    /// `None`) keep attaching, matching the pre-B' path through
    /// `CodexAdapter::new` (PR #261 codex review F3).
    ///
    /// Coverage scope:
    /// - **No panic / no Err**: the successful `expect(...)` proves
    ///   both that the `unwrap_or_else(default_codex_home)` fallback
    ///   fired AND that both `CompositeLocator::new` and
    ///   `CodexAdapter::with_home` accept the resulting `PathBuf`
    ///   without panicking.
    /// - **Dispatch hits the Codex arm**: the `agent_type` round-trip
    ///   confirms the test exercised the `AgentType::Codex` branch
    ///   (a regression that dropped through to `NoOpAdapter` would
    ///   fail this assertion).
    ///
    /// **NOT pinned here**: that `default_codex_home()` reached BOTH
    /// the outer `Arc<CompositeLocator>` AND
    /// `CodexAdapter::with_home`'s internal locator (PR #261 cycle 10
    /// review F30). The same `codex_home` binding is reused via
    /// `clone()` between the two construction sites — a structural
    /// guarantee at the source level, not directly observable through
    /// the public `Arc<dyn StatusSourceLocator>` surface. Verifying it
    /// in a unit test would require either (a) downcasting the
    /// `Arc<dyn ...>`, (b) adding a `#[cfg(test)]` `codex_home()`
    /// accessor on `CompositeLocator`, or (c) a locator fixture with a
    /// seeded SQLite DB so `locate(...)` returns `Ok` with an
    /// observable `trust_root`. None of those are worth the test-only
    /// API surface; the cycle-1 F1 fix that introduced the shared
    /// binding lives in the `for_attach` body at lines 138-153 and
    /// is self-evident at code-review time.
    #[test]
    fn for_attach_codex_without_provider_home_falls_back_to_default_home() {
        let bindings =
            AgentBindings::for_attach(&codex_ctx(None)).expect("codex falls back to default home");
        assert_eq!(bindings.agent_type, AgentType::Codex);
    }
}
