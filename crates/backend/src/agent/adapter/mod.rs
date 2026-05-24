//! Agent adapter abstraction.
//!
//! The trait carries provider hooks only. User-facing lifecycle methods live
//! on `dyn AgentAdapter`, and the watcher orchestration body lives in
//! `base::start_for`.

mod attach;
pub mod base;
mod bindings;
pub mod claude_code;
pub mod codex;
mod error;
mod serde_helpers;
mod traits;
pub mod types;

pub(crate) use attach::AttachContext;
// `SessionRuntimeContext` (also in `attach`) is not re-exported yet —
// step 0b only defines the type; the first production caller lands in
// step B'' when `TranscriptState::start_or_replace` rewires onto it.
// Tests reach it directly as `attach::SessionRuntimeContext`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(test)]
use std::time::SystemTime;

pub use base::AgentWatcherState;

use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;
use crate::terminal::types::SessionId;
use crate::terminal::PtyState;
use base::{TranscriptHandle, TranscriptState};
#[cfg(test)]
use codex::CodexAdapter;
use types::{LocatedStatusSource, ParsedStatus, TranscriptPathSource, ValidateTranscriptError};

/// Provider hooks for one CLI coding agent.
pub trait AgentAdapter: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;

    /// Return the statusline location + attach-time transcript hint.
    ///
    /// Step 0c rename of the former `status_source`; the return type is
    /// now [`LocatedStatusSource`] so attach-time transcript paths
    /// (Codex's rollout path) reach the runtime through a typed field
    /// instead of an adapter-private side channel.
    fn located_status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String>;

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;

    fn tail_transcript(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;

    // Step B' (round 1 codex review fix): the
    // `transcript_path_source` accessor was removed. The watcher
    // reaches the trait via `AgentBindings.transcript_paths`
    // instead (an `Arc<dyn TranscriptPathSource>` constructed by
    // `for_attach`), and `TranscriptPathSource` itself narrowed to
    // `pub(crate)` to match the visibility of the other 4 split
    // traits per frozen constraint #3.
}

impl dyn AgentAdapter {
    // Step B': `for_attach` and `start` lifecycle methods were
    // removed alongside the watcher migration to `AgentBindings`.
    // `start_agent_watcher_inner` now calls
    // `AgentBindings::for_attach(&attach)` and `base::start_for(bindings, ...)`
    // directly. `stop` stays — it's a pure lookup on
    // `AgentWatcherState` and has no adapter-shape dependency.
    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
    }
}

/// Stateless `StatusSourceLocator` for Claude Code.
///
/// Step B' (#246): per frozen constraint #1, this type is
/// **trivial and stateless** — no `dirs::home_dir()` lookups inside,
/// no held fields, and `static_transcript_hint` is always `None`
/// because Claude's transcript path is purely dynamic (arrives via
/// the statusline JSON on every update).
///
/// Kept as a separate unit struct because `bindings.rs` constructs
/// it directly (as `Arc<ClaudeStatusFileLocator>`), independent of
/// the adapter. Both this impl and `ClaudeCodeAdapter`'s
/// `StatusSourceLocator::locate` impl now route through
/// `claude_code::claude_status_path` so a future Claude session-path
/// schema change is a single-site edit (PR #261 cycle 3 review F10
/// — both impls were previously byte-for-byte duplicates).
pub(crate) struct ClaudeStatusFileLocator;

impl traits::StatusSourceLocator for ClaudeStatusFileLocator {
    fn locate(&self, cwd: &Path, session_id: &str) -> Result<LocatedStatusSource, String> {
        Ok(claude_code::claude_status_path(cwd, session_id))
    }
}

/// Fallback adapter for agents whose real adapter has not shipped yet.
pub(crate) struct NoOpAdapter {
    agent_type: AgentType,
}

impl NoOpAdapter {
    pub(crate) fn new(agent_type: AgentType) -> Self {
        Self { agent_type }
    }
}

impl TranscriptPathSource for NoOpAdapter {}

// ---------------- Step B' trait splits ----------------

impl traits::StatusSourceLocator for NoOpAdapter {
    fn locate(&self, cwd: &Path, session_id: &str) -> Result<LocatedStatusSource, String> {
        // Same shape as ClaudeStatusFileLocator — gives the no-op
        // adapter a plausible status path under cwd. The watcher
        // never actually reads it because NoOp's decoder/streamer
        // Errs out below.
        Ok(LocatedStatusSource {
            status_path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
            static_transcript_hint: None,
        })
    }
}

