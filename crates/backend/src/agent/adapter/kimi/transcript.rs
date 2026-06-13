//! Transcript tailer for kimi-code `wire.jsonl` files.
//!
//! Tails the persisted `wire.jsonl` and emits `agent-tool-call` /
//! `agent-turn` / `agent-lifecycle` events. Mirrors `codex/transcript.rs`
//! structure (validate-under-root + `TranscriptTailService` driven by a
//! per-session [`KimiTranscriptDecoder`]) without the codex test-runner
//! machinery (deferred per the kimi state spec).

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use super::transcript_dto::{KimiLineDto, KimiLoopEventType, KimiRecordType};
use super::types::default_kimi_home;
use crate::agent::adapter::base::{TranscriptDecoder, TranscriptHandle, TranscriptTailService};
use crate::agent::adapter::claude_code::test_runners::timestamps::compute_duration_ms;
use crate::agent::adapter::types::ValidateTranscriptError;
use crate::agent::events::{emit_agent_tool_call, emit_agent_turn, record_lifecycle};
use crate::agent::types::{AgentPhase, AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
use crate::runtime::EventSink;

/// Maximum length for the args summary string.
const MAX_ARGS_LEN: usize = 1024;

struct InFlightToolCall {
    started_at: Instant,
    started_at_iso: String,
    tool: String,
    args: String,
    is_test_file: bool,
}

type InFlightToolCalls = HashMap<String, InFlightToolCall>;

pub(super) fn validate_transcript_path(
    transcript_path: &str,
) -> Result<PathBuf, ValidateTranscriptError> {
    if transcript_path.bytes().any(|b| b == 0) {
        return Err(ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        ));
    }

    let kimi_root = default_kimi_home();
    validate_transcript_path_under_root(transcript_path, &kimi_root)
}

fn validate_transcript_path_under_root(
    transcript_path: &str,
    kimi_root: &Path,
) -> Result<PathBuf, ValidateTranscriptError> {
    let path = PathBuf::from(transcript_path);
    let canonical = fs::canonicalize(&path).map_err(|e| {
        let kind = e.kind();
        if kind == io::ErrorKind::NotFound {
            return ValidateTranscriptError::NotFound(path.clone());
        }
        if kind == io::ErrorKind::PermissionDenied {
            if let Ok(false) = path.try_exists() {
                return ValidateTranscriptError::NotFound(path.clone());
            }
        }
        ValidateTranscriptError::Other(format!(
            "invalid transcript path '{}': {}",
            transcript_path, e
        ))
    })?;

    if !canonical.is_file() {
        return Err(ValidateTranscriptError::NotAFile(canonical));
    }

    let kimi_root = fs::canonicalize(kimi_root).map_err(|e| {
        ValidateTranscriptError::Other(format!(
            "cannot resolve kimi transcript root '{}': {}",
            kimi_root.display(),
            e
        ))
    })?;

    if !canonical.starts_with(&kimi_root) {
        return Err(ValidateTranscriptError::OutsideRoot {
            path: canonical,
            root: kimi_root,
        });
    }

    Ok(canonical)
}

pub(super) fn start_tailing(
    events: Arc<dyn EventSink>,
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
) -> Result<TranscriptHandle, String> {
    let file = File::open(&transcript_path).map_err(|e| {
        format!(
            "Failed to open kimi wire transcript: {}: {}",
            transcript_path.display(),
            e
        )
    })?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let decoder = KimiTranscriptDecoder::new(events, session_id, cwd);
    let service = TranscriptTailService::new(Box::new(decoder), "kimi wire transcript");

    let join_handle = std::thread::spawn(move || {
        service.run(BufReader::new(file), stop_clone);
    });

    Ok(TranscriptHandle::new(stop_flag, join_handle))
}

