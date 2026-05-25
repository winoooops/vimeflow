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
//! - `bindings.streamer` — spawn the tail thread. Step B'' wired this
//!   directly into `TranscriptState::start_or_replace`
//!   (`Arc<dyn TranscriptStreamer>`), removing the former transitional
//!   `adapter_for_transcript_state: Arc<dyn AgentAdapter>` field that
//!   B' carried only because `start_or_replace` still took the façade.

use std::path::PathBuf;
use std::sync::Arc;

use super::claude_code::ClaudeCodeAdapter;
use super::codex::{default_codex_home, CodexAdapter, CompositeLocator};
use super::error::AttachError;
use super::traits::{
    StateDecoder, StatusSourceLocator, TranscriptPathValidator, TranscriptStreamer,
};
use super::types::TranscriptPathSource;
use super::{AttachContext, ClaudeStatusFileLocator, NoOpAdapter};
use crate::agent::types::AgentType;

/// One session's typed adapter views, assembled from the
/// [`AttachContext`] by [`AgentBindings::for_attach`].
///
/// `agent_type` carries `#[allow(dead_code)]` — it's for diagnostics
/// / future telemetry and the watcher doesn't branch on it. Every
/// other field has a production consumer: `locator` (in `start_for`),
/// `decoder` / `transcript_paths` / `validator` (in the watcher
/// callbacks), and `streamer` (in `TranscriptState::start_or_replace`,
/// wired in step B''). The transitional `adapter_for_transcript_state:
/// Arc<dyn AgentAdapter>` field was removed in B'' — `start_or_replace`
/// now takes `Arc<dyn TranscriptStreamer>`, so the façade `Arc` is no
/// longer needed.
pub(crate) struct AgentBindings {
    #[allow(dead_code)]
    pub(crate) agent_type: AgentType,
    pub(crate) locator: Arc<dyn StatusSourceLocator>,
    pub(crate) decoder: Arc<dyn StateDecoder>,
    pub(crate) transcript_paths: Arc<dyn TranscriptPathSource>,
    pub(crate) validator: Arc<dyn TranscriptPathValidator>,
    pub(crate) streamer: Arc<dyn TranscriptStreamer>,
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
                    streamer: adapter,
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
                // The locator is built ONCE here and shared via `Arc`
                // between `bindings.locator` (the outer
                // `Arc<dyn StatusSourceLocator>`) and `bindings.streamer`
                // (the `Arc<CodexAdapter>` whose internal locator field
                // is `Arc<CompositeLocator>`, NOT an owned one).
                // Pre-cycle-11 the two paths each built an independent
                // `CompositeLocator` from the same parameters — a
                // latent double-retry hazard if `<CodexAdapter as
                // AgentAdapter>::located_status_source` (the
                // transitional façade) was ever called downstream. The
                // structural fix (PR #261 cycle 11 F31) shares one
                // `CompositeLocator`; B'' (this step) then consumes the
                // streamer view directly in `start_or_replace`.
                let codex_home = ctx
                    .provider_home
                    .clone()
                    .unwrap_or_else(default_codex_home);
                // `ctx.proc_root` carries `Some("/proc")` on Linux,
                // `None` on non-Linux, and `Some(tempdir)` in test
                // harnesses that inject a fake `/proc`. The shared
                // `Arc<CompositeLocator>` now means the proc-root
                // value flows through to BOTH consumer paths through
                // ONE construction site (PR #261 cycle 8 F22).
                let proc_root = ctx
                    .proc_root
                    .clone()
                    .unwrap_or_else(|| PathBuf::from("/proc"));
                // Attach-once observability for production Codex
                // sessions (PR #261 cycle 3 F11 + cycle 4 F13). The
                // log site stays here at the binding boundary so it
                // fires exactly once per attach, regardless of how
                // many consumers hold the shared `Arc<CompositeLocator>`.
                log::info!(
                    "codex adapter: locator initialized (codex_home={}, pid={})",
                    codex_home.display(),
                    ctx.agent_pid,
                );
                let composite_locator: Arc<CompositeLocator> = Arc::new(CompositeLocator::new(
                    codex_home,
                    ctx.agent_pid,
                    ctx.pty_start,
                    proc_root,
                ));
                let locator: Arc<dyn StatusSourceLocator> = composite_locator.clone();
                let adapter: Arc<CodexAdapter> =
                    Arc::new(CodexAdapter::with_locator(composite_locator));
                Ok(Self {
                    agent_type: ctx.agent_type,
                    locator,
                    decoder: adapter.clone(),
                    transcript_paths: adapter.clone(),
                    validator: adapter.clone(),
                    streamer: adapter,
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
                    streamer: adapter,
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

    // NOTE: the B' shared-`Arc` regression test
    // (`for_attach_codex_shares_arc_between_streamer_and_facade`, cycle 14
    // F39) was removed in B''. It pinned that `bindings.streamer` and the
    // now-deleted `bindings.adapter_for_transcript_state` were clones of
    // the same `Arc<CodexAdapter>`. With the façade field gone, the
    // cycle-11 F31 invariant ("one `CompositeLocator` per Codex attach,
    // shared between the outer locator and the adapter's internal locator")
    // is pinned at its source instead — see
    // `codex::mod::tests::with_locator_shares_passed_locator_allocation`,
    // which asserts `CodexAdapter::with_locator` stores the exact `Arc`
    // it was handed rather than rebuilding one.

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
    ///   fired AND that `CompositeLocator::new` +
    ///   `CodexAdapter::with_locator` accept the resulting `PathBuf`
    ///   without panicking.
    /// - **Dispatch hits the Codex arm**: the `agent_type` round-trip
    ///   confirms the test exercised the `AgentType::Codex` branch
    ///   (a regression that dropped through to `NoOpAdapter` would
    ///   fail this assertion).
    ///
    /// **NOT pinned here**: that `bindings.locator` and
    /// `bindings.streamer`'s internal locator reference the SAME
    /// `Arc<CompositeLocator>` instance (cycle 11 F31). That
    /// single-allocation invariant is pinned at its source in
    /// `codex::adapter_tests::with_locator_shares_passed_locator_allocation`,
    /// which doesn't need the test-only downcast / SQLite-fixture
    /// machinery this bindings-level test would.
    #[test]
    fn for_attach_codex_without_provider_home_falls_back_to_default_home() {
        let bindings =
            AgentBindings::for_attach(&codex_ctx(None)).expect("codex falls back to default home");
        assert_eq!(bindings.agent_type, AgentType::Codex);
    }
}
