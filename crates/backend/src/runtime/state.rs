use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::types::{
    AgentType, RenameAgentSessionError, RenameAgentSessionErrorReason, RenameAgentSessionRequest,
};
use crate::agent::{sanitize_title, AgentWatcherState, TranscriptState};
use crate::aliases::{AgentAlias, AgentAliasesStore, AliasesCache, CURRENT_AGENT_ALIASES_VERSION};
use crate::git::watcher::GitWatcherState;
use crate::settings::{AppSettings, AppSettingsCache};
use crate::terminal::cache::SessionCache;
use crate::terminal::state::PtyState;
use crate::terminal::types::SessionId;
use crate::terminal::workspace_layout::{WorkspaceLayoutCache, WorkspaceLayoutStore};

use super::event_sink::EventSink;

fn no_live_agent_error(pty_id: &str) -> RenameAgentSessionError {
    RenameAgentSessionError::new(
        RenameAgentSessionErrorReason::NoLiveAgent,
        format!("no live agent in pty {pty_id} to rename"),
    )
}

fn unsupported_agent_error(agent_type: &AgentType) -> RenameAgentSessionError {
    RenameAgentSessionError::new(
        RenameAgentSessionErrorReason::UnsupportedAgent,
        format!("agent type {agent_type:?} does not support /rename"),
    )
}

fn ensure_rename_supported(agent_type: &AgentType) -> Result<(), RenameAgentSessionError> {
    if matches!(agent_type, AgentType::ClaudeCode | AgentType::Codex) {
        return Ok(());
    }

    Err(unsupported_agent_error(agent_type))
}

/// Consolidated runtime-neutral backend state.
pub struct BackendState {
    pty: PtyState,
    sessions: Arc<SessionCache>,
    workspace_layouts: Arc<WorkspaceLayoutCache>,
    app_settings: Arc<AppSettingsCache>,
    aliases: Arc<AliasesCache>,
    agents: AgentWatcherState,
    transcripts: TranscriptState,
    git: GitWatcherState,
    events: Arc<dyn EventSink>,
    #[cfg(any(test, feature = "e2e-test"))]
    _test_cache_dir: Option<tempfile::TempDir>,
}

impl BackendState {
    pub fn new(app_data_dir: PathBuf, events: Arc<dyn EventSink>) -> Self {
        Self::new_with_aliases_path(app_data_dir, AliasesCache::default_path(), events)
    }