/// Per-session kimi decoder: owns the in-flight tool-call map, turn count,
/// and the replay-bounded lifecycle slots, turning each complete
/// `wire.jsonl` line into `agent-*` events.
struct KimiTranscriptDecoder {
    events: Arc<dyn EventSink>,
    session_id: String,
    #[allow(dead_code)] // reserved for cwd emission once kimi exposes a cwd channel
    cwd: Option<PathBuf>,
    in_flight: InFlightToolCalls,
    num_turns: u32,
    /// kimi-code's own session identity is not present in `wire.jsonl`; the
    /// PTY session id doubles as the lifecycle identity here.
    last_phase: Option<AgentPhase>,
    replay_phase: Option<AgentPhase>,
    replay_done: bool,
}

impl KimiTranscriptDecoder {
    fn new(events: Arc<dyn EventSink>, session_id: String, cwd: Option<PathBuf>) -> Self {
        Self {
            events,
            session_id,
            cwd,
            in_flight: HashMap::new(),
            num_turns: 0,
            last_phase: None,
            replay_phase: None,
            replay_done: false,
        }
    }
}

impl TranscriptDecoder for KimiTranscriptDecoder {
    fn decode_line(&mut self, line: &str) {
        let dto: KimiLineDto = match serde_json::from_str(line) {
            Ok(dto) => dto,
            Err(_) => return,
        };

        match dto.record_type() {
            KimiRecordType::TurnPrompt => {
                self.process_turn_prompt(&dto);
            }
            KimiRecordType::AppendLoopEvent => {
                self.process_loop_event(&dto);
            }
            _ => {}
        }
    }

    fn on_caught_up(&mut self) {
        if !self.replay_done {
            self.replay_done = true;
            if let Some(phase) = self.replay_phase.take() {
                let mut last = self.last_phase;
                crate::agent::events::emit_lifecycle_on_change(
                    self.events.as_ref(),
                    &self.session_id,
                    &self.session_id,
                    &mut last,
                    phase,
                );
                self.last_phase = last;
            }
        }
    }
}

impl KimiTranscriptDecoder {
    fn process_turn_prompt(&mut self, dto: &KimiLineDto) {
        // Only `origin.kind == "user"` is a real user turn; `injection`
        // turns (permission-mode reminders, etc.) are skipped.
        let is_user = dto
            .origin
            .as_ref()
            .and_then(|o| o.kind.as_deref())
            .map(|kind| kind == "user")
            .unwrap_or(false);
        if !is_user {
            return;
        }

        self.num_turns = self.num_turns.saturating_add(1);
        let event = AgentTurnEvent {
            session_id: self.session_id.clone(),
            num_turns: self.num_turns,
        };
        if let Err(e) = emit_agent_turn(self.events.as_ref(), &event) {
            log::warn!("Failed to emit agent-turn event: {}", e);
        }

        // A new user prompt moves the agent into the running phase.
        self.record_phase(AgentPhase::Running);
    }

    fn process_loop_event(&mut self, dto: &KimiLineDto) {
        let Some(event) = dto.event.as_ref() else {
            return;
        };
        let timestamp = now_iso8601();

        match event.loop_event_type() {
            KimiLoopEventType::ToolCall => {
                let Some(call_id) = event.tool_call_id.as_deref() else {
                    return;
                };
                // Dedup by toolCallId — a replayed START for an already
                // in-flight id is ignored.
                if self.in_flight.contains_key(call_id) {
                    return;
                }
                let tool = event.name.as_deref().unwrap_or("unknown").to_string();
                let args = summarize_tool_args(event);
                let is_test_file = false;

                self.in_flight.insert(
                    call_id.to_string(),
                    InFlightToolCall {
                        started_at: Instant::now(),
                        started_at_iso: timestamp.clone(),
                        tool: tool.clone(),
                        args: args.clone(),
                        is_test_file,
                    },
                );

                self.emit_tool_call(AgentToolCallEvent {
                    session_id: self.session_id.clone(),
                    tool_use_id: call_id.to_string(),
                    tool,
                    args,
                    status: ToolCallStatus::Running,
                    timestamp,
                    duration_ms: 0,
                    is_test_file,
                });
            }
            KimiLoopEventType::ToolResult => {
                let Some(call_id) = event.tool_call_id.as_deref() else {
                    return;
                };
                let Some(call) = self.in_flight.remove(call_id) else {
                    return;
                };
                self.emit_tool_call(AgentToolCallEvent {
                    session_id: self.session_id.clone(),
                    tool_use_id: call_id.to_string(),
                    tool: call.tool,
                    args: call.args,
                    status: ToolCallStatus::Done,
                    timestamp: timestamp.clone(),
                    duration_ms: compute_duration_ms(
                        &call.started_at_iso,
                        &timestamp,
                        call.started_at.elapsed(),
                    ),
                    is_test_file: call.is_test_file,
                });
            }
            KimiLoopEventType::StepEnd => {
                // `end_turn` finish settles the agent into idle.
                if event.finish_reason.as_deref() == Some("end_turn") {
                    self.record_phase(AgentPhase::Idle);
                }
            }
            KimiLoopEventType::Other => {}
        }
    }

