//! Terminal event emission helpers.

use crate::runtime::{serialize_event, EventSink};

use super::types::{
    BurnerForegroundEvent, PtyDataEvent, PtyErrorEvent, PtyExitEvent, PtyProgressEvent,
};

pub(crate) fn emit_pty_data(events: &dyn EventSink, payload: &PtyDataEvent) -> Result<(), String> {
    events.emit_json("pty-data", serialize_event(payload)?)
}

pub(crate) fn emit_pty_exit(events: &dyn EventSink, payload: &PtyExitEvent) -> Result<(), String> {
    events.emit_json("pty-exit", serialize_event(payload)?)
}

pub(crate) fn emit_pty_progress(
    events: &dyn EventSink,
    payload: &PtyProgressEvent,
) -> Result<(), String> {
    events.emit_json("pty-progress", serialize_event(payload)?)
}

pub(crate) fn emit_pty_error(
    events: &dyn EventSink,
    payload: &PtyErrorEvent,
) -> Result<(), String> {
    events.emit_json("pty-error", serialize_event(payload)?)
}

pub(crate) fn emit_burner_foreground(
    events: &dyn EventSink,
    payload: &BurnerForegroundEvent,
) -> Result<(), String> {
    events.emit_json("burner-foreground", serialize_event(payload)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::types::{PtyProgressEvent, PtyProgressState};

    #[test]
    fn test_emit_pty_progress_uses_progress_channel() {
        let events = crate::runtime::FakeEventSink::new();

        emit_pty_progress(
            &events,
            &PtyProgressEvent {
                session_id: "pty-1".to_string(),
                state: PtyProgressState::Normal,
                value: Some(42),
            },
        )
        .expect("emit progress");

        assert_eq!(events.count("pty-progress"), 1);
        assert_eq!(events.recorded()[0].1["value"], 42);
    }
}