    fn new_with_aliases_path(
        app_data_dir: PathBuf,
        aliases_path: PathBuf,
        events: Arc<dyn EventSink>,
    ) -> Self {
        let cache_path = app_data_dir.join("sessions.json");
        let layouts_path = app_data_dir.join("workspace-layouts.json");
        let settings_path = app_data_dir.join("settings.json");
        Self {
            pty: PtyState::new(),
            sessions: Arc::new(SessionCache::load_or_recover(cache_path)),
            workspace_layouts: Arc::new(WorkspaceLayoutCache::new(layouts_path)),
            app_settings: Arc::new(AppSettingsCache::new(settings_path)),
            aliases: Arc::new(AliasesCache::new(aliases_path)),
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
        let aliases_path = app_data_dir.join("aliases.toml");
        let sink = Arc::new(super::event_sink::FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut state = Self::new_with_aliases_path(app_data_dir, aliases_path, events);
        state._test_cache_dir = Some(temp_dir);
        (Arc::new(state), sink)
    }

    pub fn shutdown(&self) {
        // Best-effort kill of burner PTYs (reap-on-boot is the authoritative net).
        let _ = self.kill_ephemeral_ptys();
        if let Err(err) = self.sessions.clear_all() {
            log::warn!("BackendState::shutdown: cache clear failed: {err}");
        }
    }

    /// Load + repair the durable workspace-layout store (spec §2.2), using the
    /// active project context for defaults. Main-invoked (not renderer).
    pub fn load_workspace_layout(
        &self,
        project_id: &str,
        working_directory: &str,
    ) -> WorkspaceLayoutStore {
        self.workspace_layouts.load(project_id, working_directory)
    }

    /// Persist the assembled workspace-layout store. Main-invoked (not renderer).
    pub fn save_workspace_layout(&self, store: &WorkspaceLayoutStore) -> Result<(), String> {
        self.workspace_layouts.save(store)
    }

    /// Load the durable app settings store; missing / corrupt → defaults.
    pub fn load_app_settings(&self) -> AppSettings {
        self.app_settings.load()
    }

    /// Persist app settings.
    pub fn save_app_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.app_settings.save(settings)
    }

    /// Load the durable agent aliases store; missing / corrupt → empty Vec.
    pub fn load_agent_aliases(&self) -> Vec<AgentAlias> {
        self.aliases.load().aliases
    }

    /// Persist agent aliases.
    pub fn save_agent_aliases(&self, aliases: &[AgentAlias]) -> Result<(), String> {
        let store = AgentAliasesStore {
            version: CURRENT_AGENT_ALIASES_VERSION,
            aliases: aliases.to_vec(),
        };
        self.aliases.save(&store)
    }

    /// Spawn the burner-terminal foreground poll loop (VIM-71). Call once at
    /// startup: it emits `burner-foreground` events as burner shells begin
    /// and finish foreground commands, driving the live "running" cue. Requires
    /// a running Tokio runtime (the sidecar binary's `#[tokio::main]`).
    pub fn start_foreground_poll(&self) {
        tokio::spawn(crate::terminal::foreground::foreground_poll_loop(
            self.pty.clone(),
            self.events.clone(),
        ));
    }

    pub async fn spawn_pty(
        &self,
        request: crate::terminal::types::SpawnPtyRequest,
    ) -> Result<crate::terminal::types::PtySession, String> {
        let aliases = self.aliases.load().aliases;
        let shim_enabled = self.app_settings.load().agent_shim_enabled;
        crate::terminal::commands::spawn_pty_inner(
            self.pty.clone(),
            self.sessions.clone(),
            self.events.clone(),
            request,
            &aliases,
            shim_enabled,
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
            .ok_or_else(|| no_live_agent_error(&request.pty_id))?;

        ensure_rename_supported(&agent_type)?;

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

        if let Err(e) = self.pty.write(&session_id, command.as_bytes()) {
            if self
                .agents
                .agent_type_for_pty(session_id.as_str())
                .is_none()
            {
                return Err(no_live_agent_error(session_id.as_str()));
            }

            return Err(RenameAgentSessionError::new(
                RenameAgentSessionErrorReason::PtyWrite,
                format!("pty write failed: {e}"),
            ));
        }

        let current_agent_type = self
            .agents
            .agent_type_for_pty(session_id.as_str())
            .ok_or_else(|| no_live_agent_error(session_id.as_str()))?;
        ensure_rename_supported(&current_agent_type)?;

        if matches!(current_agent_type, AgentType::Codex) {
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

    /// Reap all ephemeral (burner) PTYs. Returns the ids killed.
    pub fn kill_ephemeral_ptys(&self) -> Vec<String> {
        crate::terminal::commands::kill_ephemeral_ptys_inner(&self.pty)
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

    pub fn set_workspace_sessions(
        &self,
        request: crate::terminal::types::SetWorkspaceSessionsRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::set_workspace_sessions_inner(&self.sessions, request)
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
    ) -> Result<crate::git::GetGitDiffResponse, String> {
        crate::git::get_git_diff_inner(cwd, file, staged, untracked).await
    }

    pub async fn stage_file(&self, req: crate::git::StageFileRequest) -> Result<(), String> {
        crate::git::stage_file_inner(req).await
    }

    pub async fn unstage_file(&self, req: crate::git::StageFileRequest) -> Result<(), String> {
        crate::git::unstage_file_inner(req).await
    }

    pub async fn discard_file(&self, req: crate::git::DiscardFileRequest) -> Result<(), String> {
        crate::git::discard_file_inner(req).await
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
        crate::agent::adapter::stop_agent_watcher_inner(
            self.pty.clone(),
            self.agents.clone(),
            self.transcripts.clone(),
            self.events.clone(),
            session_id,
        )
        .await
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

    use crate::agent::events::AGENT_SESSION_TITLE;
    use crate::terminal::state::{ManagedSession, RingBuffer};

    #[derive(Clone)]
    struct CapturingWriter {
        writes: Arc<Mutex<Vec<u8>>>,
        on_write: Option<Arc<dyn Fn() + Send + Sync>>,
        fail: bool,
    }

    impl Write for CapturingWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.fail {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "write failed",
                ));
            }

            self.writes
                .lock()
                .expect("failed to lock captured writes")
                .extend_from_slice(buf);
            if let Some(on_write) = &self.on_write {
                on_write();
            }
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
        make_capturing_session_with_hook(writes, None)
    }

    fn make_capturing_session_with_hook(
        writes: Arc<Mutex<Vec<u8>>>,
        on_write: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> ManagedSession {
        make_capturing_session_with_options(writes, on_write, false)
    }

    fn make_failing_session(writes: Arc<Mutex<Vec<u8>>>) -> ManagedSession {
        make_capturing_session_with_options(writes, None, true)
    }

    fn make_capturing_session_with_options(
        writes: Arc<Mutex<Vec<u8>>>,
        on_write: Option<Arc<dyn Fn() + Send + Sync>>,
        fail: bool,
    ) -> ManagedSession {
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
            writer: Box::new(CapturingWriter {
                writes,
                on_write,
                fail,
            }),
            child: Box::new(NoopChild),
            cwd: "/tmp".into(),
            shim_dir: None,
            generation: 0,
            ring: Arc::new(Mutex::new(RingBuffer::new(64))),
            cancelled: Arc::new(AtomicBool::new(false)),
            started_at: SystemTime::now(),
        }
    }

    fn seed_live_agent_for_pty(
        state: &BackendState,
        pty_id: &str,
        agent_type: AgentType,
    ) -> Arc<Mutex<Vec<u8>>> {
        let writes = Arc::new(Mutex::new(Vec::new()));
        state
            .pty
            .insert(pty_id.to_string(), make_capturing_session(writes.clone()));
        state.agents.insert_agent_type_for_test(
            state.transcripts.clone(),
            pty_id.to_string(),
            agent_type,
        );
        writes
    }

    fn seed_live_agent(state: &BackendState, agent_type: AgentType) -> Arc<Mutex<Vec<u8>>> {
        seed_live_agent_for_pty(state, "pty-1", agent_type)
    }

    fn rename_request_for_pty(pty_id: &str, title: &str) -> RenameAgentSessionRequest {
        RenameAgentSessionRequest {
            pty_id: pty_id.to_string(),
            title: title.to_string(),
        }
    }

    fn rename_request(title: &str) -> RenameAgentSessionRequest {
        rename_request_for_pty("pty-1", title)
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

    #[tokio::test]
    async fn shutdown_kills_ephemeral_ptys() {
        let (state, _sink) = BackendState::with_fake_sink();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        state
            .spawn_pty(crate::terminal::types::SpawnPtyRequest {
                session_id: "burner-shutdown".to_string(),
                cwd,
                shell: None,
                env: None,
                enable_agent_bridge: false,
                ephemeral: true,
            })
            .await
            .expect("ephemeral spawn");

        state.shutdown();

        let write = state.write_pty(crate::terminal::types::WritePtyRequest {
            session_id: "burner-shutdown".to_string(),
            data: "x".to_string(),
        });
        assert!(write.is_err(), "shutdown should have reaped the burner PTY");
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
        let pty_id = "pty-state-codex";
        let writes = seed_live_agent_for_pty(&state, pty_id, AgentType::Codex);

        let result = state.rename_agent_session(rename_request_for_pty(pty_id, "codex-title"));

        assert!(result.is_ok());
        assert_eq!(captured_string(&writes), "/rename codex-title\r");
    }

    #[test]
    fn rename_agent_session_does_not_record_codex_pending_rename_on_write_failure() {
        let (state, _sink) = BackendState::with_fake_sink();
        let pty_id = "pty-state-codex-write-fail";
        let writes = Arc::new(Mutex::new(Vec::new()));
        state
            .pty
            .insert(pty_id.to_string(), make_failing_session(writes.clone()));
        state.agents.insert_agent_type_for_test(
            state.transcripts.clone(),
            pty_id.to_string(),
            AgentType::Codex,
        );

        let result = state.rename_agent_session(rename_request_for_pty(pty_id, "failed-title"));

        let err = result.expect_err("failed PTY write should reject");
        assert_eq!(err.reason, RenameAgentSessionErrorReason::PtyWrite);
        assert_eq!(captured_string(&writes), "");

        let dir = tempfile::tempdir().expect("tempdir");
        let index_path = dir.path().join("session_index.jsonl");
        std::fs::write(
            &index_path,
            r#"{"id":"thread-id","thread_name":"failed-title","updated_at":"2026-05-23T00:00:00Z"}"#,
        )
        .expect("write session index");
        let sink: Arc<crate::runtime::FakeEventSink> =
            Arc::new(crate::runtime::FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));

        let handle = crate::agent::adapter::codex::session_index::spawn_watch(
            index_path,
            "thread-id".into(),
            pty_id.to_string(),
            sink_dyn,
            stop,
        );
        handle.join().expect("join watcher");

        let titles: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == AGENT_SESSION_TITLE)
            .map(|(_, payload)| payload)
            .collect();
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["source"], "ai-generated");
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
    fn rename_agent_session_rejects_agent_exit_after_successful_write() {
        let (state, _sink) = BackendState::with_fake_sink();
        let writes = Arc::new(Mutex::new(Vec::new()));
        let agents = state.agents.clone();
        state.pty.insert(
            "pty-1".to_string(),
            make_capturing_session_with_hook(
                writes.clone(),
                Some(Arc::new(move || {
                    agents.remove("pty-1");
                })),
            ),
        );
        state.agents.insert_agent_type_for_test(
            state.transcripts.clone(),
            "pty-1".to_string(),
            AgentType::ClaudeCode,
        );

        let result = state.rename_agent_session(rename_request("exited"));

        let err = result.expect_err("missing agent after write should reject");
        assert_eq!(err.reason, RenameAgentSessionErrorReason::NoLiveAgent);
        assert_eq!(captured_string(&writes), "/rename exited\r");
    }

    #[test]
    fn rename_agent_session_does_not_record_codex_pending_rename_after_exit() {
        let (state, _sink) = BackendState::with_fake_sink();
        let pty_id = "pty-codex-exit-after-write";
        let writes = Arc::new(Mutex::new(Vec::new()));
        let agents = state.agents.clone();
        state.pty.insert(
            pty_id.to_string(),
            make_capturing_session_with_hook(
                writes.clone(),
                Some(Arc::new(move || {
                    agents.remove(pty_id);
                })),
            ),
        );
        state.agents.insert_agent_type_for_test(
            state.transcripts.clone(),
            pty_id.to_string(),
            AgentType::Codex,
        );

        let result = state.rename_agent_session(rename_request_for_pty(pty_id, "exited-codex"));

        let err = result.expect_err("missing Codex after write should reject");
        assert_eq!(err.reason, RenameAgentSessionErrorReason::NoLiveAgent);
        assert_eq!(captured_string(&writes), "/rename exited-codex\r");

        let dir = tempfile::tempdir().expect("tempdir");
        let index_path = dir.path().join("session_index.jsonl");
        std::fs::write(
            &index_path,
            r#"{"id":"thread-id","thread_name":"exited-codex","updated_at":"2026-05-23T00:00:00Z"}"#,
        )
        .expect("write session index");
        let sink: Arc<crate::runtime::FakeEventSink> =
            Arc::new(crate::runtime::FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));

        let handle = crate::agent::adapter::codex::session_index::spawn_watch(
            index_path,
            "thread-id".into(),
            pty_id.to_string(),
            sink_dyn,
            stop,
        );
        handle.join().expect("join watcher");

        let titles: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == AGENT_SESSION_TITLE)
            .map(|(_, payload)| payload)
            .collect();
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["source"], "ai-generated");
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
