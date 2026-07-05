//! Agent event emission helpers.

use std::sync::Arc;

use crate::agent::types::{
    AgentCwdEvent, AgentLifecycleEvent, AgentPhase, AgentReplyEvent, AgentSessionTitleEvent,
    AgentStatusEvent, AgentToolCallEvent, AgentTurnEvent,
};
use crate::runtime::{serialize_event, EventSink};

pub const AGENT_SESSION_TITLE: &str = "agent-session-title";

pub(crate) fn emit_agent_status(
    events: &dyn EventSink,
    payload: &AgentStatusEvent,
) -> Result<(), String> {
    events.emit_json("agent-status", serialize_event(payload)?)
}

pub(crate) fn emit_agent_tool_call(
    events: &dyn EventSink,
    payload: &AgentToolCallEvent,
) -> Result<(), String> {
    events.emit_json("agent-tool-call", serialize_event(payload)?)
}

pub(crate) fn emit_agent_turn(
    events: &dyn EventSink,
    payload: &AgentTurnEvent,
) -> Result<(), String> {
    events.emit_json("agent-turn", serialize_event(payload)?)
}

pub(crate) fn emit_agent_reply(
    events: &dyn EventSink,
    payload: &AgentReplyEvent,
) -> Result<(), String> {
    events.emit_json("agent-reply", serialize_event(payload)?)
}

pub(crate) fn emit_agent_cwd(
    events: &dyn EventSink,
    payload: &AgentCwdEvent,
) -> Result<(), String> {
    events.emit_json("agent-cwd", serialize_event(payload)?)
}

pub(crate) fn emit_agent_session_title(
    events: &dyn EventSink,
    payload: &AgentSessionTitleEvent,
) -> Result<(), String> {
    events.emit_json(AGENT_SESSION_TITLE, serialize_event(payload)?)
}

#[allow(dead_code)] // wired by the per-adapter lifecycle emit
pub(crate) fn emit_agent_lifecycle(
    events: &dyn EventSink,
    payload: &AgentLifecycleEvent,
) -> Result<(), String> {
    events.emit_json("agent-lifecycle", serialize_event(payload)?)
}

#[allow(dead_code)] // wired by the per-adapter lifecycle emit
pub(crate) fn emit_lifecycle_on_change(
    events: &dyn EventSink,
    session_id: &str,
    agent_session_id: &str,
    last: &mut Option<AgentPhase>,
    phase: AgentPhase,
) {
    if *last == Some(phase) {
        return;
    }
    *last = Some(phase);
    let payload = AgentLifecycleEvent {
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.to_string(),
        phase,
    };
    if let Err(e) = emit_agent_lifecycle(events, &payload) {
        log::warn!("Failed to emit agent-lifecycle event: {}", e);
    }
}

/// Route a derived phase: emit live (edge-triggered) once replay is done,
/// else accumulate the settled phase for the one-shot boundary flush.
pub(crate) fn record_lifecycle(
    phase: AgentPhase,
    session_id: &str,
    agent_session_id: &str,
    events: &Arc<dyn EventSink>,
    last_phase: &mut Option<AgentPhase>,
    replay_phase: &mut Option<AgentPhase>,
    replay_done: bool,
) {
    if replay_done {
        emit_lifecycle_on_change(
            events.as_ref(),
            session_id,
            agent_session_id,
            last_phase,
            phase,
        );
    } else {
        *replay_phase = Some(phase);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::agent::types::AgentPhase;
    use crate::runtime::FakeEventSink;

    use super::emit_lifecycle_on_change;

    #[test]
    fn lifecycle_emits_only_on_change() {
        let sink = Arc::new(FakeEventSink::new());
        let mut last: Option<AgentPhase> = None;
        emit_lifecycle_on_change(&*sink, "sid", "agent-1", &mut last, AgentPhase::Running);
        emit_lifecycle_on_change(&*sink, "sid", "agent-1", &mut last, AgentPhase::Running); // dup
        emit_lifecycle_on_change(&*sink, "sid", "agent-1", &mut last, AgentPhase::Idle);
        assert_eq!(sink.count("agent-lifecycle"), 2); // Running, Idle — the dup is suppressed
        assert_eq!(last, Some(AgentPhase::Idle));
    }
}
