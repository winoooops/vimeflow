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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use super::transcript_dto::{KimiLineDto, KimiLoopEventType, KimiRecordType};
use crate::agent::adapter::base::{TranscriptDecoder, TranscriptHandle, TranscriptTailService};
use crate::agent::adapter::claude_code::test_runners::timestamps::compute_duration_ms;
use crate::agent::adapter::types::{stamp_snapshot, ValidateTranscriptError};
use crate::agent::events::{
    emit_agent_cwd, emit_agent_status, emit_agent_tool_call, emit_agent_turn, record_lifecycle,
};
use crate::agent::types::{
    AgentCwdEvent, AgentPhase, AgentToolCallEvent, AgentTurnEvent, ToolCallStatus,
};
use crate::runtime::EventSink;

/// Maximum length for the args summary string.
const MAX_ARGS_LEN: usize = 1024;

/// How often the session supervisor rescans `state.json` for newly-spawned
/// sub-agents, and the tick at which it checks the stop flag while waiting.
const KIMI_AGENT_SCAN_INTERVAL_MS: u64 = 750;
const KIMI_SCAN_TICK_MS: u64 = 250;

struct InFlightToolCall {
    started_at: Instant,
    started_at_iso: String,
    tool: String,
    args: String,
    is_test_file: bool,
}

type InFlightToolCalls = HashMap<String, InFlightToolCall>;

/// Dedupe key for supervisor `agent-status` refreshes: model + fresh/output
/// + cache read/creation tokens (cache moves the context % too).
type StatusSignature = (String, u64, u64, u64, u64);

/// Validate a raw transcript path (null-byte check + canonicalize-under-root)
/// against a caller-supplied root. `KimiAdapter` passes the locator's
/// effective home so the trust root matches the per-process `KIMI_CODE_HOME`
/// the locator resolved.
pub(super) fn validate_transcript_path_with_root(
    transcript_path: &str,
    kimi_root: &Path,
) -> Result<PathBuf, ValidateTranscriptError> {
    if transcript_path.bytes().any(|b| b == 0) {
        return Err(ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        ));
    }

    validate_transcript_path_under_root(transcript_path, kimi_root)
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
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    // `transcript_path` is `<session>/agents/main/wire.jsonl`; three up is the
    // session dir, which lets the supervisor follow EVERY `agents/*/wire.jsonl`
    // so a sub-agent's tool calls / turns surface alongside main's.
    let session_dir = transcript_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf);

    let Some(session_dir) = session_dir else {
        // No resolvable session dir — tail the single wire (legacy path).
        let file = open_wire(&transcript_path)?;
        let decoder = KimiTranscriptDecoder::new(events, session_id, String::new(), String::new());
        let service = TranscriptTailService::new(Box::new(decoder), "kimi wire transcript");
        let join_handle = std::thread::spawn(move || {
            service.run(BufReader::new(file), stop_clone);
        });
        return Ok(TranscriptHandle::new(stop_flag, join_handle));
    };

    // Surface the resolved workspace cwd once so the pane / file tree / git
    // follow the kimi project rather than the stale spawn cwd.
    emit_initial_cwd(events.as_ref(), &session_id, cwd.as_deref());

    let join_handle = std::thread::spawn(move || {
        run_session_supervisor(events, session_id, session_dir, transcript_path, stop_clone);
    });
    Ok(TranscriptHandle::new(stop_flag, join_handle))
}

/// kimi's `session_*` id from a session dir (its final path component); empty
/// when it can't be read.
fn session_id_from_dir(session_dir: &Path) -> String {
    session_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_default()
}

