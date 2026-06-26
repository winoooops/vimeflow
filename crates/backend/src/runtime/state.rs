use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

#[cfg(feature = "e2e-test")]
use rusqlite::{params, Connection};

use crate::agent::types::{
    AgentStatusEvent, AgentTurnEvent, AgentType, RenameAgentSessionError,
    RenameAgentSessionErrorReason, RenameAgentSessionRequest,
};
use crate::agent::{sanitize_title, AgentWatcherState, TranscriptState};
use crate::git::watcher::GitWatcherState;
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
    app_data_dir: PathBuf,
    pty: PtyState,
    sessions: Arc<SessionCache>,
    workspace_layouts: Arc<WorkspaceLayoutCache>,
    agents: AgentWatcherState,
    transcripts: TranscriptState,
    git: GitWatcherState,
    events: Arc<dyn EventSink>,
    // Durable kimi plan-usage consent file. The in-memory flag is the
    // app-global `agent::kimi_usage_consent`; this is where it persists.
    kimi_usage_consent_path: PathBuf,
    #[cfg(any(test, feature = "e2e-test"))]
    _test_cache_dir: Option<tempfile::TempDir>,
}

impl BackendState {
    pub fn new(app_data_dir: PathBuf, events: Arc<dyn EventSink>) -> Self {
        if let Err(err) = std::fs::create_dir_all(&app_data_dir) {
            log::warn!(
                "BackendState::new: failed to create app data dir {}: {err}",
                app_data_dir.display()
            );
        }
        let cache_path = app_data_dir.join("sessions.json");
        let layouts_path = app_data_dir.join("workspace-layouts.json");
        let kimi_usage_consent_path = app_data_dir.join("kimi-usage-consent.json");
        Self {
            app_data_dir: app_data_dir.clone(),
            pty: PtyState::new(),
            sessions: Arc::new(
                SessionCache::load_or_recover(cache_path).with_app_data_dir(app_data_dir),
            ),
            workspace_layouts: Arc::new(WorkspaceLayoutCache::new(layouts_path)),
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
            kimi_usage_consent_path,
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

    pub fn set_raw_pty_bytes(
        &self,
        request: crate::terminal::types::SetRawPtyBytesRequest,
    ) -> Result<(), String> {
        crate::terminal::commands::set_raw_pty_bytes_inner(&self.pty, request)
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

    /// Load the persisted kimi plan-usage consent flag into memory. Main-
    /// invoked at startup (not renderer), like `load_workspace_layout`.
    pub fn load_kimi_usage_consent(&self) {
        crate::agent::kimi_usage_consent::load_into_memory(&self.kimi_usage_consent_path);
    }

    /// Set + persist the kimi plan-usage consent flag. The fetch path only
    /// calls `/usages` while this is ON; an error means the opt-in was not
    /// durably stored, so the caller can surface it rather than show it as on.
    pub fn set_kimi_usage_consent(&self, enabled: bool) -> Result<(), String> {
        crate::agent::kimi_usage_consent::set_and_persist(&self.kimi_usage_consent_path, enabled)
            .map_err(|e| format!("persist kimi usage consent: {e}"))
    }

    /// The current kimi plan-usage consent flag, for the renderer to render the
    /// gate's initial state.
    pub fn get_kimi_usage_consent(&self) -> bool {
        crate::agent::kimi_usage_consent::usage_consent_enabled()
    }

    /// Request a one-shot plan-usage refresh on every live kimi session — the UI
    /// "Retry" path, which re-attempts a failed fetch without a new turn.
    pub fn refresh_kimi_usage(&self) {
        crate::agent::kimi_usage_consent::request_refresh()
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

    pub fn file_exists(
        &self,
        request: crate::filesystem::types::FileExistsRequest,
    ) -> Result<bool, String> {
        crate::filesystem::exists::file_exists_inner(request)
    }

    pub fn write_file(
        &self,
        request: crate::filesystem::types::WriteFileRequest,
    ) -> Result<(), String> {
        crate::filesystem::write::write_file_inner(request)
    }

    pub fn rename_path(
        &self,
        request: crate::filesystem::types::RenamePathRequest,
    ) -> Result<(), String> {
        crate::filesystem::mutate::rename_path_inner(request)
    }

    pub fn delete_path(
        &self,
        request: crate::filesystem::types::DeletePathRequest,
    ) -> Result<(), String> {
        crate::filesystem::mutate::delete_path_inner(request)
    }

    pub async fn git_status(&self, cwd: String) -> Result<crate::git::GitStatusResponse, String> {
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
        let detected =
            crate::agent::commands::detect_agent_in_session_inner(&self.pty, session_id.clone())
                .await?;

        #[cfg(feature = "e2e-test")]
        if detected.is_none() {
            if let Some(agent_type) = self.agents.agent_type_for_pty(&session_id) {
                return Ok(Some(crate::agent::types::AgentDetectedEvent {
                    pid: self.pty.get_pid(&session_id).unwrap_or(0),
                    session_id,
                    agent_type,
                }));
            }
        }

        Ok(detected)
    }

    pub async fn start_agent_watcher(
        &self,
        session_id: String,
        provider_home_override: Option<PathBuf>,
    ) -> Result<bool, String> {
        crate::agent::adapter::start_agent_watcher_inner(
            self.pty.clone(),
            self.agents.clone(),
            self.transcripts.clone(),
            self.events.clone(),
            self.app_data_dir.clone(),
            session_id,
            provider_home_override,
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

    #[cfg(feature = "e2e-test")]
    pub fn e2e_agent_bridge_info(&self, session_id: String) -> Result<E2eAgentBridgeInfo, String> {
        let (cwd, bridge_dir, shim_dir) = {
            let sessions = self
                .pty
                .inner_sessions()
                .lock()
                .map_err(|_| "failed to lock sessions".to_string())?;
            let session = sessions
                .get(&session_id)
                .ok_or_else(|| format!("session not found: {session_id}"))?;

            (
                session.cwd.clone(),
                session.bridge_dir.clone(),
                session.shim_dir.clone(),
            )
        };
        let status_file = bridge_dir.as_ref().map(|dir| {
            PathBuf::from(dir.as_str())
                .join("status.json")
                .to_string_lossy()
                .to_string()
        });

        Ok(E2eAgentBridgeInfo {
            session_id: session_id.clone(),
            cwd,
            app_data_dir: self.app_data_dir.to_string_lossy().to_string(),
            bridge_dir,
            status_file,
            shim_dir,
            agent_type: self.agents.agent_type_for_pty(&session_id),
        })
    }

    #[cfg(feature = "e2e-test")]
    pub fn e2e_seed_live_agent(
        &self,
        session_id: String,
        agent_type: AgentType,
    ) -> Result<(), String> {
        if !self.pty.contains(&session_id) {
            return Err(format!("session not found: {session_id}"));
        }

        self.agents
            .insert_agent_type_for_test(self.transcripts.clone(), session_id, agent_type);

        Ok(())
    }

    /// Emit `agent-status` and `agent-turn` events through the backend's
    /// EventSink. Used by E2E tests to exercise the backend serialization
    /// and IPC path for Codex/Kimi without requiring a live agent process or
    /// transcript fixtures. The file-watcher path remains tested separately
    /// for Claude; this helper narrows the gap for agents whose watcher
    /// fixtures are not yet hermetic in CI.
    #[cfg(feature = "e2e-test")]
    pub fn e2e_emit_agent_status(
        &self,
        session_id: String,
        status: AgentStatusEvent,
        num_turns: u32,
    ) -> Result<(), String> {
        if !self.pty.contains(&session_id) {
            return Err(format!("session not found: {session_id}"));
        }

        let turn = AgentTurnEvent {
            session_id: session_id.clone(),
            num_turns,
        };

        let status_payload =
            crate::runtime::event_sink::serialize_event(&status).map_err(|e| format!("{e}"))?;
        let turn_payload =
            crate::runtime::event_sink::serialize_event(&turn).map_err(|e| format!("{e}"))?;

        self.events.emit_json("agent-status", status_payload)?;
        self.events.emit_json("agent-turn", turn_payload)?;
        Ok(())
    }

    /// Set up a hermetic Codex home under `home_dir`, seed the locator
    /// SQLite databases so the Codex watcher can resolve a rollout file for
    /// `session_id`, and start the watcher with `home_dir/.codex` threaded
    /// as an explicit provider-home override. Returns the absolute path to
    /// the empty rollout file the test should write to.
    #[cfg(feature = "e2e-test")]
    pub async fn e2e_start_codex_watcher(
        &self,
        session_id: String,
        home_dir: PathBuf,
    ) -> Result<PathBuf, String> {
        if !self.pty.contains(&session_id) {
            return Err(format!("session not found: {session_id}"));
        }

        let cwd = self
            .pty
            .get_cwd(&session_id)
            .ok_or_else(|| format!("cwd not found for session {session_id}"))?;
        let pty_start = self
            .pty
            .get_started_at(&session_id)
            .ok_or_else(|| format!("start time not found for session {session_id}"))?;

        let codex_home = home_dir.join(".codex");
        let sessions_dir = codex_home
            .join("sessions")
            .join("2026")
            .join("06")
            .join("19");
        let rollout_path = sessions_dir.join(format!("rollout-{session_id}.jsonl"));

        std::fs::create_dir_all(&sessions_dir)
            .map_err(|e| format!("create codex sessions dir: {e}"))?;
        std::fs::write(&rollout_path, b"").map_err(|e| format!("create empty rollout: {e}"))?;

        let since_epoch = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(|e| format!("pty_start before epoch: {e}"))?;
        let secs = since_epoch.as_secs() as i64;
        let nanos = since_epoch.subsec_nanos() as i64;
        let updated_at_ms = secs * 1000 + nanos / 1_000_000;

        let state_db = codex_home.join("state.sqlite");
        let state = Connection::open(&state_db).map_err(|e| format!("open state db: {e}"))?;
        state
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    cwd TEXT,
                    updated_at_ms INTEGER NOT NULL
                );",
            )
            .map_err(|e| format!("create threads table: {e}"))?;
        state
            .execute(
                "INSERT INTO threads (id, rollout_path, cwd, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    format!("tid-e2e-{session_id}"),
                    rollout_path.to_str().ok_or("rollout path is not utf-8")?,
                    cwd,
                    updated_at_ms,
                ],
            )
            .map_err(|e| format!("insert thread row: {e}"))?;

        let logs_db = codex_home.join("logs.sqlite");
        let logs = Connection::open(&logs_db).map_err(|e| format!("open logs db: {e}"))?;
        logs.execute_batch(
            "CREATE TABLE logs (
                id INTEGER PRIMARY KEY,
                ts INTEGER NOT NULL,
                ts_nanos INTEGER NOT NULL,
                level TEXT,
                target TEXT,
                process_uuid TEXT NOT NULL,
                thread_id TEXT
            );
            CREATE INDEX idx_logs_ts ON logs(ts DESC, ts_nanos DESC, id DESC);",
        )
        .map_err(|e| format!("create logs table: {e}"))?;

        let result = self
            .start_agent_watcher(session_id.clone(), Some(codex_home))
            .await;
        result?;

        Ok(rollout_path)
    }

    /// Set up a hermetic Kimi home under `home_dir`, seed the locator
    /// filesystem layout so the Kimi watcher can resolve a wire file for
    /// `session_id`, and start the watcher with `home_dir` threaded as an
    /// explicit provider-home override. Returns the absolute path to the wire
    /// file the test should write to.
    #[cfg(feature = "e2e-test")]
    pub async fn e2e_start_kimi_watcher(
        &self,
        session_id: String,
        home_dir: PathBuf,
    ) -> Result<PathBuf, String> {
        if !self.pty.contains(&session_id) {
            return Err(format!("session not found: {session_id}"));
        }

        let cwd = self
            .pty
            .get_cwd(&session_id)
            .ok_or_else(|| format!("cwd not found for session {session_id}"))?;
        let pty_start = self
            .pty
            .get_started_at(&session_id)
            .ok_or_else(|| format!("start time not found for session {session_id}"))?;

        let since_epoch = pty_start
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(|e| format!("pty_start before epoch: {e}"))?;
        let created_at_ms = since_epoch.as_millis() as u64 + 1000;

        let cwd_path = PathBuf::from(&cwd);
        let basename = cwd_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace");
        let bucket = {
            use sha2::{Digest, Sha256};
            let digest = Sha256::digest(cwd.as_bytes());
            let hex: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
            format!("wd_{basename}_{hex}")
        };
        let session_dir_name = format!("session_e2e_{session_id}");
        let session_dir = home_dir
            .join("sessions")
            .join(&bucket)
            .join(&session_dir_name);
        let wire_path = session_dir.join("agents").join("main").join("wire.jsonl");

        std::fs::create_dir_all(wire_path.parent().expect("wire parent"))
            .map_err(|e| format!("create kimi wire dirs: {e}"))?;
        std::fs::write(
            &wire_path,
            format!("{{\"type\":\"metadata\",\"created_at\":{created_at_ms}}}\n"),
        )
        .map_err(|e| format!("create kimi wire: {e}"))?;

        let index_path = home_dir.join("session_index.jsonl");
        std::fs::write(
            &index_path,
            format!(
                "{}\n",
                serde_json::json!({
                    "sessionId": session_dir_name,
                    "sessionDir": session_dir.to_str().ok_or("session dir is not utf-8")?,
                    "workDir": cwd,
                })
            ),
        )
        .map_err(|e| format!("create kimi index: {e}"))?;

        let result = self.start_agent_watcher(session_id, Some(home_dir)).await;
        result?;

        Ok(wire_path)
    }
}

#[cfg(feature = "e2e-test")]
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eAgentBridgeInfo {
    pub session_id: String,
    pub cwd: String,
    pub app_data_dir: String,
    pub bridge_dir: Option<String>,
    pub status_file: Option<String>,
    pub shim_dir: Option<String>,
    pub agent_type: Option<AgentType>,
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
            bridge_dir: None,
            shim_dir: None,
            generation: 0,
            ring: Arc::new(Mutex::new(RingBuffer::new(64))),
            cancelled: Arc::new(AtomicBool::new(false)),
            emit_raw_bytes: Arc::new(AtomicBool::new(false)),
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

    /// The consent IPC round-trips through `BackendState`: set persists +
    /// flips the global, get reflects it, and a fresh load from the same
    /// app-data dir recovers it. Serialized against the global consent flag.
    #[test]
    fn kimi_usage_consent_set_get_and_reload() {
        let _guard = crate::agent::kimi_usage_consent::test_serial_guard();
        let (state, _sink) = BackendState::with_fake_sink();
        assert!(!state.get_kimi_usage_consent(), "default OFF");

        state.set_kimi_usage_consent(true).expect("persist on");
        assert!(state.get_kimi_usage_consent(), "set reflects in get");

        // Reloading the same app-data dir (e.g. next launch) recovers ON;
        // file-independent recovery is proven in the consent module's tests.
        state.load_kimi_usage_consent();
        assert!(
            state.get_kimi_usage_consent(),
            "reload keeps persisted true"
        );

        state.set_kimi_usage_consent(false).expect("persist off");
        assert!(!state.get_kimi_usage_consent());
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
