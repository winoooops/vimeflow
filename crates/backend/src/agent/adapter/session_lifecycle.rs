//! `SessionLifecycle` — the registry facade for agent-watcher
//! lifecycle.
//!
//! Step D' of the v4-frozen refactor plan (#246). Owns clones of the
//! four runtime collaborators (`PtyState`, `AgentWatcherState`,
//! `TranscriptState`, `Arc<dyn EventSink>`) and exposes the two
//! lifecycle verbs the IPC layer needs:
//!
//! - `start(session_id)` — resolve the [`AttachContext`] from live
//!   `PtyState`, build the typed [`AgentBindings`], and run the verb
//!   sequence on the blocking pool.
//! - `stop(session_id)` — remove the session's watcher from
//!   `AgentWatcherState` (its `Drop` cascades the transcript-tail
//!   teardown).
//!
//! **`AttachError` → `String` boundary.** Per #246's D' acceptance and
//! frozen constraint #4, the typed `AttachError` from
//! `AgentBindings::for_attach` is collapsed to `String` *here* — the
//! post-bindings verb sequence (`run_watch_sequence`) and everything
//! below it speaks `String` errors. This is the single mapping seam;
//! `start_agent_watcher_inner` delegates to this method rather than
//! mapping independently.

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
use base::{AgentWatcherState, TranscriptState, TrustedLocatedSource, WatcherHandle};

