//! `SessionLifecycle` — the registry facade for agent-watcher
//! lifecycle.
//!
//! Step D' of the v4-frozen refactor plan (#246). Owns clones of the
//! four runtime collaborators (`PtyState`, `AgentWatcherState`,
//! `TranscriptState`, `Arc<dyn EventSink>`) and exposes the two
//! lifecycle verbs the IPC layer needs:
//!
//! - `start(session_id)` — resolve the [`AttachContext`] from live
//!   `PtyState`, build the typed [`AgentBindings`], and hand off to
//!   `base::start_for` on the blocking pool.
//! - `stop(session_id)` — remove the session's watcher from
//!   `AgentWatcherState` (its `Drop` cascades the transcript-tail
//!   teardown).
//!
//! **`AttachError` → `String` boundary.** Per #246's D' acceptance and
//! frozen constraint #4, the typed `AttachError` from
//! `AgentBindings::for_attach` is collapsed to `String` *here* — the
//! `base::start_for` layer and everything below it speaks `String`
//! errors. This is the single mapping seam; `start_agent_watcher_inner`
//! delegates to this method rather than mapping independently.

use std::path::Path;
use std::sync::Arc;

use super::bindings::AgentBindings;
use crate::agent::adapter::types::LocatedStatusSource;
use super::{base, resolve_bind_inputs, AttachContext};
use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;
use crate::terminal::types::SessionId;
use crate::terminal::PtyState;
use base::{AgentWatcherState, TranscriptState, WatcherHandle};

/// Registry facade owning clones of the four runtime collaborators.
///
/// Constructed per IPC call from `BackendState`'s long-lived
/// originals (all four are cheap `Arc`-backed clones). `stop` only
/// reads `watcher_state`, but the service carries all four so the
/// facade shape is uniform and a future eager-prevalidation `stop`
/// (or a `restart`) has the inputs it needs without a signature
/// change.
pub(crate) struct SessionLifecycle {
    pty_state: PtyState,
    watcher_state: AgentWatcherState,
    transcript_state: TranscriptState,
    events: Arc<dyn EventSink>,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::SystemTime;

    use super::{AgentBindings, AttachContext, SessionLifecycle};
    use crate::agent::adapter::base::{AgentWatcherState, TranscriptState, WatcherHandle};
    use crate::agent::adapter::make_test_session;
    use crate::agent::adapter::traits::StatusSourceLocator;
    use crate::agent::adapter::types::LocatedStatusSource;
    use crate::agent::types::AgentType;
    use crate::runtime::FakeEventSink;
    use crate::terminal::PtyState;
    use tempfile::TempDir;

    fn _assert_send_sync_static<T: Send + Sync + 'static>() {}

    #[test]
    fn t_lifecycle_4_agent_bindings_is_send_sync_static() {
        _assert_send_sync_static::<AgentBindings>();
    }

    #[test]
    fn t_verb_resolve_attach() {
        let pty_state = PtyState::new();
        let sid = "sid-verb-resolve".to_string();
        pty_state
            .try_insert(sid.clone(), make_test_session(), 64)
            .unwrap_or_else(|_| panic!("insert session"));

        let lifecycle = SessionLifecycle::new(
            pty_state,
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );

        let attach = lifecycle
            .resolve_attach(&sid, |_pid| Some((AgentType::Codex, 4242)))
            .expect("resolve_attach");

        // resolve_attach is a thin delegate to resolve_bind_inputs; this test
        // proves only the wiring — the right session plus the injected
        // detector's (agent_type, pid) flowing through. The exhaustive
        // field→value map is already pinned by
        // resolve_bind_inputs_populates_attach_context_fields, so re-asserting
        // every field here would just duplicate that coverage.
        assert_eq!(attach.session_id, sid);
        assert_eq!(attach.agent_type, AgentType::Codex);
        assert_eq!(attach.agent_pid, 4242);
    }

    #[test]
    fn t_verb_bind_services() {
        let ctx = AttachContext {
            session_id: "pty-codex".to_string(),
            initial_cwd: PathBuf::from("/tmp/ws"),
            shell_pid: 1,
            agent_pid: 12345,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::Codex,
            provider_home: Some(PathBuf::from("/home/u/.codex")),
            proc_root: None,
        };

        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );

