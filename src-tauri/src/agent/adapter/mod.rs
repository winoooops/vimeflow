//! Agent adapter abstraction.
//!
//! The trait carries provider hooks only. User-facing lifecycle methods live
//! on `dyn AgentAdapter`, and the watcher orchestration body lives in
//! `base::start_for`.

pub mod base;
pub mod claude_code;
pub mod codex;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

pub use base::AgentWatcherState;

use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
#[cfg(not(test))]
use crate::runtime::BackendState;
use crate::runtime::EventSink;
use crate::terminal::types::SessionId;
use crate::terminal::PtyState;
use base::{TranscriptHandle, TranscriptState};
use claude_code::ClaudeCodeAdapter;
use codex::CodexAdapter;
use types::{ParsedStatus, StatusSource, ValidateTranscriptError};

/// Provider hooks for one CLI coding agent.
pub trait AgentAdapter: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;

    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>;

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;

    fn tail_transcript(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}

impl dyn AgentAdapter {
    pub fn for_attach(
        agent_type: AgentType,
        pid: u32,
        pty_start: SystemTime,
    ) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new(pid, pty_start))),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }

    pub fn start(
        self: Arc<Self>,
        events: Arc<dyn EventSink>,
        pty_state: PtyState,
        transcript_state: TranscriptState,
        session_id: String,
        cwd: PathBuf,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        base::start_for(
            self,
            events,
            pty_state,
            transcript_state,
            session_id,
            cwd,
            state,
        )
    }

    pub fn stop(state: &AgentWatcherState, session_id: &str) -> bool {
        state.remove(session_id)
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

impl AgentAdapter for NoOpAdapter {
    fn agent_type(&self) -> AgentType {
        self.agent_type.clone()
    }

    fn status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String> {
        Ok(StatusSource {
            path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
        })
    }

    fn parse_status(&self, _: &str, _: &str) -> Result<ParsedStatus, String> {
        Err(format!(
            "{:?} adapter has no status parser",
            self.agent_type
        ))
    }

    fn validate_transcript(&self, _: &str) -> Result<PathBuf, ValidateTranscriptError> {
        Err(ValidateTranscriptError::Other(format!(
            "{:?} adapter has no transcript validator",
            self.agent_type
        )))
    }

    fn tail_transcript(
        &self,
        _: Arc<dyn EventSink>,
        _: String,
        _: Option<PathBuf>,
        _: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        Err(format!(
            "{:?} adapter has no transcript tailer",
            self.agent_type
        ))
    }
}

/// Start watching an agent status source for a PTY session.
#[cfg(not(test))]
#[tauri::command]
pub async fn start_agent_watcher(
    state: tauri::State<'_, Arc<BackendState>>,
    session_id: String,
) -> Result<(), String> {
    state.start_agent_watcher(session_id).await
}

pub(crate) async fn start_agent_watcher_inner(
    pty_state: PtyState,
    watcher_state: AgentWatcherState,
    transcript_state: TranscriptState,
    events: Arc<dyn EventSink>,
    session_id: String,
) -> Result<(), String> {
    let (cwd, _shell_pid, pty_start, agent_type, agent_pid) =
        resolve_bind_inputs(&pty_state, &session_id, detect_agent)?;

    let adapter = <dyn AgentAdapter>::for_attach(agent_type, agent_pid, pty_start)?;
    let cwd_path = PathBuf::from(cwd);
    // `adapter.start(...)` walks into `base::start_for`, which calls
    // `adapter.status_source(...)`. For codex sessions, that call runs a
    // bounded retry (up to 5 attempts × 100 ms inter-attempt sleeps)
    // using `std::thread::sleep` because codex commits its `logs` row
    // ~300ms after the rollout file opens.
    // `path_security::ensure_status_source_under_trust_root` does
    // synchronous `canonicalize` filesystem I/O. Running either on a
    // tokio worker thread starves other futures scheduled on the same
    // worker; mirror the pattern at `src/git/watcher.rs:399` and hop
    // onto the blocking pool so the async thread returns immediately.
    tokio::task::spawn_blocking(move || {
        adapter.start(
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
) -> Result<(String, u32, std::time::SystemTime, AgentType, u32), String>
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

    Ok((cwd, shell_pid, pty_start, agent_type, agent_pid))
}

/// Stop watching an agent status source.
#[cfg(not(test))]
#[tauri::command]
pub async fn stop_agent_watcher(
    state: tauri::State<'_, Arc<BackendState>>,
    session_id: String,
) -> Result<(), String> {
    state.stop_agent_watcher(session_id).await
}

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
    fn status_source_uses_claude_shaped_path() {
        let adapter = NoOpAdapter::new(AgentType::Aider);
        let cwd = PathBuf::from("/tmp/ws");
        let src = <NoOpAdapter as AgentAdapter>::status_source(&adapter, &cwd, "sid")
            .expect("noop adapter always resolves a status source");
        assert_eq!(
            src.path,
            cwd.join(".vimeflow")
                .join("sessions")
                .join("sid")
                .join("status.json")
        );
        assert_eq!(src.trust_root, cwd);
    }

    #[test]
    fn parse_status_returns_err() {
        let adapter = NoOpAdapter::new(AgentType::Generic);
        assert!(<NoOpAdapter as AgentAdapter>::parse_status(&adapter, "sid", "{}").is_err());
    }

    #[test]
    fn for_attach_returns_real_codex_adapter() {
        let adapter =
            <dyn AgentAdapter>::for_attach(AgentType::Codex, 12345, SystemTime::UNIX_EPOCH)
                .expect("codex adapter should construct");
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;

        let parsed = adapter
            .parse_status("pty-codex", raw)
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

        let (_cwd, shell_pid, _pty_start, agent_type, agent_pid) =
            resolve_bind_inputs(&state, &session_id, |_| Some((AgentType::Codex, 4242)))
                .expect("bind inputs");

        assert!(matches!(agent_type, AgentType::Codex));
        assert_ne!(shell_pid, agent_pid);
        assert_eq!(agent_pid, 4242);
    }
}