/// Registry facade owning clones of the four runtime collaborators.
///
/// Constructed per IPC call from `BackendState`'s long-lived
/// originals (all four are cheap `Arc`-backed clones). `stop` only
/// reads `watcher_state`, but the service carries all four so the
/// facade shape is uniform and a future eager-prevalidation `stop`
/// (or a `restart`) has the inputs it needs without a signature
/// change.
#[derive(Clone)]
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
    use crate::runtime::EventSink;
    use crate::terminal::PtyState;
    use tempfile::TempDir;

    fn make_attach_ctx(cwd: &std::path::Path) -> AttachContext {
        AttachContext {
            session_id: "test-sess".to_string(),
            initial_cwd: cwd.to_path_buf(),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            provider_home: Some(PathBuf::from("/home/u/.claude")),
            proc_root: None,
        }
    }

    fn write_claude_status(cwd: &std::path::Path, sid: &str) {
        let dir = cwd.join(".vimeflow").join("sessions").join(sid);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("status.json"), r#"{"session_id":"sid","model":{}}"#).unwrap();
    }

    fn seeded_fixture(sid: &str) -> (tempfile::TempDir, TranscriptState, AgentWatcherState) {
        let sink = Arc::new(FakeEventSink::new());
        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("t.jsonl");
        std::fs::write(&transcript_path, "").expect("write");
        let transcript_state = TranscriptState::new();
        let adapter: Arc<dyn crate::agent::adapter::traits::TranscriptStreamer> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        transcript_state
            .start_or_replace(
                adapter,
                sink,
                sid.to_string(),
                transcript_path,
                None,
            )
            .expect("seed transcript state");
        let watcher_state = AgentWatcherState::new();
        let seed = WatcherHandle::new_for_test(transcript_state.clone(), sid.to_string());
        watcher_state.insert(sid.to_string(), seed);
        // Return `tmp` so the caller owns its lifetime — dropping the TempDir
        // here would delete the seeded transcript file before the test body
        // runs (a latent trap for any future test that reads it).
        (tmp, transcript_state, watcher_state)
    }

    struct OutsideTrustLocator;

    impl StatusSourceLocator for OutsideTrustLocator {
        fn locate(
            &self,
            cwd: &std::path::Path,
            _session_id: &str,
        ) -> Result<LocatedStatusSource, String> {
            let parent = cwd.parent().unwrap_or(cwd);
            Ok(LocatedStatusSource {
                status_path: parent.join("sibling.json"),
                trust_root: cwd.to_path_buf(),
                static_transcript_hint: None,
            })
        }
    }

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
        let under_status_path = tmp
            .path()
            .join(".vimeflow")
            .join("sessions")
            .join("s")
            .join("status.json");
        let under = LocatedStatusSource {
            status_path: under_status_path.clone(),
            trust_root: tmp.path().to_path_buf(),
            static_transcript_hint: None,
        };
        let lifecycle = SessionLifecycle::new(
            PtyState::new(),
            AgentWatcherState::new(),
            TranscriptState::new(),
            Arc::new(FakeEventSink::new()),
        );
        let trusted = lifecycle.ensure_trust(under).expect("under trust root");
        assert_eq!(trusted.status_path(), under_status_path);

        // Outside trust root -> Err
        let outside = LocatedStatusSource {
            status_path: tmp.path().parent().unwrap().join("sibling.json"),
            trust_root: tmp.path().to_path_buf(),
            static_transcript_hint: None,
        };
        let result = lifecycle.ensure_trust(outside);
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

        let trusted = lifecycle.ensure_trust(located).expect("ensure_trust should pass");
        let handle = lifecycle
            .spawn_watch(bindings, trusted, sid.clone())
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

    #[tokio::test]
    async fn t_lifecycle_1_start_inner_for_test_happy_path_registers_session() {
        let tmp = TempDir::new().unwrap();
        let sid = "test-sess".to_string();
        write_claude_status(tmp.path(), &sid);

        let ctx = make_attach_ctx(tmp.path());
        let bindings = AgentBindings::for_attach(&ctx).unwrap();
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();
        let transcript_state = TranscriptState::new();
        let watcher_state = AgentWatcherState::new();

        let lifecycle = SessionLifecycle::new(
            pty_state,
            watcher_state.clone(),
            transcript_state,
            events,
        );
        lifecycle
            .start_inner_for_test(sid.clone(), bindings, tmp.path().to_path_buf())
            .await
            .expect("start_inner_for_test happy path");
        assert!(watcher_state.contains(&sid), "session registered");

        watcher_state.remove(&sid);
    }

    #[tokio::test]
    async fn t_lifecycle_2a_start_inner_for_test_locate_err_preserves_existing_watcher() {
        let sid = "test-sess".to_string();
        let (_tmp, transcript_state, watcher_state) = seeded_fixture(&sid);

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
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();

        let lifecycle = SessionLifecycle::new(
            pty_state,
            watcher_state.clone(),
            transcript_state.clone(),
            events,
        );
        let result = lifecycle
            .start_inner_for_test(sid.clone(), bindings, PathBuf::from("/tmp"))
            .await;

        assert!(result.is_err(), "locate failure should return Err");
        assert!(
            watcher_state.contains(&sid),
            "existing watcher should be preserved"
        );
        assert!(
            transcript_state.contains(&sid),
            "transcript state entry should be preserved"
        );

        watcher_state.remove(&sid);
    }

    #[tokio::test]
    async fn t_lifecycle_2b_start_inner_for_test_trust_err_preserves_existing_watcher() {
        let sid = "test-sess".to_string();
        let (_tmp, transcript_state, watcher_state) = seeded_fixture(&sid);

        let adapter: Arc<crate::agent::adapter::claude_code::ClaudeCodeAdapter> =
            Arc::new(crate::agent::adapter::claude_code::ClaudeCodeAdapter);
        let bindings = AgentBindings {
            agent_type: AgentType::ClaudeCode,
            locator: Arc::new(OutsideTrustLocator),
            decoder: adapter.clone(),
            transcript_paths: adapter.clone(),
            validator: adapter.clone(),
            streamer: adapter,
        };
        let events: Arc<dyn EventSink> = Arc::new(FakeEventSink::new());
        let pty_state = PtyState::new();

        let lifecycle = SessionLifecycle::new(
            pty_state,
            watcher_state.clone(),
            transcript_state.clone(),
            events,
        );
        let result = lifecycle
            .start_inner_for_test(sid.clone(), bindings, PathBuf::from("/tmp"))
            .await;

        assert!(result.is_err(), "trust failure should return Err");
        assert!(
            watcher_state.contains(&sid),
            "existing watcher should be preserved"
        );
        assert!(
            transcript_state.contains(&sid),
            "transcript state entry should be preserved"
        );

        watcher_state.remove(&sid);
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

    fn bind_services(&self, ctx: &AttachContext) -> Result<AgentBindings, String> {
        AgentBindings::for_attach(ctx).map_err(|e| format!("agent bindings: {}", e))
    }

    fn locate(
        &self,
        bindings: &AgentBindings,
        cwd: &Path,
        sid: &str,
    ) -> Result<LocatedStatusSource, String> {
        bindings.locator.locate(cwd, sid)
    }

    fn ensure_trust(&self, located: LocatedStatusSource) -> Result<TrustedLocatedSource, String> {
        base::ensure_trusted(located)
    }

    fn evict_old(&self, sid: &str) {
        self.watcher_state.remove(sid);
    }

    fn spawn_watch(
        &self,
        bindings: AgentBindings,
        located: TrustedLocatedSource,
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

    fn register(&self, sid: String, handle: WatcherHandle) {
        self.watcher_state.insert(sid, handle);
    }

    /// Start (or restart) the agent watcher for `session_id`.
    ///
    /// Resolves the attach inputs from live `PtyState`, builds the
    /// `AgentBindings`, then runs the post-bindings verb sequence
    /// (`locate → ensure_trust → evict_old → spawn_watch → register`) on
    /// the blocking pool via [`Self::run_watch_sequence`]. `AttachError`
    /// is mapped to `String` at this boundary.
    pub(crate) async fn start(&self, session_id: String) -> Result<(), String> {
        let attach = self.resolve_attach(&session_id, detect_agent)?;
        let bindings = self.bind_services(&attach)?;
        let cwd = attach.initial_cwd.clone();
        self.run_watch_sequence(session_id, bindings, cwd).await
    }

    /// The post-bindings half of `start`: the verb sequence run on the
    /// blocking pool (`locate → ensure_trust → evict_old → spawn_watch →
    /// register`) with the two diagnostic log lines at the orchestration
    /// site. Shared by `start` (production) and, in tests,
    /// `start_inner_for_test` — so the migrated T-LIFECYCLE-1/2a/2b tests
    /// exercise the EXACT production sequence rather than a parallel copy.
    async fn run_watch_sequence(
        &self,
        session_id: String,
        bindings: AgentBindings,
        cwd: std::path::PathBuf,
    ) -> Result<(), String> {
        let lc = self.clone();
        tokio::task::spawn_blocking(move || {
            let located = lc.locate(&bindings, &cwd, &session_id)?;
            let trusted = lc.ensure_trust(located)?;

            log::debug!(
                "Watcher startup detail: session={}, cwd={}, path={}",
                session_id,
                cwd.display(),
                trusted.status_path().display(),
            );

            lc.evict_old(&session_id);

            log::info!(
                "Starting agent watcher: session={}, path={}, active_watchers={}",
                session_id,
                trusted.status_path().display(),
                lc.watcher_state.active_count(),
            );

            let handle = lc.spawn_watch(bindings, trusted, session_id.clone())?;
            lc.register(session_id, handle);
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| format!("start_agent_watcher task panicked: {}", e))?
    }

    /// Test-only entry to the post-bindings sequence with hand-built
    /// `AgentBindings` (bypassing `resolve_attach`, which needs a live
    /// `PtyState` entry). Delegates to the SAME [`Self::run_watch_sequence`]
    /// production `start` runs, so the migrated T-LIFECYCLE-2a/2b
    /// short-circuit tests cover the real orchestration body.
    #[cfg(test)]
    pub(crate) async fn start_inner_for_test(
        &self,
        session_id: String,
        bindings: AgentBindings,
        cwd: std::path::PathBuf,
    ) -> Result<(), String> {
        self.run_watch_sequence(session_id, bindings, cwd).await
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
