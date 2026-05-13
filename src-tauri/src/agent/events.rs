//! Agent event emission helpers.

use crate::agent::types::{AgentStatusEvent, AgentToolCallEvent, AgentTurnEvent};
use crate::runtime::{serialize_event, EventSink};

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
