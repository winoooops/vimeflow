//! Tauri commands for agent detection

use super::detector::detect_agent;
use super::types::AgentDetectedEvent;
#[cfg(not(test))]
use crate::runtime::BackendState;
use crate::terminal::PtyState;

/// Escape hatch for E2E (and any future debugging) — skip the /proc scan
/// and return no detection. The detector is scoped to the queried PTY's
/// process tree, but this still gives E2E and debugging flows a deterministic
/// off-switch for machines with unusual /proc behavior.
fn agent_detection_disabled() -> bool {
    std::env::var_os("VIMEFLOW_DISABLE_AGENT_DETECTION").is_some()
}

/// Detect which agent is running in a PTY session
#[cfg(not(test))]
#[tauri::command]
pub async fn detect_agent_in_session(
    state: tauri::State<'_, std::sync::Arc<BackendState>>,
    session_id: String,
) -> Result<Option<AgentDetectedEvent>, String> {
    state.detect_agent_in_session(session_id).await
}

pub(crate) async fn detect_agent_in_session_inner(
    state: &PtyState,
    session_id: String,
) -> Result<Option<AgentDetectedEvent>, String> {
    if agent_detection_disabled() {
        return Ok(None);
    }

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
