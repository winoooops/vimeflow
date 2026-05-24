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

use std::sync::Arc;

use super::claude_code::ClaudeCodeAdapter;
use super::codex::{CodexAdapter, CompositeLocator};
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
    /// concrete adapter + locator. Returns an `AttachError` for any
    /// pre-flight failure observable at this layer; today's
    /// implementation only surfaces `LocatorFatal` for Codex with a
    /// missing `provider_home`, but the enum's variant set is
    /// forward-looking per #246 acceptance.
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
                // `pty_start`. Pull them from the attach context;
                // `provider_home` is `Some(~/.codex)` for the Codex
                // variant per the central config registry. If it
                // isn't (config drift, custom build), surface a
                // typed `LocatorFatal` rather than silently
                // defaulting.
                let codex_home = ctx.provider_home.clone().ok_or_else(|| {
                    AttachError::LocatorFatal(
                        "Codex AttachContext has no provider_home".to_string(),
                    )
                })?;
                let locator: Arc<CompositeLocator> = Arc::new(CompositeLocator::new(
                    codex_home,
                    ctx.agent_pid,
                    ctx.pty_start,
                ));
                let adapter: Arc<CodexAdapter> =
                    Arc::new(CodexAdapter::new(ctx.agent_pid, ctx.pty_start));
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

    /// Codex `for_attach` requires `provider_home`. Pin the typed
    /// error so a future config-registry drift doesn't silently fall
    /// back to a default path.
    #[test]
    fn for_attach_codex_without_provider_home_errors_locator_fatal() {
        let result = AgentBindings::for_attach(&codex_ctx(None));
        let err = match result {
            Ok(_) => panic!("codex without provider_home should LocatorFatal, got Ok"),
            Err(e) => e,
        };
        assert!(
            matches!(err, AttachError::LocatorFatal(_)),
            "expected LocatorFatal, got: {:?}",
            err,
        );
    }
}
