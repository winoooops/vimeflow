//! Agent event emission helpers.

use crate::agent::types::{
    AgentCwdEvent, AgentSessionTitleEvent, AgentStatusEvent, AgentToolCallEvent, AgentTurnEvent,
};
use crate::runtime::{serialize_event, EventSink};

#[allow(dead_code)] // Used by title-sync adapters added in follow-up tasks
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

pub(crate) fn emit_agent_cwd(
    events: &dyn EventSink,
    payload: &AgentCwdEvent,
) -> Result<(), String> {
    events.emit_json("agent-cwd", serialize_event(payload)?)
}

#[allow(dead_code)] // Used by title-sync adapters added in follow-up tasks
pub(crate) fn emit_agent_session_title(
    events: &dyn EventSink,
    payload: &AgentSessionTitleEvent,
) -> Result<(), String> {
    events.emit_json(AGENT_SESSION_TITLE, serialize_event(payload)?)
}