impl traits::StateDecoder for NoOpAdapter {
    fn decode(
        &self,
        _session_id: Option<&str>,
        _raw: &str,
    ) -> Result<crate::agent::adapter::types::StatusSnapshot, String> {
        Err(format!(
            "{:?} adapter has no status decoder",
            self.agent_type
        ))
    }
}

impl traits::TranscriptPathValidator for NoOpAdapter {
    fn validate(&self, _raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        Err(ValidateTranscriptError::Other(format!(
            "{:?} adapter has no transcript validator",
            self.agent_type
        )))
    }
}

impl traits::TranscriptStreamer for NoOpAdapter {
    fn tail(
        &self,
        _events: Arc<dyn EventSink>,
        _session_id: String,
        _cwd: Option<PathBuf>,
        _transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        Err(format!(
            "{:?} adapter has no transcript tailer",
            self.agent_type
        ))
    }
}

impl AgentAdapter for NoOpAdapter {
    fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    fn located_status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String> {
        <Self as traits::StatusSourceLocator>::locate(self, cwd, session_id)
    }

    fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
        // Wording mirrors `StateDecoder::decode`'s error string so
        // log-based diagnostics see one consistent phrase across the
        // façade and the split trait (PR #261 cycle 2, F6 — B' renamed
        // the concept "parse → decode"; the façade's error string
        // lagged).
        Err(format!(
            "{:?} adapter has no status decoder",
            self.agent_type
        ))
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        <Self as traits::TranscriptPathValidator>::validate(self, raw)
    }

    fn tail_transcript(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        <Self as traits::TranscriptStreamer>::tail(self, events, session_id, cwd, transcript_path)
    }
}

/// Start watching an agent status source for a PTY session.
pub(crate) async fn start_agent_watcher_inner(
    pty_state: PtyState,
    watcher_state: AgentWatcherState,
    transcript_state: TranscriptState,
    events: Arc<dyn EventSink>,
    session_id: String,
) -> Result<(), String> {
    let attach = resolve_bind_inputs(&pty_state, &session_id, detect_agent)?;

    // Step B': build the typed bindings (5 split-trait views) from
    // the attach context. `AttachError` → `String` mapping happens
    // at this seam — the watcher / `start_for` layer below speaks
    // `String` errors, so we collapse the typed error here. The
    // mapping point becomes the future D' `AgentWatcherService`
    // boundary too.
    let bindings = bindings::AgentBindings::for_attach(&attach)
        .map_err(|e| format!("agent bindings: {}", e))?;
    let cwd_path = attach.initial_cwd.clone();

    // `base::start_for(bindings, ...)` calls `bindings.locator.locate(...)`.
    // For codex sessions, the locator runs a bounded retry (5 × 100 ms
    // inter-attempt sleeps) inside its `StatusSourceLocator::locate`
    // impl — codex commits its `logs` row ~300 ms after the rollout
    // file opens.
    // `path_security::ensure_status_source_under_trust_root` does
    // synchronous `canonicalize` filesystem I/O. Running either on a
    // tokio worker thread starves other futures scheduled on the same
    // worker; mirror the pattern at `src/git/watcher.rs:399` and hop
    // onto the blocking pool so the async thread returns immediately.
    tokio::task::spawn_blocking(move || {
        base::start_for(
            bindings,
            events,
            pty_state,
            transcript_state,
            session_id,
            cwd_path,
            watcher_state,
        )
    })
    .await
    .map_err(|e| format!("start_agent_watcher task panicked: {}", e))?
}

