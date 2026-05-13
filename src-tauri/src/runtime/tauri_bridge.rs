use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::event_sink::EventSink;

/// Adapter from the runtime-neutral event trait to Tauri's event API.
pub struct TauriEventSink {
    handle: AppHandle,
}

impl TauriEventSink {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.handle
            .emit(event, payload)
            .map_err(|err| format!("tauri emit {event}: {err}"))
    }
}
