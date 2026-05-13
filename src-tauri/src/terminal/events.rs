//! Terminal event emission helpers.

use crate::runtime::{serialize_event, EventSink};

use super::types::{PtyDataEvent, PtyErrorEvent, PtyExitEvent};

pub(crate) fn emit_pty_data(events: &dyn EventSink, payload: &PtyDataEvent) -> Result<(), String> {
    events.emit_json("pty-data", serialize_event(payload)?)
}

pub(crate) fn emit_pty_exit(events: &dyn EventSink, payload: &PtyExitEvent) -> Result<(), String> {
    events.emit_json("pty-exit", serialize_event(payload)?)
}

pub(crate) fn emit_pty_error(
    events: &dyn EventSink,
    payload: &PtyErrorEvent,
) -> Result<(), String> {
    events.emit_json("pty-error", serialize_event(payload)?)
}