fn resolve_bind_inputs<F>(
    pty_state: &PtyState,
    session_id: &SessionId,
    detect: F,
) -> Result<AttachContext, String>
where
    F: FnOnce(u32) -> Option<(AgentType, u32)>,
{
    let cwd = pty_state
        .get_cwd(session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let shell_pid = pty_state
        .get_pid(session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let pty_start = pty_state
        .get_started_at(session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let (agent_type, agent_pid) = detect(shell_pid)
        .ok_or_else(|| format!("no agent detected in PTY session {}", session_id))?;

    // All per-agent metadata flows through the central registry —
    // adding a new agent only touches `crate::agent::config`, not this
    // populator. Per v4-frozen Step 0a (expanded per PR #247 review).
    let spec = crate::agent::config::spec_for(agent_type);

    Ok(AttachContext {
        session_id: session_id.clone(),
        initial_cwd: PathBuf::from(cwd),
        shell_pid,
        agent_pid,
        pty_start,
        agent_type,
        provider_home: spec.provider_home(),
        proc_root: crate::agent::config::default_proc_root(),
    })
}

/// Stop watching an agent status source.
pub(crate) async fn stop_agent_watcher_inner(
    state: &AgentWatcherState,
    session_id: String,
) -> Result<(), String> {
    if <dyn AgentAdapter>::stop(state, &session_id) {
        log::info!("Stopped watching statusline for session {}", session_id);
        Ok(())
    } else {
        Err(format!("No active watcher for session: {}", session_id))
    }
}

#[cfg(test)]
mod noop_tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    #[test]
    fn agent_type_round_trips() {
        let adapter = NoOpAdapter::new(AgentType::Codex);
        assert!(matches!(
            <NoOpAdapter as AgentAdapter>::agent_type(&adapter),
            AgentType::Codex
        ));
    }

    #[test]
    fn located_status_source_uses_claude_shaped_path() {
        let adapter = NoOpAdapter::new(AgentType::Aider);
        let cwd = PathBuf::from("/tmp/ws");
        let src = <NoOpAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sid")
            .expect("noop adapter always resolves a status source");
        assert_eq!(
            src.status_path,
            cwd.join(".vimeflow")
                .join("sessions")
                .join("sid")
                .join("status.json")
        );
        assert_eq!(src.trust_root, cwd);
        // NoOp adapters never know a static transcript path — Step 0c
        // contract: only Codex's locator returns Some.
        assert_eq!(src.static_transcript_hint, None);
    }

    /// Step 0c: NoOpAdapter's `TranscriptPathSource` impl uses the
    /// trait's default `None` for both methods. Pins the contract so a
    /// future contributor doesn't accidentally override one of them
    /// (which would change behavior for every "not yet implemented"
    /// agent — Aider, Generic).
    #[test]
    fn noop_transcript_path_source_returns_none_for_both_hints() {
        let adapter = NoOpAdapter::new(AgentType::Aider);
        // Step B' (round 1 codex fix): the former
        // `AgentAdapter::transcript_path_source` accessor was
        // removed; reach the trait via a `&dyn TranscriptPathSource`
        // coercion of the adapter.
        let tps: &dyn TranscriptPathSource = &adapter;
        let located = LocatedStatusSource {
            status_path: PathBuf::from("/tmp/status.json"),
            trust_root: PathBuf::from("/tmp"),
            static_transcript_hint: Some("/tmp/ignored.jsonl".to_string()),
        };
        assert_eq!(tps.static_hint(&located), None);
        assert_eq!(tps.dynamic_hint(r#"{"transcript_path":"/tmp/x"}"#), None);
    }

    #[test]
    fn parse_status_returns_err() {
        let adapter = NoOpAdapter::new(AgentType::Generic);
        assert!(<NoOpAdapter as AgentAdapter>::parse_status(&adapter, "sid", "{}").is_err());
    }

    /// Step B': replaces the former
    /// `for_attach_returns_real_codex_adapter` test that exercised
    /// the removed `<dyn AgentAdapter>::for_attach` lifecycle method.
    /// The equivalent path now goes through
    /// `AgentBindings::for_attach(&AttachContext)`, with the codex
    /// `parse_status` reachable via the bundled adapter façade.
    /// Pinned more thoroughly by `for_attach_dispatches_by_agent_type`
    /// in `bindings::tests`; this stays here as the codex-specific
    /// roundtrip through the façade.
    #[test]
    fn for_attach_returns_real_codex_adapter() {
        let adapter = std::sync::Arc::new(CodexAdapter::new(12345, SystemTime::UNIX_EPOCH));
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;
        let parsed = <CodexAdapter as AgentAdapter>::parse_status(&adapter, "pty-codex", raw)
            .expect("real codex adapter should parse rollout JSONL");
        assert_eq!(parsed.event.agent_session_id, "sess");
    }

    fn make_test_session() -> crate::terminal::state::ManagedSession {
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let child = pty_pair
            .slave
            .spawn_command(CommandBuilder::new("/bin/true"))
            .expect("spawn");
        let writer = pty_pair.master.take_writer().expect("take_writer");

        crate::terminal::state::ManagedSession {
            master: pty_pair.master,
            writer,
            child,
            cwd: "/tmp/workspace".into(),
            generation: 0,
            ring: Arc::new(Mutex::new(crate::terminal::state::RingBuffer::new(64))),
            cancelled: Arc::new(AtomicBool::new(false)),
            started_at: std::time::SystemTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn resolve_bind_inputs_uses_detected_agent_pid_not_shell_pid() {
        let state = PtyState::new();
        let session_id = "sid".to_string();
        state
            .try_insert(session_id.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let attach = resolve_bind_inputs(&state, &session_id, |_| Some((AgentType::Codex, 4242)))
            .expect("bind inputs");

        assert!(matches!(attach.agent_type, AgentType::Codex));
        assert_ne!(attach.shell_pid, attach.agent_pid);
        assert_eq!(attach.agent_pid, 4242);
    }

    #[test]
    fn resolve_bind_inputs_populates_attach_context_fields() {
        let state = PtyState::new();
        let session_id = "sid-populate".to_string();
        state
            .try_insert(session_id.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let attach = resolve_bind_inputs(&state, &session_id, |_| Some((AgentType::Codex, 4242)))
            .expect("bind inputs");

        // Identity / attach facts surfaced into the typed struct.
        assert_eq!(attach.session_id, "sid-populate");
        assert_eq!(attach.initial_cwd, PathBuf::from("/tmp/workspace"));
        assert_eq!(attach.pty_start, SystemTime::UNIX_EPOCH);
        assert_eq!(attach.agent_pid, 4242);
        assert_eq!(attach.agent_type, AgentType::Codex);

        // `provider_home` resolves from the central registry; for Codex
        // it ends with `.codex`. Structural assertion (not pinning the
        // full path) so the test doesn't depend on $HOME.
        let provider_home = attach
            .provider_home
            .expect("Codex spec defines a home subdir");
        assert!(provider_home.ends_with(".codex"));

        // `proc_root` is platform-dependent.
        if cfg!(target_os = "linux") {
            assert_eq!(attach.proc_root, Some(PathBuf::from("/proc")));
        } else {
            assert_eq!(attach.proc_root, None);
        }
    }

    #[test]
    fn resolve_bind_inputs_provider_home_none_for_agents_without_subdir() {
        let state = PtyState::new();
        let session_id = "sid-aider".to_string();
        state
            .try_insert(session_id.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let attach = resolve_bind_inputs(&state, &session_id, |_| Some((AgentType::Aider, 9999)))
            .expect("bind inputs");

        assert_eq!(attach.agent_type, AgentType::Aider);
        // Aider has no `home_subdir` in the registry → provider_home is None.
        assert_eq!(attach.provider_home, None);
    }

    /// Step 0b: `SessionRuntimeContext::live_cwd` returns the cwd the
    /// session was inserted with, surfaced as the `PathBuf` that the
    /// transcript-replace caller already consumes. Confirms the
    /// "session present → Some(cwd)" branch end-to-end with a real
    /// PTY-backed `ManagedSession` from `make_test_session`.
    #[test]
    fn session_runtime_context_live_cwd_reads_pty_state() {
        use super::attach::SessionRuntimeContext;

        let state = PtyState::new();
        let session_id = "sid-runtime-live".to_string();
        state
            .try_insert(session_id.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let runtime = SessionRuntimeContext::new(session_id.clone(), state);

        // `make_test_session` inserts cwd = "/tmp/workspace".
        assert_eq!(runtime.live_cwd(), Some(PathBuf::from("/tmp/workspace")));
        assert_eq!(runtime.session_id(), "sid-runtime-live");
    }

    /// Step 0b: cloning a `SessionRuntimeContext` MUST keep both
    /// handles attached to the SAME `Arc`-backed `PtyState`. A
    /// future contributor swapping the implicit `Clone` derive for
    /// a manual impl that clones into independent state would break
    /// the "live cwd through `SessionRuntimeContext`" guarantee and
    /// this test would catch it.
    ///
    /// Proof strategy: insert a session via a `PtyState` handle that
    /// is shared with the original runtime context, clone the
    /// runtime, then assert the clone reports the same cwd. Inserting
    /// AFTER the clone closes the loophole where two independent
    /// empty `PtyState`s could pass the smoke test in
    /// `attach::tests::session_runtime_context_is_clone`.
    #[test]
    fn session_runtime_context_clone_shares_pty_state() {
        use super::attach::SessionRuntimeContext;

        let state = PtyState::new();
        let session_id = "sid-runtime-shared".to_string();
        // `PtyState` is `Arc<Mutex<...>>`-backed; cloning before the
        // runtime takes ownership of one clone keeps the other handle
        // usable for the post-clone insert.
        let runtime = SessionRuntimeContext::new(session_id.clone(), state.clone());
        let cloned_runtime = runtime.clone();

        // Both handles look empty before any insert — the live
        // cross-clone visibility check is the one that follows.
        assert_eq!(runtime.live_cwd(), None);
        assert_eq!(cloned_runtime.live_cwd(), None);

        state
            .try_insert(session_id.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let expected = Some(PathBuf::from("/tmp/workspace"));
        assert_eq!(runtime.live_cwd(), expected);
        // The decisive assertion: a `Clone` impl that broke the
        // shared-`Arc` invariant would leave `cloned_runtime` reading
        // its own empty `PtyState` and this would return `None`.
        assert_eq!(cloned_runtime.live_cwd(), expected);
    }
}
