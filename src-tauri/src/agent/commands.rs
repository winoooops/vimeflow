//! Tauri commands for agent detection

use super::detector::detect_agent;
use super::types::AgentDetectedEvent;
use crate::terminal::PtyState;

/// Escape hatch for E2E (and any future debugging) — skip the /proc scan
/// and return no detection. The current detector (see #71) is host-global,
/// which means it attributes unrelated claude processes on the dev box to
/// whatever PTY is asking. Setting this env var short-circuits detection
/// so non-agent E2E suites aren't destabilized by real Claude Code CLI
/// sessions running in other terminals.
fn agent_detection_disabled() -> bool {
    std::env::var_os("VIMEFLOW_DISABLE_AGENT_DETECTION").is_some()
}

/// Detect which agent is running in a PTY session
#[tauri::command]
pub async fn detect_agent_in_session(
    state: tauri::State<'_, PtyState>,
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