    fn record_phase(&mut self, phase: AgentPhase) {
        record_lifecycle(
            phase,
            &self.session_id,
            &self.session_id,
            &self.events,
            &mut self.last_phase,
            &mut self.replay_phase,
            self.replay_done,
        );
    }

    fn emit_tool_call(&self, event: AgentToolCallEvent) {
        if let Err(e) = emit_agent_tool_call(self.events.as_ref(), &event) {
            log::warn!("Failed to emit agent-tool-call event: {}", e);
        }
    }
}

/// Summarize a `tool.call` for the args string: prefer the resolved
/// `display.path`, then `args.path` / `args.command`, then the raw args
/// JSON. Truncated to `MAX_ARGS_LEN`.
fn summarize_tool_args(event: &super::transcript_dto::KimiLoopEventDto) -> String {
    if let Some(path) = event.display.as_ref().and_then(|d| d.path.as_deref()) {
        if !path.is_empty() {
            return truncate_string(path, MAX_ARGS_LEN);
        }
    }
    if let Some(path) = event.args.get("path").and_then(|v| v.as_str()) {
        return truncate_string(path, MAX_ARGS_LEN);
    }
    if let Some(command) = event.args.get("command").and_then(|v| v.as_str()) {
        return truncate_string(command, MAX_ARGS_LEN);
    }
    if event.args.is_null() {
        return String::new();
    }
    truncate_string(&event.args.to_string(), MAX_ARGS_LEN)
}

fn truncate_string(input: &str, max_len: usize) -> String {
    if input.chars().count() <= max_len {
        return input.to_string();
    }
    let end = input
        .char_indices()
        .nth(max_len.saturating_sub(3))
        .map_or(input.len(), |(idx, _)| idx);
    format!("{}...", &input[..end])
}

fn now_iso8601() -> String {
    let now = std::time::SystemTime::now();
    let since_epoch = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0));

    let total_secs = since_epoch.as_secs();
    let days = total_secs / 86_400;
    let secs_of_day = total_secs % 86_400;

    let (year, month, day) = days_to_date(days);
    let hour = secs_of_day / 3_600;
    let minute = (secs_of_day % 3_600) / 60;
    let second = secs_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

