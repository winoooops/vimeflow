use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::types::{
    AgentType, RenameAgentSessionError, RenameAgentSessionErrorReason, RenameAgentSessionRequest,
};
use crate::agent::{sanitize_title, AgentWatcherState, TranscriptState};
use crate::git::watcher::GitWatcherState;
use crate::terminal::cache::SessionCache;
use crate::terminal::state::PtyState;
use crate::terminal::types::SessionId;

use super::event_sink::EventSink;

/// Consolidated runtime-neutral backend state.
pub struct BackendState {
    pty: PtyState,
    sessions: Arc<SessionCache>,
    agents: AgentWatcherState,
    transcripts: TranscriptState,
    git: GitWatcherState,
    events: Arc<dyn EventSink>,
    #[cfg(any(test, feature = "e2e-test"))]
    _test_cache_dir: Option<tempfile::TempDir>,
}

impl BackendState {
    pub fn new(app_data_dir: PathBuf, events: Arc<dyn EventSink>) -> Self {
        let cache_path = app_data_dir.join("sessions.json");
        Self {
            pty: PtyState::new(),
            sessions: Arc::new(SessionCache::load_or_recover(cache_path)),
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
            #[cfg(any(test, feature = "e2e-test"))]
            _test_cache_dir: None,
        }
    }

