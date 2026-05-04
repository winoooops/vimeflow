//! Agent adapter abstraction.
//!
//! The trait carries provider hooks only. User-facing lifecycle methods live
//! on `dyn AgentAdapter<R>`, and the watcher orchestration body lives in
//! `base::start_for`.

pub mod base;
pub mod claude_code;
pub mod types;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use tauri::AppHandle;

pub use base::AgentWatcherState;

use crate::agent::detector::detect_agent;
use crate::agent::types::AgentType;
use crate::terminal::PtyState;
use base::TranscriptHandle;
use claude_code::ClaudeCodeAdapter;
use types::{BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError};

/// Provider hooks for one CLI coding agent.
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn agent_type(&self) -> AgentType;

    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError>;

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String>;

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;

    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}

impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_type(agent_type: AgentType) -> Result<Arc<Self>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            other => Ok(Arc::new(NoOpAdapter::new(other))),
        }
    }

    pub fn start(
        self: Arc<Self>,
        app: AppHandle<R>,
        session_id: String,
        cwd: PathBuf,
        pid: u32,
        pty_start: SystemTime,
        state: AgentWatcherState,
    ) -> Result<(), String> {
        base::start_for(self, app, session_id, cwd, pid, pty_start, state)
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

impl<R: tauri::Runtime> AgentAdapter<R> for NoOpAdapter {
    fn agent_type(&self) -> AgentType {
        self.agent_type.clone()
    }

    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
        Ok(StatusSource {
            path: ctx
                .cwd
                .join(".vimeflow")
                .join("sessions")
                .join(ctx.session_id)
                .join("status.json"),
            trust_root: ctx.cwd.to_path_buf(),
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
        _: AppHandle<R>,
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
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AgentWatcherState>,
    pty_state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let cwd = pty_state
        .get_cwd(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let pid = pty_state
        .get_pid(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let pty_start = pty_state
        .get_started_at(&session_id)
        .ok_or_else(|| format!("PTY session not found: {}", session_id))?;

    let agent_type = detect_agent(pid)
        .map(|(agent_type, _)| agent_type)
        .ok_or_else(|| format!("no agent detected in PTY session {}", session_id))?;

    let adapter = <dyn AgentAdapter<tauri::Wry>>::for_type(agent_type)?;
    adapter.start(
        app_handle,
        session_id,
        PathBuf::from(cwd),
        pid,
        pty_start,
        (*state).clone(),
    )
}

/// Stop watching an agent status source.
#[tauri::command]
pub async fn stop_agent_watcher(
    state: tauri::State<'_, AgentWatcherState>,
    session_id: String,
) -> Result<(), String> {
    if <dyn AgentAdapter<tauri::Wry>>::stop(&state, &session_id) {
        log::info!("Stopped watching statusline for session {}", session_id);
        Ok(())
    } else {
        Err(format!("No active watcher for session: {}", session_id))
    }
}

#[cfg(test)]
mod noop_tests {
    use super::*;
    use tauri::test::MockRuntime;

    #[test]
    fn agent_type_round_trips() {
        let adapter = NoOpAdapter::new(AgentType::Codex);
        assert!(matches!(
            <NoOpAdapter as AgentAdapter<MockRuntime>>::agent_type(&adapter),
            AgentType::Codex
        ));
    }

    #[test]
    fn status_source_uses_claude_shaped_path() {
        use std::time::SystemTime;

        let adapter = NoOpAdapter::new(AgentType::Aider);
        let cwd = PathBuf::from("/tmp/ws");
        let ctx = BindContext {
            session_id: "sid",
            cwd: &cwd,
            pid: 0,
            pty_start: SystemTime::UNIX_EPOCH,
        };
        let src = <NoOpAdapter as AgentAdapter<MockRuntime>>::status_source(&adapter, &ctx)
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
        assert!(
            <NoOpAdapter as AgentAdapter<MockRuntime>>::parse_status(&adapter, "sid", "{}")
                .is_err()
        );
    }
}
