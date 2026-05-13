use std::sync::{Arc, Mutex};

use serde_json::Value;
use vimeflow_lib::runtime::EventSink;

pub struct RecordingEventSink {
    recorded: Mutex<Vec<(String, Value)>>,
}

impl RecordingEventSink {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            recorded: Mutex::new(Vec::new()),
        })
    }

    pub fn recorded(&self) -> Vec<(String, Value)> {
        self.recorded.lock().expect("recording sink lock").clone()
    }
}

impl EventSink for RecordingEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.recorded
            .lock()
            .map_err(|err| format!("recording sink lock: {err}"))?
            .push((event.to_string(), payload));
        Ok(())
    }
}
