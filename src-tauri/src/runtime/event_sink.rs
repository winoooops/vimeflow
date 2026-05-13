use serde::Serialize;
use serde_json::Value;

use crate::agent::adapter::claude_code::test_runners::types::TestRunSnapshot;
use crate::agent::types::{AgentStatusEvent, AgentToolCallEvent, AgentTurnEvent};
use crate::git::watcher::GitStatusChangedPayload;
use crate::terminal::types::{PtyDataEvent, PtyErrorEvent, PtyExitEvent};

/// Runtime-neutral event emission.
///
/// Only `emit_json` is required; typed helpers preserve the current event
/// names and serde payload shapes at call sites.
pub trait EventSink: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String>;

    fn emit_pty_data(&self, payload: &PtyDataEvent) -> Result<(), String> {
        self.emit_json("pty-data", serialize(payload)?)
    }

    fn emit_pty_exit(&self, payload: &PtyExitEvent) -> Result<(), String> {
        self.emit_json("pty-exit", serialize(payload)?)
    }

    fn emit_pty_error(&self, payload: &PtyErrorEvent) -> Result<(), String> {
        self.emit_json("pty-error", serialize(payload)?)
    }

    fn emit_agent_status(&self, payload: &AgentStatusEvent) -> Result<(), String> {
        self.emit_json("agent-status", serialize(payload)?)
    }

    fn emit_agent_tool_call(&self, payload: &AgentToolCallEvent) -> Result<(), String> {
        self.emit_json("agent-tool-call", serialize(payload)?)
    }

    fn emit_agent_turn(&self, payload: &AgentTurnEvent) -> Result<(), String> {
        self.emit_json("agent-turn", serialize(payload)?)
    }

    fn emit_test_run(&self, payload: &TestRunSnapshot) -> Result<(), String> {
        self.emit_json("test-run", serialize(payload)?)
    }

    fn emit_git_status_changed(&self, cwds: Vec<String>) -> Result<(), String> {
        let payload = GitStatusChangedPayload { cwds };
        self.emit_json("git-status-changed", serialize(&payload)?)
    }
}

#[inline]
fn serialize<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| format!("event serialize: {err}"))
}

#[cfg(any(test, feature = "e2e-test"))]
#[path = "test_event_sink.rs"]
mod test_event_sink;

#[cfg(any(test, feature = "e2e-test"))]
pub type FakeEventSink = test_event_sink::RecordingEventSink;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fake_event_sink_records_emit_json() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({"session_id": "s1", "data": "hello"}))
            .expect("emit");

        let recorded = sink.recorded();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "pty-data");
        assert_eq!(recorded[0].1["session_id"], "s1");
    }

    #[test]
    fn fake_event_sink_count_filters_by_name() {
        let sink = FakeEventSink::new();
        sink.emit_json("pty-data", json!({})).expect("emit");
        sink.emit_json("pty-exit", json!({})).expect("emit");
        sink.emit_json("pty-data", json!({})).expect("emit");

        assert_eq!(sink.count("pty-data"), 2);
        assert_eq!(sink.count("pty-exit"), 1);
        assert_eq!(sink.count("nope"), 0);
    }

    #[test]
    fn fake_event_sink_concurrent_emits_record_all_events() {
        use std::thread;

        let sink = FakeEventSink::new();
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let sink = sink.clone();
                thread::spawn(move || {
                    sink.emit_json(&format!("evt-{i}"), json!({}))
                        .expect("emit");
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("join");
        }

        assert_eq!(sink.recorded().len(), 10);
    }
}