/// Re-aggregate the session status and emit `agent-status` when it changed.
/// The shared watcher only re-decodes on MAIN-wire writes, so during
/// delegated work (sub-agent-only token writes) the supervisor is what keeps
/// the context/token metrics live. Deduped on a cheap token signature.
fn emit_session_status(
    events: &dyn EventSink,
    session_id: &str,
    session_dir: &Path,
    last: &mut Option<StatusSignature>,
) {
    let Some(snapshot) = super::parser::parse_session_aggregate(session_dir) else {
        return;
    };
    // Include cache tokens: a sub-agent turn often changes only cache read /
    // creation, which still moves the context % + cache display — dropping
    // them here would suppress the refresh and leave the card stale.
    let usage = snapshot.context_window.current_usage.as_ref();
    let signature = (
        snapshot.model_id.clone(),
        snapshot.context_window.total_input_tokens,
        snapshot.context_window.total_output_tokens,
        usage.map_or(0, |u| u.cache_read_input_tokens),
        usage.map_or(0, |u| u.cache_creation_input_tokens),
    );
    if last.as_ref() == Some(&signature) {
        return;
    }
    *last = Some(signature);
    let event = stamp_snapshot(session_id, snapshot);
    if let Err(e) = emit_agent_status(events, &event) {
        log::warn!("Failed to emit kimi agent-status event: {}", e);
    }
}

fn open_wire(path: &Path) -> Result<File, String> {
    File::open(path).map_err(|e| {
        format!(
            "Failed to open kimi wire transcript: {}: {}",
            path.display(),
            e
        )
    })
}

/// Emit a single `agent-cwd` from the resolved kimi cwd so the rest of the
/// workspace tracks the project the agent is actually in.
fn emit_initial_cwd(events: &dyn EventSink, session_id: &str, cwd: Option<&Path>) {
    let Some(cwd) = cwd.and_then(Path::to_str) else {
        return;
    };
    let event = AgentCwdEvent {
        session_id: session_id.to_string(),
        cwd: cwd.to_string(),
    };
    if let Err(e) = emit_agent_cwd(events, &event) {
        log::warn!("Failed to emit kimi agent-cwd event: {}", e);
    }
}

/// Follow every `agents/*/wire.jsonl` of a kimi session: discover agents from
/// `state.json` (sub-agents appear when a turn delegates), spawn a per-agent
/// tail thread, and tear them all down on stop. A sub-agent's tool ids are
/// prefixed with its agent id so they don't collide with main's in the feed.
fn run_session_supervisor(
    events: Arc<dyn EventSink>,
    session_id: String,
    session_dir: PathBuf,
    main_wire: PathBuf,
    stop: Arc<AtomicBool>,
) {
    // `read_agent_wires` canonicalizes discovered agent wires, so the main
    // wire must be canonicalized too or symlinked session/home layouts can
    // cause the same physical file to appear as two PathBuf values and get
    // tailed twice (duplicate events + inflated turn counts).
    let main_wire = fs::canonicalize(&main_wire).unwrap_or(main_wire);

    // Keyed by wire path so the always-tailed main wire is never double-spawned
    // when `state.json` lists it too.
    let mut children: HashMap<PathBuf, (Arc<AtomicBool>, std::thread::JoinHandle<()>)> =
        HashMap::new();
    let agent_session_id = session_id_from_dir(&session_dir);
    let mut last_status: Option<StatusSignature> = None;

    loop {
        // Always tail the main wire; add sub-agent wires as `state.json`
        // reveals them (a `/init`-style delegation spawns `agent-0`
        // mid-session). When there is no `state.json`, only main is tailed.
        let mut targets: Vec<(PathBuf, String)> = vec![(main_wire.clone(), String::new())];
        if let Some(wires) = super::parser::read_agent_wires(&session_dir) {
            for wire in wires {
                if wire.wire == main_wire {
                    continue;
                }
                let prefix = if wire.is_main {
                    String::new()
                } else {
                    format!("{}:", wire.agent_id)
                };
                targets.push((wire.wire, prefix));
            }
        }
        for (wire, prefix) in targets {
            if children.contains_key(&wire) {
                continue;
            }
            let Ok(file) = File::open(&wire) else {
                continue;
            };
            let decoder = KimiTranscriptDecoder::new(
                events.clone(),
                session_id.clone(),
                agent_session_id.clone(),
                prefix,
            );
            let service = TranscriptTailService::new(Box::new(decoder), "kimi wire transcript");
            let child_stop = Arc::new(AtomicBool::new(false));
            let child_stop_run = child_stop.clone();
            let join = std::thread::spawn(move || {
                service.run(BufReader::new(file), child_stop_run);
            });
            children.insert(wire, (child_stop, join));
        }

        // Refresh the aggregated status so context/tokens stay live during
        // sub-agent-only writes the main-wire watcher never sees.
        emit_session_status(events.as_ref(), &session_id, &session_dir, &mut last_status);

        // Poll for newly-spawned sub-agents; check stop on a short tick so
        // teardown stays prompt.
        let mut slept = 0;
        while slept < KIMI_AGENT_SCAN_INTERVAL_MS && !stop.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(KIMI_SCAN_TICK_MS));
            slept += KIMI_SCAN_TICK_MS;
        }
        if stop.load(Ordering::Relaxed) {
            break;
        }
    }

    for (_, (child_stop, join)) in children {
        child_stop.store(true, Ordering::Relaxed);
        let _ = join.join();
    }
}