fn days_to_date(days_since_epoch: u64) -> (u64, u64, u64) {
    let z = days_since_epoch as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as u64, m as u64, d as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::FakeEventSink;
    use serde_json::Value;
    use std::time::Duration;

    fn fixture_path() -> PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/agent/adapter/kimi/fixtures/sample_wire.jsonl")
    }

    #[test]
    fn validate_transcript_path_accepts_file_under_kimi_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let kimi_root = tmp.path().join(".kimi-code");
        let transcript_path = kimi_root
            .join("sessions")
            .join("wd_x")
            .join("session_1")
            .join("agents")
            .join("main")
            .join("wire.jsonl");
        std::fs::create_dir_all(transcript_path.parent().expect("parent")).expect("mkdir");
        std::fs::write(&transcript_path, "").expect("write transcript");

        let canonical = validate_transcript_path_under_root(
            transcript_path.to_str().expect("utf8 path"),
            &kimi_root,
        )
        .expect("path under root validates");
        assert_eq!(
            canonical,
            std::fs::canonicalize(&transcript_path).expect("canonical path")
        );
    }

    #[test]
    fn validate_transcript_path_rejects_path_outside_kimi_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let kimi_root = tmp.path().join(".kimi-code");
        let outside = tmp.path().join("wire.jsonl");
        std::fs::create_dir_all(&kimi_root).expect("mkdir root");
        std::fs::write(&outside, "").expect("write outside");

        let result =
            validate_transcript_path_under_root(outside.to_str().expect("utf8 path"), &kimi_root);
        assert!(matches!(
            result,
            Err(ValidateTranscriptError::OutsideRoot { .. })
        ));
    }

    #[test]
    fn validate_transcript_path_rejects_null_byte() {
        let result = validate_transcript_path("/tmp/wire\0.jsonl");
        assert!(matches!(
            result,
            Err(ValidateTranscriptError::InvalidPath(_))
        ));
    }

    fn tool_call_events(sink: &FakeEventSink) -> Vec<Value> {
        sink.recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-tool-call")
            .map(|(_, payload)| payload)
            .collect()
    }

    #[test]
    fn fixture_replays_one_user_turn_and_paired_tool_call() {
        let sink = Arc::new(FakeEventSink::new());

        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("wire.jsonl");
        std::fs::copy(fixture_path(), &transcript_path).expect("copy fixture");

        let handle = start_tailing(sink.clone(), "sid-kimi".to_string(), transcript_path, None)
            .expect("tailing starts");

        assert!(
            sink.wait_for_count("agent-tool-call", 2, Duration::from_secs(5)),
            "expected 2 agent-tool-call events (one START + one DONE)",
        );
        assert!(
            sink.wait_for_count("agent-turn", 1, Duration::from_secs(5)),
            "expected exactly one user agent-turn",
        );
        handle.stop();

        let tool_calls = tool_call_events(&sink);
        assert_eq!(tool_calls.len(), 2, "one START + one DONE only");
        assert_eq!(tool_calls[0]["toolUseId"], "tool_6antsBfZmrEAWM7d0ZbyUfAt");
        assert_eq!(tool_calls[0]["tool"], "Read");
        assert_eq!(tool_calls[0]["status"], "running");
        assert_eq!(tool_calls[1]["toolUseId"], "tool_6antsBfZmrEAWM7d0ZbyUfAt");
        assert_eq!(tool_calls[1]["status"], "done");

        let turns: Vec<Value> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-turn")
            .map(|(_, payload)| payload)
            .collect();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["numTurns"], 1);
        assert_eq!(turns[0]["sessionId"], "sid-kimi");
    }

    #[test]
    fn injection_turn_prompt_does_not_count() {
        let sink = Arc::new(FakeEventSink::new());
        let mut decoder = KimiTranscriptDecoder::new(sink.clone(), "sid".into(), None);
        decoder.decode_line(
            r#"{"type":"turn.prompt","input":[{"type":"text","text":"x"}],"origin":{"kind":"injection","variant":"permission_mode"}}"#,
        );
        assert_eq!(sink.count("agent-turn"), 0);
    }

    #[test]
    fn tool_call_dedups_by_id() {
        let sink = Arc::new(FakeEventSink::new());
        let mut decoder = KimiTranscriptDecoder::new(sink.clone(), "sid".into(), None);
        let start = r#"{"type":"context.append_loop_event","event":{"type":"tool.call","toolCallId":"t1","name":"Read","args":{"path":"a"},"display":{"path":"/tmp/a"}}}"#;
        decoder.decode_line(start);
        decoder.decode_line(start);
        assert_eq!(
            sink.count("agent-tool-call"),
            1,
            "duplicate START suppressed"
        );
    }
}