    /// Returns test backend state and its event sink.
    #[cfg(any(test, feature = "e2e-test"))]
    pub fn with_fake_sink() -> (Arc<Self>, Arc<super::event_sink::FakeEventSink>) {
        let temp_dir = tempfile::tempdir().expect("temp dir for test BackendState");
        let app_data_dir = temp_dir.path().to_path_buf();
        let sink = Arc::new(super::event_sink::FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut state = Self::new(app_data_dir, events);
        state._test_cache_dir = Some(temp_dir);
        (Arc::new(state), sink)
    }

    pub fn shutdown(&self) {
        if let Err(err) = self.sessions.clear_all() {
            log::warn!("BackendState::shutdown: cache clear failed: {err}");
        }
    }

    pub async fn spawn_pty(
        &self,
        request: crate::terminal::types::SpawnPtyRequest,
    ) -> Result<crate::terminal::types::PtySession, String> {
        crate::terminal::commands::spawn_pty_inner(
            self.pty.clone(),
            self.sessions.clone(),
            self.events.clone(),
            request,
        )
        .await
    }

    pub fn write_pty(
        &self,
        request: crate::terminal::types::WritePtyRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::write_pty_inner(&self.pty, request)
    }

    pub fn rename_agent_session(
        &self,
        request: RenameAgentSessionRequest,
    ) -> Result<(), RenameAgentSessionError> {
        let agent_type = self
            .agents
            .agent_type_for_pty(&request.pty_id)
            .ok_or_else(|| {
                RenameAgentSessionError::new(
                    RenameAgentSessionErrorReason::NoLiveAgent,
                    format!("no live agent in pty {} to rename", request.pty_id),
                )
            })?;

        if !matches!(agent_type, AgentType::ClaudeCode | AgentType::Codex) {
            return Err(RenameAgentSessionError::new(
                RenameAgentSessionErrorReason::UnsupportedAgent,
                format!("agent type {agent_type:?} does not support /rename"),
            ));
        }

        let title = sanitize_title(&request.title).ok_or_else(|| {
            RenameAgentSessionError::new(
                RenameAgentSessionErrorReason::EmptyTitle,
                "title is empty after sanitization",
            )
        })?;
        // Submit byte MUST be `\r` (CR, 0x0D), not `\n` (LF, 0x0A). Both
        // Claude Code and Codex run their TUI input boxes in raw terminal
        // mode and capture the actual keypress. The "Enter" key produces
        // `\r` on every Unix terminal driver; `\n` is only translated to
        // a submit by ICRNL in *canonical* mode (line-buffered shells),
        // which raw-mode TUIs disable. Sending `\n` was making the bytes
        // appear in the agent's input box without ever submitting, until
        // the user manually focused the pane and pressed Enter.
        let command = format!("/rename {title}\r");
        let session_id = SessionId::from(request.pty_id);
        self.pty
            .write(&session_id, command.as_bytes())
            .map_err(|e| {
                RenameAgentSessionError::new(
                    RenameAgentSessionErrorReason::PtyWrite,
                    format!("pty write failed: {e}"),
                )
            })?;

        if matches!(agent_type, AgentType::Codex) {
            crate::agent::adapter::codex::session_index::record_user_rename(
                session_id.as_str(),
                &title,
            );
        }

        Ok(())
    }

    pub fn resize_pty(
        &self,
        request: crate::terminal::types::ResizePtyRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::resize_pty_inner(&self.pty, request)
    }

    pub fn kill_pty(&self, request: crate::terminal::types::KillPtyRequest) -> Result<(), String> {
        crate::terminal::commands::kill_pty_inner(&self.pty, &self.sessions, request)
    }

    pub fn list_sessions(&self) -> Result<crate::terminal::types::SessionList, String> {
        crate::terminal::commands::list_sessions_inner(&self.pty, &self.sessions)
    }

    pub fn set_active_session(
        &self,
        request: crate::terminal::types::SetActiveSessionRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::set_active_session_inner(&self.sessions, request)
    }

    pub fn reorder_sessions(
        &self,
        request: crate::terminal::types::ReorderSessionsRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::reorder_sessions_inner(&self.sessions, request)
    }

    pub fn update_session_cwd(
        &self,
        request: crate::terminal::types::UpdateSessionCwdRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::update_session_cwd_inner(&self.sessions, request)
    }

    pub fn set_session_activity_panel_collapsed(
        &self,
        request: crate::terminal::types::SetSessionActivityPanelCollapsedRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::set_session_activity_panel_collapsed_inner(
            &self.sessions,
            request,
        )
    }

    pub fn list_dir(
        &self,
        request: crate::filesystem::types::ListDirRequest,
    ) -> Result<Vec<crate::filesystem::types::FileEntry>, String> {
        crate::filesystem::list::list_dir_inner(request)
    }

    pub fn read_file(
        &self,
        request: crate::filesystem::types::ReadFileRequest,
    ) -> Result<String, String> {
        crate::filesystem::read::read_file_inner(request)
    }

    pub fn write_file(
        &self,
        request: crate::filesystem::types::WriteFileRequest,
    ) -> Result<(), String> {
        crate::filesystem::write::write_file_inner(request)
    }

    pub async fn git_status(&self, cwd: String) -> Result<Vec<crate::git::ChangedFile>, String> {
        crate::git::git_status_inner(cwd).await
    }

    pub async fn git_branch(&self, cwd: String) -> Result<String, String> {
        crate::git::git_branch_inner(cwd).await
    }

    pub async fn git_worktree_name(&self, cwd: String) -> Result<Option<String>, String> {
        crate::git::git_worktree_name_inner(cwd).await
    }

    pub async fn get_git_diff(
        &self,
        cwd: String,
        file: String,
        staged: bool,
        untracked: Option<bool>,
    ) -> Result<crate::git::FileDiff, String> {
        crate::git::get_git_diff_inner(cwd, file, staged, untracked).await
    }

    pub async fn start_git_watcher(&self, cwd: String) -> Result<(), String> {
        crate::git::watcher::start_git_watcher_backend(cwd, self.events.clone(), self.git.clone())
            .await
    }

    pub async fn stop_git_watcher(&self, cwd: String) -> Result<(), String> {
        crate::git::watcher::stop_git_watcher_backend(cwd, self.git.clone()).await
    }

    pub async fn detect_agent_in_session(
        &self,
        session_id: String,
    ) -> Result<Option<crate::agent::types::AgentDetectedEvent>, String> {
        crate::agent::commands::detect_agent_in_session_inner(&self.pty, session_id).await
    }

    pub async fn start_agent_watcher(&self, session_id: String) -> Result<(), String> {
        crate::agent::adapter::start_agent_watcher_inner(
            self.pty.clone(),
            self.agents.clone(),
            self.transcripts.clone(),
            self.events.clone(),
            session_id,
        )
        .await
    }

    pub async fn stop_agent_watcher(&self, session_id: String) -> Result<(), String> {
        crate::agent::adapter::stop_agent_watcher_inner(&self.agents, session_id).await
    }

    #[cfg(feature = "e2e-test")]
    pub fn list_active_pty_sessions(&self) -> Vec<String> {
        self.pty.active_ids()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;
    use std::time::SystemTime;

    use crate::terminal::state::{ManagedSession, RingBuffer};

    #[derive(Clone)]
    struct CapturingWriter {
        writes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for CapturingWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.writes
                .lock()
                .expect("failed to lock captured writes")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct NoopChild;

    impl portable_pty::ChildKiller for NoopChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(NoopChild)
        }
    }

    impl portable_pty::Child for NoopChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }

