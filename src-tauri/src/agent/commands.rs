//! Tauri commands for agent detection

use super::detector::detect_agent;
use super::types::AgentDetectedEvent;
use crate::terminal::PtyState;

/// Detect which agent is running in a PTY session
///
/// Looks up the PTY session's child PID and traverses the process tree
/// to identify coding agents (Claude Code, Codex, Aider).
///
/// # Arguments
/// * `state` - Shared PTY state containing active sessions
/// * `session_id` - PTY session ID to check
///
/// # Returns
/// * `Ok(Some(event))` - Agent detected with details
/// * `Ok(None)` - No agent detected in this session
/// * `Err(msg)` - Session not found or other error
#[tauri::command]
pub async fn detect_agent_in_session(
    state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<Option<AgentDetectedEvent>, String> {
    // Get the child PID from the PTY session
    let pid = state
        .get_pid(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    // Detect agent in the process tree
    match detect_agent(pid) {
        Some((agent_type, agent_pid)) => Ok(Some(AgentDetectedEvent {
            session_id,
            agent_type,
            pid: agent_pid,
        })),
        None => Ok(None),
    }
}