/// Per-session kimi decoder: owns the in-flight tool-call map, turn count,
/// and the replay-bounded lifecycle slots, turning each complete
/// `wire.jsonl` line into `agent-*` events.
struct KimiTranscriptDecoder {
    events: Arc<dyn EventSink>,
    session_id: String,
    /// kimi's own `session_*` id, used as the lifecycle `agentSessionId` so
    /// the frontend's stale-event guard can tell an old run in this pane from
    /// a new one (the PTY id is identical across runs). Empty when unknown.
    agent_session_id: String,
    /// Prefix applied to emitted `tool_use_id`s so a sub-agent's tool calls
    /// can't collide with main's (or another sub-agent's) in the shared feed.
    /// Empty for the `main` agent.
    agent_prefix: String,
    in_flight: InFlightToolCalls,
    num_turns: u32,
    last_phase: Option<AgentPhase>,
    replay_phase: Option<AgentPhase>,
    replay_done: bool,
}

impl KimiTranscriptDecoder {
    fn new(
        events: Arc<dyn EventSink>,
        session_id: String,
        agent_session_id: String,
        agent_prefix: String,
    ) -> Self {
        Self {
            events,
            session_id,
            agent_session_id,
            agent_prefix,
            in_flight: HashMap::new(),
            num_turns: 0,
            last_phase: None,
            replay_phase: None,
            replay_done: false,
        }
    }

    /// Namespace a wire `tool_call_id` with this agent's prefix.
    fn tool_use_id(&self, call_id: &str) -> String {
        format!("{}{}", self.agent_prefix, call_id)
    }

