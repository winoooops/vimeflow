use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::{AgentWatcherState, TranscriptState};
use crate::git::watcher::GitWatcherState;
use crate::terminal::cache::SessionCache;
use crate::terminal::state::PtyState;

use super::event_sink::EventSink;

/// Consolidated runtime-neutral backend state.
pub struct BackendState {
    pub(crate) pty: PtyState,
    pub(crate) sessions: Arc<SessionCache>,
    pub(crate) agents: AgentWatcherState,
    pub(crate) transcripts: TranscriptState,
    pub(crate) git: GitWatcherState,
    pub(crate) events: Arc<dyn EventSink>,
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
        }
    }

    /// Returns test backend state, its event sink, and the temp cache owner.
    ///
    /// Keep the returned `TempDir` bound to a named variable for the whole
    /// test. A bare `_` pattern drops it immediately and removes the cache
    /// directory before `SessionCache` can flush changes.
    #[cfg(any(test, feature = "e2e-test"))]
    pub fn with_fake_sink() -> (
        Arc<Self>,
        Arc<super::event_sink::FakeEventSink>,
        tempfile::TempDir,
    ) {
        let temp_dir = tempfile::tempdir().expect("temp dir for test BackendState");
        let sink = super::event_sink::FakeEventSink::new();
        let events: Arc<dyn EventSink> = sink.clone();
        let state = Arc::new(Self::new(temp_dir.path().to_path_buf(), events));
        (state, sink, temp_dir)
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