        fn process_id(&self) -> Option<u32> {
            Some(1)
        }
    }

    fn make_capturing_session(writes: Arc<Mutex<Vec<u8>>>) -> ManagedSession {
        use portable_pty::{native_pty_system, PtySize};

        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        ManagedSession {
            master: pty_pair.master,
            writer: Box::new(CapturingWriter { writes }),
            child: Box::new(NoopChild),
            cwd: "/tmp".into(),
            generation: 0,
            ring: Arc::new(Mutex::new(RingBuffer::new(64))),
            cancelled: Arc::new(AtomicBool::new(false)),
            started_at: SystemTime::now(),
        }
    }

    fn seed_live_agent(state: &BackendState, agent_type: AgentType) -> Arc<Mutex<Vec<u8>>> {
        let writes = Arc::new(Mutex::new(Vec::new()));
        state
            .pty
            .insert("pty-1".to_string(), make_capturing_session(writes.clone()));
        state
            .agents
            .insert_agent_type_for_test("pty-1".to_string(), agent_type);
        writes
    }

    fn rename_request(title: &str) -> RenameAgentSessionRequest {
        RenameAgentSessionRequest {
            pty_id: "pty-1".to_string(),
            title: title.to_string(),
        }
    }

    fn captured_string(writes: &Arc<Mutex<Vec<u8>>>) -> String {
        String::from_utf8(
            writes
                .lock()
                .expect("failed to lock captured writes")
                .clone(),
        )
        .expect("captured PTY write should be UTF-8")
    }

    #[test]
    fn with_fake_sink_returns_arc_state_and_fake_sink() {
        let (state, sink) = BackendState::with_fake_sink();
        assert!(Arc::strong_count(&state) >= 1);
        assert_eq!(sink.recorded().len(), 0);
    }

    #[test]
    fn shutdown_clears_session_cache_and_is_idempotent() {
        let (state, _sink) = BackendState::with_fake_sink();
        state.shutdown();
        state.shutdown();
    }

    #[test]
    fn rename_agent_session_writes_command_for_claude() {
        let (state, _sink) = BackendState::with_fake_sink();
        let writes = seed_live_agent(&state, AgentType::ClaudeCode);

        let result = state.rename_agent_session(rename_request("my-feature"));

        assert!(result.is_ok());
        assert_eq!(captured_string(&writes), "/rename my-feature\r");
    }

    #[test]
    fn rename_agent_session_writes_command_for_codex() {
        let (state, _sink) = BackendState::with_fake_sink();
        let writes = seed_live_agent(&state, AgentType::Codex);

        let result = state.rename_agent_session(rename_request("codex-title"));

        assert!(result.is_ok());
        assert_eq!(captured_string(&writes), "/rename codex-title\r");
    }

    #[test]
    fn rename_agent_session_rejects_aider() {
        let (state, _sink) = BackendState::with_fake_sink();
        let writes = seed_live_agent(&state, AgentType::Aider);

        let result = state.rename_agent_session(rename_request("nope"));

        let err = result.expect_err("aider should not support /rename");
        assert_eq!(err.reason, RenameAgentSessionErrorReason::UnsupportedAgent);
        assert!(err.to_string().contains("does not support /rename"));
        assert_eq!(captured_string(&writes), "");
    }

    #[test]
    fn rename_agent_session_rejects_no_live_agent() {
        let (state, _sink) = BackendState::with_fake_sink();

        let result = state.rename_agent_session(rename_request("x"));

        let err = result.expect_err("missing agent should reject");
        assert_eq!(err.reason, RenameAgentSessionErrorReason::NoLiveAgent);
        assert!(err.to_string().contains("no live agent"));
    }

    #[test]
    fn rename_agent_session_sanitizes_input() {
        let (state, _sink) = BackendState::with_fake_sink();
        let writes = seed_live_agent(&state, AgentType::ClaudeCode);

        let result = state.rename_agent_session(rename_request("foo\nbar"));

        assert!(result.is_ok());
        assert_eq!(captured_string(&writes), "/rename foo bar\r");
    }
}