        let bindings = lifecycle.bind_services(&ctx).expect("bind_services");
        assert!(matches!(bindings.agent_type, AgentType::Codex));
    }

    #[test]
    fn t_verb_locate_happy_path() {
        let tmp = TempDir::new().unwrap();
        let sid = "test-sess".to_string();
        let ctx = AttachContext {
            session_id: sid.clone(),
            initial_cwd: tmp.path().to_path_buf(),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            provider_home: Some(PathBuf::from("/home/u/.claude")),
            proc_root: None,
        };
        let bindings = AgentBindings::for_attach(&ctx).expect("for_attach");
        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        let located = lifecycle
            .locate(&bindings, tmp.path(), &sid)
            .expect("locate happy path");
        assert_eq!(
            located.status_path,
            tmp.path()
                .join(".vimeflow")
                .join("sessions")
                .join(&sid)
                .join("status.json")
        );
        assert_eq!(located.trust_root, tmp.path());
    }

    struct ErrLocator;

    impl StatusSourceLocator for ErrLocator {
        fn locate(
            &self,
            _cwd: &std::path::Path,
            _session_id: &str,
        ) -> Result<LocatedStatusSource, String> {
            Err("locate failed".to_string())
        }
    }

    #[test]
    fn t_verb_locate_err_forwarding() {
        let adapter: Arc<crate::agent::adapter::claude_code::ClaudeCodeAdapter> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let bindings = AgentBindings {
            agent_type: AgentType::ClaudeCode,
            locator: Arc::new(ErrLocator),
            decoder: adapter.clone(),
            transcript_paths: adapter.clone(),
            validator: adapter.clone(),
            streamer: adapter,
        };
        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        let result = lifecycle.locate(&bindings, std::path::Path::new("/tmp"), "sid");
        assert_eq!(result.unwrap_err(), "locate failed");
    }

    #[test]
    fn t_verb_ensure_trust() {
        let tmp = TempDir::new().unwrap();

        // Under trust root -> Ok
        let under = LocatedStatusSource {
            status_path: tmp
                .path()
                .join(".vimeflow")
                .join("sessions")
                .join("s")
                .join("status.json"),
            trust_root: tmp.path().to_path_buf(),
            static_transcript_hint: None,
        };
        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        lifecycle.ensure_trust(&under).expect("under trust root");

        // Outside trust root -> Err
        let outside = LocatedStatusSource {
            status_path: tmp.path().parent().unwrap().join("sibling.json"),
            trust_root: tmp.path().to_path_buf(),
            static_transcript_hint: None,
        };
        let result = lifecycle.ensure_trust(&outside);
        assert!(result.is_err(), "outside trust root should fail");
    }

    #[test]
    fn t_verb_evict_old() {
        let state = AgentWatcherState::new();
        let transcript_state = TranscriptState::new();
        let sid = "test-sid".to_string();
        let handle = WatcherHandle::new_for_test(transcript_state, sid.clone());
        state.insert(sid.clone(), handle);
        assert!(state.contains(&sid));

        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            state.clone(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        lifecycle.evict_old(&sid);
        assert!(!state.contains(&sid), "evict_old should remove the session");

        // Idempotent on empty/absent registry — must not panic
        lifecycle.evict_old("nonexistent");
    }

    #[test]
    fn t_verb_spawn_watch() {
        let tmp = TempDir::new().unwrap();
        let sid = "test-sess".to_string();
        let status_path = tmp
            .path()
            .join(".vimeflow")
            .join("sessions")
            .join(&sid)
            .join("status.json");
        std::fs::create_dir_all(status_path.parent().unwrap()).unwrap();
        std::fs::write(&status_path, r#"{"session_id":"sid","model":{}}"#).unwrap();

        let ctx = AttachContext {
            session_id: sid.clone(),
            initial_cwd: tmp.path().to_path_buf(),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            provider_home: Some(PathBuf::from("/home/u/.claude")),
            proc_root: None,
        };
        let bindings = AgentBindings::for_attach(&ctx).expect("for_attach");
        let located = LocatedStatusSource {
            status_path,
            trust_root: tmp.path().to_path_buf(),
            static_transcript_hint: None,
        };

        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );

        let handle = lifecycle
            .spawn_watch(bindings, located, sid.clone())
            .expect("spawn_watch should return a handle");
        // Drop the handle to join the spawned thread
        drop(handle);
    }

    #[test]
    fn t_verb_register() {
        let state = AgentWatcherState::new();
        let transcript_state = TranscriptState::new();
        let sid = "test-sid".to_string();
        let handle = WatcherHandle::new_for_test(transcript_state, sid.clone());

        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            state.clone(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        lifecycle.register(sid.clone(), handle);
        assert!(state.contains(&sid), "register should insert the session");
    }

    #[tokio::test]
    async fn t_verb_stop_empty_registry_returns_err() {
        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        let result = lifecycle.stop("nonexistent".to_string()).await;
        assert_eq!(
            result.unwrap_err(),
            "No active watcher for session: nonexistent"
        );
    }
}

impl SessionLifecycle {
    pub(crate) fn new(
        pty_state: PtyState,
        watcher_state: AgentWatcherState,
        transcript_state: TranscriptState,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            pty_state,
            watcher_state,
            transcript_state,
            events,
        }
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn resolve_attach<F>(
        &self,
        sid: &SessionId,
        detect: F,
    ) -> Result<AttachContext, String>
    where
        F: FnOnce(u32) -> Option<(AgentType, u32)>,
    {
        resolve_bind_inputs(&self.pty_state, sid, detect)
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn bind_services(&self, ctx: &AttachContext) -> Result<AgentBindings, String> {
        AgentBindings::for_attach(ctx).map_err(|e| format!("agent bindings: {}", e))
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn locate(
        &self,
        bindings: &AgentBindings,
        cwd: &Path,
        sid: &str,
    ) -> Result<LocatedStatusSource, String> {
        bindings.locator.locate(cwd, sid)
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn ensure_trust(&self, located: &LocatedStatusSource) -> Result<(), String> {
        base::ensure_status_source_under_trust_root(&located.status_path, &located.trust_root)
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn evict_old(&self, sid: &str) {
        self.watcher_state.remove(sid);
    }

    /// PRECONDITION: `located` MUST have passed `ensure_trust`
    /// (`ensure_status_source_under_trust_root`) before this verb runs.
    /// `base::start_watching` does NOT re-validate the status path against
    /// the trust root — that obligation lives in the sibling `ensure_trust`
    /// verb, which the `start()` orchestration calls earlier in the sequence
    /// (`locate → ensure_trust → evict_old → spawn_watch → register`; see the
    /// F.5 cutover and the T-LIFECYCLE-2b regression test). Spawning a watcher
    /// on an unvalidated path would reopen the symlink-race / path-traversal
    /// hole `path_security` closes. Mirrors the precondition documented on
    /// `base::start_watching` itself.
    #[allow(dead_code)] // remove in F.5 cutover
    fn spawn_watch(
        &self,
        bindings: AgentBindings,
        located: LocatedStatusSource,
        sid: String,
    ) -> Result<WatcherHandle, String> {
        base::start_watching(
            bindings,
            self.events.clone(),
            self.pty_state.clone(),
            self.transcript_state.clone(),
            sid,
            located,
        )
    }

    #[allow(dead_code)] // remove in F.5 cutover
    fn register(&self, sid: String, handle: WatcherHandle) {
        self.watcher_state.insert(sid, handle);
    }

    /// Start (or restart) the agent watcher for `session_id`.
    ///
    /// Resolves the attach inputs from live `PtyState`, builds the
    /// `AgentBindings`, and runs `base::start_for` on the blocking
    /// pool. `AttachError` is mapped to `String` at this boundary.
    pub(crate) async fn start(&self, session_id: String) -> Result<(), String> {
        let attach = resolve_bind_inputs(&self.pty_state, &session_id, detect_agent)?;

        // `AttachError` → `String` mapping seam (frozen constraint #4 /
        // #246 D'). Everything from `base::start_for` down speaks
        // `String`; the typed error stops here.
        let bindings =
            AgentBindings::for_attach(&attach).map_err(|e| format!("agent bindings: {}", e))?;
        let cwd_path = attach.initial_cwd.clone();

        // Clone the owned collaborators into the blocking task.
        // `base::start_for(bindings, ...)` calls
        // `bindings.locator.locate(...)`; for codex sessions the
        // locator runs a bounded retry (5 × 100 ms inter-attempt
        // sleeps) inside its `StatusSourceLocator::locate` impl, and
        // `path_security::ensure_status_source_under_trust_root` does
        // synchronous `canonicalize` I/O. Running either on a tokio
        // worker thread starves co-scheduled futures, so hop onto the
        // blocking pool (mirrors `src/git/watcher.rs`).
        let events = self.events.clone();
        let pty_state = self.pty_state.clone();
        let transcript_state = self.transcript_state.clone();
        let watcher_state = self.watcher_state.clone();
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

    /// Stop the agent watcher for `session_id`. Removing the
    /// `WatcherHandle` from `AgentWatcherState` runs its `Drop`, which
    /// cascades the transcript-tail teardown.
    pub(crate) async fn stop(&self, session_id: String) -> Result<(), String> {
        if self.watcher_state.remove(&session_id) {
            log::info!("Stopped watching statusline for session {}", session_id);
            Ok(())
        } else {
            Err(format!("No active watcher for session: {}", session_id))
        }
    }
}
