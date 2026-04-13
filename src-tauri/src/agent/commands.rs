//! Tauri commands for agent detection

use super::detector::detect_agent;
use super::types::AgentDetectedEvent;
use crate::terminal::PtyState;

/// Detect which agent is running in a PTY session
#[tauri::command]
pub async fn detect_agent_in_session(
    state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<Option<AgentDetectedEvent>, String> {
    let pid = state
        .get_pid(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    match detect_agent(pid) {
        Some((agent_type, agent_pid)) => Ok(Some(AgentDetectedEvent {
            session_id,
            agent_type,
            pid: agent_pid,
        })),
        None => Ok(None),
    }
}