    /// Only the main agent drives session-level turns and lifecycle; a
    /// sub-agent (non-empty prefix) contributes tool calls alone, so its
    /// `end_turn` can't flip the whole pane idle while main is still running.
    fn is_main(&self) -> bool {
        self.agent_prefix.is_empty()
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
                    &self.agent_session_id,
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
        // Turns and lifecycle are session-level — only the main wire drives
        // them; a sub-agent's prompts must not add turns or move the phase.
        if !self.is_main() {
            return;
        }
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
        // Wire `time` is epoch-ms; use it so replay reflects historical
        // action times. Fall back to `now` only when the stamp is missing.
        let timestamp = dto.time.map_or_else(now_iso8601, epoch_ms_to_iso8601);

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
                    tool_use_id: self.tool_use_id(call_id),
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
                    tool_use_id: self.tool_use_id(call_id),
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
                // Only the main wire's `end_turn` settles the pane idle; a
                // sub-agent finishing a step must not, while main runs on.
                if self.is_main() && event.finish_reason.as_deref() == Some("end_turn") {
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
            &self.agent_session_id,
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

/// Convert an epoch-millisecond wire stamp to an RFC3339 string — the same
/// shape codex carries in `dto.timestamp` and `compute_duration_ms` parses.
/// Out-of-range stamps fall back to `now`.
fn epoch_ms_to_iso8601(epoch_ms: u64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(epoch_ms as i64)
        .map_or_else(now_iso8601, |dt| dt.to_rfc3339())
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
        let result =
            validate_transcript_path_with_root("/tmp/wire\0.jsonl", Path::new("/tmp/.kimi-code"));
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
    fn supervisor_surfaces_sub_agent_tool_calls() {
        let sink = Arc::new(FakeEventSink::new());
        let tmp = tempfile::tempdir().expect("tempdir");
        let session = tmp
            .path()
            .join("sessions")
            .join("wd_x")
            .join("session_y");
        let main_dir = session.join("agents").join("main");
        let sub_dir = session.join("agents").join("agent-0");
        std::fs::create_dir_all(&main_dir).expect("main dir");
        std::fs::create_dir_all(&sub_dir).expect("sub dir");

        // main only opens a user turn; the sub-agent does the tool work.
        std::fs::write(
            main_dir.join("wire.jsonl"),
            "{\"type\":\"turn.prompt\",\"origin\":{\"kind\":\"user\"}}\n",
        )
        .expect("main wire");
        std::fs::write(
            sub_dir.join("wire.jsonl"),
            "{\"type\":\"context.append_loop_event\",\"time\":1781345364384,\"event\":{\"type\":\"tool.call\",\"toolCallId\":\"t1\",\"name\":\"Read\",\"args\":{\"path\":\"a\"}}}\n\
             {\"type\":\"context.append_loop_event\",\"time\":1781345364999,\"event\":{\"type\":\"tool.result\",\"toolCallId\":\"t1\"}}\n",
        )
        .expect("sub wire");
        std::fs::write(
            session.join("state.json"),
            format!(
                "{{\"agents\":{{\"main\":{{\"homedir\":\"{}\",\"type\":\"main\"}},\"agent-0\":{{\"homedir\":\"{}\",\"type\":\"sub\"}}}}}}",
                main_dir.display(),
                sub_dir.display(),
            ),
        )
        .expect("state.json");

        let main_wire = main_dir.join("wire.jsonl");
        let handle = start_tailing(sink.clone(), "sid".to_string(), main_wire, None)
            .expect("tailing starts");

        assert!(
            sink.wait_for_count("agent-tool-call", 2, Duration::from_secs(5)),
            "sub-agent START + DONE must surface",
        );
        assert!(
            sink.wait_for_count("agent-turn", 1, Duration::from_secs(5)),
            "main's user turn must surface",
        );
        handle.stop();

        let calls = tool_call_events(&sink);
        assert_eq!(calls.len(), 2);
        // The sub-agent's tool id is namespaced so it can't collide with main.
        assert_eq!(calls[0]["toolUseId"], "agent-0:t1");
        assert_eq!(calls[0]["tool"], "Read");
        assert_eq!(calls[1]["toolUseId"], "agent-0:t1");
        assert_eq!(calls[1]["status"], "done");
    }

    #[test]
    #[cfg(unix)]
    fn supervisor_does_not_double_tail_main_wire_through_symlink() {
        let sink = Arc::new(FakeEventSink::new());
        let tmp = tempfile::tempdir().expect("tempdir");
        let session = tmp
            .path()
            .join("sessions")
            .join("wd_x")
            .join("session_y");
        let main_dir = session.join("agents").join("main");
        std::fs::create_dir_all(&main_dir).expect("main dir");

        // Symlink the session dir so the caller-supplied main wire path is
        // non-canonical while `state.json` references the canonical layout.
        let link_dir = tmp.path().join("link");
        std::os::unix::fs::symlink(&session, &link_dir).expect("symlink session dir");

        std::fs::write(
            main_dir.join("wire.jsonl"),
            "{\"type\":\"turn.prompt\",\"origin\":{\"kind\":\"user\"}}\n",
        )
        .expect("main wire");
        std::fs::write(
            session.join("state.json"),
            format!(
                "{{\"agents\":{{\"main\":{{\"homedir\":\"{}\",\"type\":\"main\"}}}}}}",
                main_dir.display(),
            ),
        )
        .expect("state.json");

        let main_wire = link_dir.join("agents").join("main").join("wire.jsonl");
        let handle = start_tailing(sink.clone(), "sid".to_string(), main_wire, None)
            .expect("tailing starts");

        assert!(
            sink.wait_for_count("agent-turn", 1, Duration::from_secs(5)),
            "main's user turn must surface exactly once",
        );
        // Give any duplicate tailer time to emit a second event.
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(
            sink.count("agent-turn"),
            1,
            "symlinked main wire must not be tailed twice"
        );
        handle.stop();
    }

    #[test]
    fn sub_agent_decoder_emits_tools_but_not_turns_or_lifecycle() {
        let sink = Arc::new(FakeEventSink::new());
        // Non-empty prefix => sub-agent.
        let mut decoder = KimiTranscriptDecoder::new(
            sink.clone(),
            "sid".into(),
            "session_x".into(),
            "agent-0:".into(),
        );
        decoder.decode_line(r#"{"type":"turn.prompt","origin":{"kind":"user"}}"#);
        decoder.decode_line(
            r#"{"type":"context.append_loop_event","event":{"type":"tool.call","toolCallId":"t1","name":"Read","args":{"path":"a"}}}"#,
        );
        decoder.decode_line(
            r#"{"type":"context.append_loop_event","event":{"type":"step.end","finishReason":"end_turn"}}"#,
        );
        let names: Vec<String> = sink.recorded().into_iter().map(|(name, _)| name).collect();
        assert!(
            names.iter().any(|n| n == "agent-tool-call"),
            "sub-agent must still surface tool calls",
        );
        assert!(
            !names.iter().any(|n| n == "agent-turn"),
            "sub-agent must not emit session turns",
        );
        assert!(
            !names.iter().any(|n| n == "agent-lifecycle"),
            "sub-agent must not move the pane lifecycle",
        );
    }

    #[test]
    fn tool_call_timestamp_derives_from_wire_time_not_now() {
        let sink = Arc::new(FakeEventSink::new());
        let mut decoder = KimiTranscriptDecoder::new(sink.clone(), "sid".into(), String::new(), String::new());
        // Mirrors the fixture's tool.call envelope `time` (epoch-ms).
        decoder.decode_line(
            r#"{"type":"context.append_loop_event","time":1781345364384,"event":{"type":"tool.call","toolCallId":"t1","name":"Read","args":{"path":"a"}}}"#,
        );
        let calls = tool_call_events(&sink);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["timestamp"], epoch_ms_to_iso8601(1781345364384));
        // The wire time is in 2026; today's `now_iso8601` would differ, so a
        // direct equality to the derived stamp proves it is not current-time.
        assert_ne!(calls[0]["timestamp"], now_iso8601());
    }

    #[test]
    fn injection_turn_prompt_does_not_count() {
        let sink = Arc::new(FakeEventSink::new());
        let mut decoder = KimiTranscriptDecoder::new(sink.clone(), "sid".into(), String::new(), String::new());
        decoder.decode_line(
            r#"{"type":"turn.prompt","input":[{"type":"text","text":"x"}],"origin":{"kind":"injection","variant":"permission_mode"}}"#,
        );
        assert_eq!(sink.count("agent-turn"), 0);
    }

    #[test]
    fn tool_call_dedups_by_id() {
        let sink = Arc::new(FakeEventSink::new());
        let mut decoder = KimiTranscriptDecoder::new(sink.clone(), "sid".into(), String::new(), String::new());
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
