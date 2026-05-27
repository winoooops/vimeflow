//! Transcript tailer for Codex rollout JSONL files.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::claude_code::test_runners::build::{maybe_build_snapshot, BuildArgs};
use crate::agent::adapter::claude_code::test_runners::emitter::TestRunEmitter;
use crate::agent::adapter::claude_code::test_runners::matcher::{match_command, MatchedCommand};
use crate::agent::adapter::claude_code::test_runners::test_file_patterns::is_test_file;
use crate::agent::adapter::claude_code::test_runners::timestamps::compute_duration_ms;
use crate::agent::adapter::claude_code::test_runners::types::CapturedOutput;
use crate::agent::adapter::types::ValidateTranscriptError;
use crate::agent::events::{emit_agent_cwd, emit_agent_tool_call, emit_agent_turn};
use crate::agent::types::{AgentCwdEvent, AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
use crate::runtime::EventSink;

use super::transcript_dto::{
    CodexCustomToolOutputDto, CodexExecArgsDto, CodexLineDto, CodexPayloadDto, CodexPayloadType,
    CodexRecordType,
};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_ARGS_LEN: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CompletionMode {
    Output,
    ExecCommandEnd,
    PatchApplyEnd,
}

struct InFlightToolCall {
    started_at: Instant,
    started_at_iso: String,
    tool: String,
    args: String,
    is_test_file: bool,
    test_match: Option<MatchedCommand>,
    completion_mode: CompletionMode,
}

type InFlightToolCalls = HashMap<String, InFlightToolCall>;

/// Pull session-start cwd off a Codex rollout JSONL line.
///
/// Returns `Some(cwd)` ONLY for `session_meta` entries — the
/// session-start anchor. `turn_context.cwd` is intentionally NOT
/// matched here: empirically it just repeats `session_meta.cwd`
/// every turn (no information value), and treating it as a live cwd
/// would cause false reverts on reasoning-only turns after an
/// `exec_command.workdir` transition has already moved us to a new
/// directory. See spec section 1.
fn extract_session_cwd(dto: &CodexLineDto) -> Option<String> {
    if !matches!(dto.record_type(), CodexRecordType::SessionMeta) {
        return None;
    }
    let payload =
        serde_json::from_value::<CodexPayloadDto>(dto.payload.clone()).unwrap_or_default();
    payload.cwd.filter(|s| !s.is_empty())
}

/// Pull the mid-session workdir off a Codex `exec_command` function-call
/// rollout entry. This is codex's de facto session cwd after the start
/// (verified empirically — `turn_context.cwd` does not update on
/// codex-driven cwd changes; `exec_command.arguments.workdir` does).
///
/// `arguments` is a JSON-encoded string per Codex's rollout schema —
/// it must be parsed before reading `workdir`. Malformed JSON, missing
/// fields, or empty strings all short-circuit to `None`.
fn extract_exec_workdir(dto: &CodexLineDto) -> Option<String> {
    if !matches!(dto.record_type(), CodexRecordType::ResponseItem) {
        return None;
    }
    let payload =
        serde_json::from_value::<CodexPayloadDto>(dto.payload.clone()).unwrap_or_default();
    if payload.payload_type() != CodexPayloadType::FunctionCall {
        return None;
    }
    if payload.name.as_deref() != Some("exec_command") {
        return None;
    }
    let raw = payload.arguments?;
    let args: CodexExecArgsDto = serde_json::from_str(&raw).ok()?;
    args.workdir.filter(|s| !s.is_empty())
}

/// Dispatcher returning the observed cwd from whichever source carries
/// it. Tries the session_meta path first (cheap, no JSON re-parse),
/// falls back to the exec_command workdir path. Returns
/// `Option<String>` because the workdir path must return owned strings
/// (parsed JSON allocates).
fn extract_codex_cwd(dto: &CodexLineDto) -> Option<String> {
    if let Some(cwd) = extract_session_cwd(dto) {
        return Some(cwd);
    }
    extract_exec_workdir(dto)
}

pub(super) fn validate_transcript_path(
    transcript_path: &str,
) -> Result<PathBuf, ValidateTranscriptError> {
    if transcript_path.bytes().any(|b| b == 0) {
        return Err(ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        ));
    }

    let codex_root = dirs::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| ValidateTranscriptError::Other("cannot determine home directory".into()))?;

    validate_transcript_path_under_root(transcript_path, &codex_root)
}

fn validate_transcript_path_under_root(
    transcript_path: &str,
    codex_root: &Path,
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

    let codex_root = fs::canonicalize(codex_root).map_err(|e| {
        ValidateTranscriptError::Other(format!(
            "cannot resolve Codex transcript root '{}': {}",
            codex_root.display(),
            e
        ))
    })?;

    if !canonical.starts_with(&codex_root) {
        return Err(ValidateTranscriptError::OutsideRoot {
            path: canonical,
            root: codex_root,
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
            "Failed to open Codex rollout transcript: {}: {}",
            transcript_path.display(),
            e
        )
    })?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let join_handle = std::thread::spawn(move || {
        tail_loop(events, session_id, cwd, file, stop_clone);
    });

    Ok(TranscriptHandle::new(stop_flag, join_handle))
}

fn tail_loop(
    events: Arc<dyn EventSink>,
    session_id: String,
    cwd: Option<PathBuf>,
    file: File,
    stop_flag: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(file);
    let mut line_buf = String::new();
    let mut partial_line = String::new();
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;
    let mut last_cwd: Option<String> = None;
    let mut emitter = TestRunEmitter::new(events.clone());

    while !stop_flag.load(Ordering::Acquire) {
        line_buf.clear();
        match reader.read_line(&mut line_buf) {
            Ok(0) => {
                emitter.finish_replay();
                std::thread::sleep(POLL_INTERVAL);
            }
            Ok(_) => {
                if !line_buf.ends_with('\n') {
                    partial_line.push_str(&line_buf);
                    continue;
                }

                if !partial_line.is_empty() {
                    partial_line.push_str(&line_buf);
                    process_line(
                        partial_line.trim_end_matches('\n'),
                        &session_id,
                        cwd.as_deref(),
                        &events,
                        &mut emitter,
                        &mut in_flight,
                        &mut num_turns,
                        &mut last_cwd,
                    );
                    partial_line.clear();
                    continue;
                }

                let line = line_buf.trim_end_matches('\n');
                if line.is_empty() {
                    continue;
                }

                process_line(
                    line,
                    &session_id,
                    cwd.as_deref(),
                    &events,
                    &mut emitter,
                    &mut in_flight,
                    &mut num_turns,
                    &mut last_cwd,
                );
            }
            Err(e) => {
                log::warn!("Error reading Codex rollout transcript line: {}", e);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
    last_cwd: &mut Option<String>,
) {
    let dto: CodexLineDto = match serde_json::from_str(line) {
        Ok(dto) => dto,
        Err(_) => return,
    };

    // Emit agent-cwd on transitions only. Codex's two cwd sources are
    // session_meta.payload.cwd (session start) and
    // response_item.payload.arguments.workdir for exec_command function
    // calls (mid-session). turn_context.cwd is intentionally NOT a
    // source — see spec section 1 and the regression test
    // `process_line_turn_context_after_exec_command_does_not_revert`.
    if let Some(observed) = extract_codex_cwd(&dto) {
        if last_cwd
            .as_deref()
            .map_or(true, |seen| seen != observed.as_str())
        {
            let event = AgentCwdEvent {
                session_id: session_id.to_string(),
                cwd: observed.clone(),
            };
            if let Err(e) = emit_agent_cwd(events.as_ref(), &event) {
                log::warn!("Failed to emit agent-cwd event: {}", e);
            }
            *last_cwd = Some(observed);
        }
    }

    match dto.record_type() {
        CodexRecordType::ResponseItem => {
            process_response_item(&dto, session_id, cwd, events, in_flight);
        }
        CodexRecordType::EventMsg => {
            process_event_msg(
                &dto, session_id, cwd, events, emitter, in_flight, num_turns,
            );
        }
        _ => {}
    }
}

fn process_response_item(
    dto: &CodexLineDto,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    in_flight: &mut InFlightToolCalls,
) {
    let payload =
        serde_json::from_value::<CodexPayloadDto>(dto.payload.clone()).unwrap_or_default();
    let timestamp = dto.timestamp.clone().unwrap_or_else(now_iso8601);

    match payload.payload_type() {
        CodexPayloadType::FunctionCall => {
            start_function_call(&payload, session_id, cwd, events, in_flight, &timestamp);
        }
        CodexPayloadType::CustomToolCall => {
            start_custom_tool_call(&payload, session_id, events, in_flight, &timestamp);
        }
        CodexPayloadType::FunctionCallOutput => {
            process_output_completion(&payload, session_id, events, in_flight, &timestamp, false);
        }
        CodexPayloadType::CustomToolCallOutput => {
            process_output_completion(&payload, session_id, events, in_flight, &timestamp, true);
        }
        _ => {}
    }
}

fn process_event_msg(
    dto: &CodexLineDto,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) {
    let payload =
        serde_json::from_value::<CodexPayloadDto>(dto.payload.clone()).unwrap_or_default();
    let timestamp = dto.timestamp.clone().unwrap_or_else(now_iso8601);

    match payload.payload_type() {
        CodexPayloadType::UserMessage => {
            process_user_message(&payload, session_id, events, num_turns);
        }
        CodexPayloadType::ExecCommandEnd => {
            process_exec_command_end(
                &payload, session_id, cwd, events, emitter, in_flight, &timestamp,
            );
        }
        CodexPayloadType::PatchApplyEnd => {
            process_patch_apply_end(&payload, session_id, events, in_flight, &timestamp);
        }
        _ => {}
    }
}

fn process_user_message(
    payload: &CodexPayloadDto,
    session_id: &str,
    events: &Arc<dyn EventSink>,
    num_turns: &mut u32,
) {
    let Some(message) = payload.message.as_deref() else {
        return;
    };
    if message.trim().is_empty() {
        return;
    }

    *num_turns = num_turns.saturating_add(1);
    let event = AgentTurnEvent {
        session_id: session_id.to_string(),
        num_turns: *num_turns,
    };

    if let Err(e) = emit_agent_turn(events.as_ref(), &event) {
        log::warn!("Failed to emit agent-turn event: {}", e);
    }
}

fn start_function_call(
    payload: &CodexPayloadDto,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.call_id.as_deref() else {
        return;
    };
    let tool = payload.name.as_deref().unwrap_or("unknown").to_string();
    let args = summarize_function_call_args(payload.arguments.as_deref());
    let cmd = function_call_cmd(payload.arguments.as_deref());
    let test_match = cmd
        .as_deref()
        .filter(|_| tool == "exec_command")
        .and_then(|cmd| match_command(cmd, cwd));

    in_flight.insert(
        call_id.to_string(),
        InFlightToolCall {
            started_at: Instant::now(),
            started_at_iso: timestamp.to_string(),
            tool: tool.clone(),
            args: args.clone(),
            is_test_file: false,
            test_match,
            completion_mode: if tool == "exec_command" {
                CompletionMode::ExecCommandEnd
            } else {
                CompletionMode::Output
            },
        },
    );

    emit_tool_call(
        events,
        AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: call_id.to_string(),
            tool,
            args,
            status: ToolCallStatus::Running,
            timestamp: timestamp.to_string(),
            duration_ms: 0,
            is_test_file: false,
        },
    );
}

fn start_custom_tool_call(
    payload: &CodexPayloadDto,
    session_id: &str,
    events: &Arc<dyn EventSink>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.call_id.as_deref() else {
        return;
    };
    let tool = payload.name.as_deref().unwrap_or("unknown").to_string();
    let args = summarize_custom_tool_input(payload.input.as_deref());
    let is_test_file = custom_tool_is_test_file(payload.input.as_deref());

    in_flight.insert(
        call_id.to_string(),
        InFlightToolCall {
            started_at: Instant::now(),
            started_at_iso: timestamp.to_string(),
            tool: tool.clone(),
            args: args.clone(),
            is_test_file,
            test_match: None,
            completion_mode: if tool == "apply_patch" {
                CompletionMode::PatchApplyEnd
            } else {
                CompletionMode::Output
            },
        },
    );

    emit_tool_call(
        events,
        AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: call_id.to_string(),
            tool,
            args,
            status: ToolCallStatus::Running,
            timestamp: timestamp.to_string(),
            duration_ms: 0,
            is_test_file,
        },
    );
}

fn process_output_completion(
    payload: &CodexPayloadDto,
    session_id: &str,
    events: &Arc<dyn EventSink>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
    is_custom_tool_output: bool,
) {
    let Some(call_id) = payload.call_id.as_deref() else {
        return;
    };

    let Some(call) = in_flight.get(call_id) else {
        return;
    };
    if matches!(
        call.completion_mode,
        CompletionMode::ExecCommandEnd | CompletionMode::PatchApplyEnd
    ) {
        return;
    }

    let call = match in_flight.remove(call_id) {
        Some(call) => call,
        None => return,
    };

    let status = if is_custom_tool_output && custom_tool_output_failed(payload.output.as_deref()) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    emit_tool_call(
        events,
        AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: call_id.to_string(),
            tool: call.tool,
            args: call.args,
            status,
            timestamp: timestamp.to_string(),
            duration_ms: compute_duration_ms(
                &call.started_at_iso,
                timestamp,
                call.started_at.elapsed(),
            ),
            is_test_file: call.is_test_file,
        },
    );
}

fn process_exec_command_end(
    payload: &CodexPayloadDto,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.call_id.as_deref() else {
        return;
    };

    let Some(call) = in_flight.remove(call_id) else {
        return;
    };

    if let Some(matched) = call.test_match {
        if let Some(cwd_ref) = cwd {
            let captured = CapturedOutput {
                content: payload.aggregated_output.as_deref().unwrap_or("").to_string(),
                is_error: payload.exit_code.is_some_and(|code| code != 0),
            };
            if let Some(snapshot) = maybe_build_snapshot(BuildArgs {
                session_id,
                matched: &matched,
                started_at: &call.started_at_iso,
                finished_at: timestamp,
                instant_fallback: call.started_at.elapsed(),
                captured,
                cwd: cwd_ref,
            }) {
                emitter.submit(snapshot);
            }
        } else {
            log::debug!(
                "Skipping Codex test-run snapshot for session {}: no workspace cwd resolved",
                session_id
            );
        }
    }

    let status = if payload.exit_code.is_some_and(|code| code != 0) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    emit_tool_call(
        events,
        AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: call_id.to_string(),
            tool: call.tool,
            args: call.args,
            status,
            timestamp: timestamp.to_string(),
            duration_ms: exec_command_duration_ms(payload).unwrap_or_else(|| {
                compute_duration_ms(&call.started_at_iso, timestamp, call.started_at.elapsed())
            }),
            is_test_file: call.is_test_file,
        },
    );
}

fn process_patch_apply_end(
    payload: &CodexPayloadDto,
    session_id: &str,
    events: &Arc<dyn EventSink>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.call_id.as_deref() else {
        return;
    };

    let Some(call) = in_flight.remove(call_id) else {
        return;
    };

    let status = if payload.success.unwrap_or(false) {
        ToolCallStatus::Done
    } else {
        ToolCallStatus::Failed
    };

    emit_tool_call(
        events,
        AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: call_id.to_string(),
            tool: call.tool,
            args: call.args,
            status,
            timestamp: timestamp.to_string(),
            duration_ms: compute_duration_ms(
                &call.started_at_iso,
                timestamp,
                call.started_at.elapsed(),
            ),
            is_test_file: call.is_test_file,
        },
    );
}

fn emit_tool_call(events: &Arc<dyn EventSink>, event: AgentToolCallEvent) {
    if let Err(e) = emit_agent_tool_call(events.as_ref(), &event) {
        log::warn!("Failed to emit agent-tool-call event: {}", e);
    }
}

fn function_call_cmd(arguments: Option<&str>) -> Option<String> {
    let raw = arguments?;
    let args: CodexExecArgsDto = serde_json::from_str(raw).ok()?;
    args.cmd.or(args.command)
}

fn summarize_function_call_args(arguments: Option<&str>) -> String {
    if let Some(cmd) = function_call_cmd(arguments) {
        return truncate_string(&cmd, MAX_ARGS_LEN);
    }

    let raw = arguments.unwrap_or_default();

    if let Ok(args) = serde_json::from_str::<CodexExecArgsDto>(raw) {
        if let Some(path) = args.path.or(args.file_path) {
            return truncate_string(&path, MAX_ARGS_LEN);
        }
    }

    truncate_string(raw, MAX_ARGS_LEN)
}

fn summarize_custom_tool_input(input: Option<&str>) -> String {
    let input = input.unwrap_or_default();
    if let Some(first_path) = extract_patch_paths(input).into_iter().next() {
        return truncate_string(&first_path, MAX_ARGS_LEN);
    }
    truncate_string(input, MAX_ARGS_LEN)
}

fn custom_tool_is_test_file(input: Option<&str>) -> bool {
    let input = input.unwrap_or_default();

    extract_patch_paths(input)
        .into_iter()
        .any(|path| is_test_file(&path))
}

fn extract_patch_paths(input: &str) -> Vec<String> {
    input
        .lines()
        .filter_map(|line| {
            line.strip_prefix("*** Update File: ")
                .or_else(|| line.strip_prefix("*** Add File: "))
                .or_else(|| line.strip_prefix("*** Delete File: "))
                .map(str::to_string)
        })
        .collect()
}

fn custom_tool_output_failed(output: Option<&str>) -> bool {
    let raw = output.unwrap_or_default();
    let parsed: CodexCustomToolOutputDto = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    parsed.metadata.and_then(|m| m.exit_code).is_some_and(|code| code != 0)
}

fn exec_command_duration_ms(payload: &CodexPayloadDto) -> Option<u64> {
    if !payload.rest.contains_key("duration") {
        return None;
    }
    let duration = payload.rest.get("duration")?;
    let secs = duration.get("secs").and_then(Value::as_u64).unwrap_or(0);
    let nanos = duration.get("nanos").and_then(Value::as_u64).unwrap_or(0);
    Some(
        secs.saturating_mul(1000)
            .saturating_add(nanos.saturating_div(1_000_000)),
    )
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
        .unwrap_or_else(|_| Duration::from_secs(0));

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
    use serde_json::json;

    fn write_rollout(path: &Path, lines: &[Value]) {
        let body = lines
            .iter()
            .map(|line| serde_json::to_string(line).expect("serialize fixture line"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(path, format!("{}\n", body)).expect("write rollout fixture");
    }

    #[test]
    fn validate_transcript_path_accepts_file_under_codex_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let codex_root = tmp.path().join(".codex");
        let transcript_path = codex_root.join("sessions").join("rollout.jsonl");
        std::fs::create_dir_all(transcript_path.parent().expect("rollout parent directory"))
            .expect("mkdir codex root");
        std::fs::write(&transcript_path, "").expect("write transcript");

        let canonical = validate_transcript_path_under_root(
            transcript_path.to_str().expect("utf8 rollout path"),
            &codex_root,
        )
        .expect("path under root should validate");

        assert_eq!(
            canonical,
            std::fs::canonicalize(&transcript_path).expect("canonical rollout path")
        );
    }

    #[test]
    fn validate_transcript_path_rejects_path_outside_codex_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let codex_root = tmp.path().join(".codex");
        let transcript_path = tmp.path().join("rollout.jsonl");
        std::fs::create_dir_all(&codex_root).expect("mkdir codex root");
        std::fs::write(&transcript_path, "").expect("write transcript");

        let result = validate_transcript_path_under_root(
            transcript_path.to_str().expect("utf8 rollout path"),
            &codex_root,
        );

        assert!(matches!(
            result,
            Err(ValidateTranscriptError::OutsideRoot { .. })
        ));
    }

    #[test]
    fn start_tailing_replays_tool_calls_turns_and_test_runs() {
        let sink = Arc::new(FakeEventSink::new());

        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("src")).expect("workspace dirs");
        std::fs::write(workspace.join("src/foo.test.ts"), "").expect("test file");

        let transcript_path = tmp.path().join("rollout.jsonl");
        write_rollout(
            &transcript_path,
            &[
                json!({
                    "timestamp": "2026-05-04T10:00:00Z",
                    "type": "event_msg",
                    "payload": {
                        "type": "user_message",
                        "message": "run the tests"
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:01Z",
                    "type": "response_item",
                    "payload": {
                        "type": "function_call",
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"cargo test\",\"workdir\":\"/tmp/ws\"}",
                        "call_id": "call_exec"
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:02Z",
                    "type": "event_msg",
                    "payload": {
                        "type": "exec_command_end",
                        "call_id": "call_exec",
                        "command": ["/bin/bash", "-lc", "cargo test"],
                        "aggregated_output": "running 1 test\ntest mycrate::tests::test_a ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n",
                        "exit_code": 0,
                        "duration": {
                            "secs": 1,
                            "nanos": 250000000
                        },
                        "status": "completed"
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:02.100Z",
                    "type": "response_item",
                    "payload": {
                        "type": "function_call_output",
                        "call_id": "call_exec",
                        "output": "cargo test output"
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:03Z",
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call",
                        "status": "completed",
                        "call_id": "call_patch",
                        "name": "apply_patch",
                        "input": format!(
                            "*** Begin Patch\n*** Update File: {}\n@@\n-old\n+new\n*** End Patch\n",
                            workspace.join("src/foo.test.ts").display()
                        )
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:03.050Z",
                    "type": "event_msg",
                    "payload": {
                        "type": "patch_apply_end",
                        "call_id": "call_patch",
                        "success": true,
                        "status": "completed"
                    }
                }),
                json!({
                    "timestamp": "2026-05-04T10:00:03.060Z",
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call_output",
                        "call_id": "call_patch",
                        "output": "{\"output\":\"Success\",\"metadata\":{\"exit_code\":0,\"duration_seconds\":0.0}}"
                    }
                }),
            ],
        );

        let handle = start_tailing(
            sink.clone(),
            "sid-1".to_string(),
            transcript_path,
            Some(workspace.clone()),
        )
        .expect("tailing should start");

        std::thread::sleep(Duration::from_millis(750));
        handle.stop();
        std::thread::sleep(Duration::from_millis(100));

        let recorded = sink.recorded();
        let tool_call_payloads: Vec<Value> = recorded
            .iter()
            .filter(|(event, _)| event == "agent-tool-call")
            .map(|(_, payload)| payload.clone())
            .collect();
        assert_eq!(tool_call_payloads.len(), 4);
        assert_eq!(tool_call_payloads[0]["toolUseId"], "call_exec");
        assert_eq!(tool_call_payloads[0]["status"], "running");
        assert_eq!(tool_call_payloads[1]["toolUseId"], "call_exec");
        assert_eq!(tool_call_payloads[1]["status"], "done");
        assert_eq!(tool_call_payloads[1]["durationMs"], 1250);
        assert_eq!(tool_call_payloads[2]["toolUseId"], "call_patch");
        assert_eq!(tool_call_payloads[2]["status"], "running");
        assert_eq!(tool_call_payloads[3]["toolUseId"], "call_patch");
        assert_eq!(tool_call_payloads[3]["status"], "done");
        assert_eq!(tool_call_payloads[3]["isTestFile"], true);

        let turn_payloads: Vec<Value> = recorded
            .iter()
            .filter(|(event, _)| event == "agent-turn")
            .map(|(_, payload)| payload.clone())
            .collect();
        assert_eq!(turn_payloads.len(), 1);
        assert_eq!(turn_payloads[0]["sessionId"], "sid-1");
        assert_eq!(turn_payloads[0]["numTurns"], 1);

        let test_run_payloads: Vec<Value> = recorded
            .iter()
            .filter(|(event, _)| event == "test-run")
            .map(|(_, payload)| payload.clone())
            .collect();
        assert_eq!(test_run_payloads.len(), 1);
        assert_eq!(test_run_payloads[0]["runner"], "cargo");
        assert_eq!(test_run_payloads[0]["summary"]["passed"], 1);
        assert_eq!(test_run_payloads[0]["summary"]["failed"], 0);
    }

    /// Append `\n`-terminated JSONL records to an existing rollout (live-tail tests).
    fn append_rollout(path: &Path, lines: &[Value]) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .expect("open rollout for append");
        for line in lines {
            let serialized = serde_json::to_string(line).expect("serialize rollout line");
            writeln!(file, "{serialized}").expect("append rollout line");
        }
    }

    /// An `exec_command` `function_call` + its `exec_command_end` (a passing
    /// `cargo test` run → one `test-run` snapshot), matched by `call_id`.
    fn exec_test_pair(call_id: &str, ts_start: &str, ts_end: &str) -> [Value; 2] {
        [
            json!({
                "timestamp": ts_start,
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"cargo test\",\"workdir\":\"/tmp/ws\"}",
                    "call_id": call_id
                }
            }),
            json!({
                "timestamp": ts_end,
                "type": "event_msg",
                "payload": {
                    "type": "exec_command_end",
                    "call_id": call_id,
                    "command": ["/bin/bash", "-lc", "cargo test"],
                    "aggregated_output": "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n",
                    "exit_code": 0,
                    "duration": { "secs": 1, "nanos": 0 },
                    "status": "completed"
                }
            }),
        ]
    }

    /// Phase 0 (Task 0.2): pin the replay→live boundary via `test-run` (Codex).
    ///
    /// Characterization test — it must PASS against current code. Three
    /// `exec_command` test-run pairs replay-collapse to one `test-run` at
    /// `finish_replay`; a fourth pair appended *after* catch-up emits a second,
    /// live `test-run`. A sentinel `user_message` (→ agent-turn) is the drain
    /// barrier. We author >=3 pairs (the existing fixture has only one) so the
    /// collapse is observable: `count(test-run) == 2` uniquely means
    /// "1 collapsed + 1 live" (an uncollapsed replay would total >=3).
    #[test]
    fn rollout_replay_collapses_then_live_test_run_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace dir");
        let transcript_path = tmp.path().join("rollout.jsonl");

        let mut records = Vec::new();
        records.extend(exec_test_pair("call_exec1", "2026-05-04T10:00:00Z", "2026-05-04T10:00:01Z"));
        records.extend(exec_test_pair("call_exec2", "2026-05-04T10:00:02Z", "2026-05-04T10:00:03Z"));
        records.extend(exec_test_pair("call_exec3", "2026-05-04T10:00:04Z", "2026-05-04T10:00:05Z"));
        write_rollout(&transcript_path, &records);

        let handle = start_tailing(
            sink.clone(),
            "sid-replay-live".to_string(),
            transcript_path.clone(),
            Some(workspace.clone()), // cwd: test-run snapshot is skipped when None
        )
        .expect("tailing should start");

        // (a) Catch-up barrier: replay collapses the 3 snapshots to one test-run.
        assert!(
            sink.wait_for_count("test-run", 1, Duration::from_secs(5)),
            "replay should emit one collapsed test-run",
        );

        // (b) Append a NEW live pair (call_exec4).
        append_rollout(
            &transcript_path,
            &exec_test_pair("call_exec4", "2026-05-04T10:00:06Z", "2026-05-04T10:00:07Z"),
        );

        // (c) Drain barrier: a sentinel user_message -> agent-turn (baseline-relative).
        let turns_before = sink.count("agent-turn");
        append_rollout(
            &transcript_path,
            &[json!({
                "timestamp": "2026-05-04T10:00:08Z",
                "type": "event_msg",
                "payload": { "type": "user_message", "message": "sentinel" }
            })],
        );
        assert!(
            sink.wait_for_count("agent-turn", turns_before + 1, Duration::from_secs(5)),
            "sentinel agent-turn should drain past the live pair",
        );

        handle.stop();

        // (d) Exactly two test-runs: 1 replay-collapsed + 1 live.
        assert_eq!(sink.count("test-run"), 2, "1 replay-collapsed + 1 live");
    }

    #[test]
    fn summarize_function_call_args_prefers_exec_command_cmd() {
        assert_eq!(
            summarize_function_call_args(Some("{\"cmd\":\"cargo test --workspace --all-features\",\"workdir\":\"/tmp/ws\"}")),
            "cargo test --workspace --all-features"
        );
    }

    #[test]
    fn custom_tool_output_failed_reads_metadata_exit_code() {
        assert!(custom_tool_output_failed(Some("{\"output\":\"nope\",\"metadata\":{\"exit_code\":1}}")));
    }

    // ---- extract_session_cwd unit tests (v2: session_meta ONLY) ----

    #[test]
    fn extract_session_cwd_session_meta_returns_cwd() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"session_meta","payload":{"cwd":"/workspace/A"}}"#).unwrap();
        assert_eq!(extract_session_cwd(&dto), Some("/workspace/A".to_string()));
    }

    #[test]
    fn extract_session_cwd_turn_context_returns_none() {
        // v2 spec section 1: turn_context is INTENTIONALLY NOT a cwd source.
        // Codex's turn_context.cwd is pinned to session-start and treating
        // it as live would cause false reverts after exec_command transitions.
        // This test is a defensive guard against re-introduction.
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"turn_context","payload":{"cwd":"/workspace/A"}}"#).unwrap();
        assert_eq!(extract_session_cwd(&dto), None);
    }

    #[test]
    fn extract_session_cwd_other_type_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"event_msg","payload":{"cwd":"/workspace/A"}}"#).unwrap();
        assert_eq!(extract_session_cwd(&dto), None);
    }

    #[test]
    fn extract_session_cwd_empty_string_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"session_meta","payload":{"cwd":""}}"#).unwrap();
        assert_eq!(extract_session_cwd(&dto), None);
    }

    // ---- extract_exec_workdir unit tests (the mid-session signal) ----

    #[test]
    fn extract_exec_workdir_happy_path() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto).as_deref(), Some("/workspace/B"));
    }

    #[test]
    fn extract_exec_workdir_other_event_type_returns_none() {
        // event_msg carrying a function_call-shaped payload should still
        // be rejected — the outer event type gate is response_item.
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"event_msg","payload":{"type":"function_call","name":"exec_command","arguments":"{\"workdir\":\"/x\"}"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto), None);
    }

    #[test]
    fn extract_exec_workdir_non_function_call_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"exec_command","input":"{\"workdir\":\"/x\"}"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto), None);
    }

    #[test]
    fn extract_exec_workdir_non_exec_command_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"response_item","payload":{"type":"function_call","name":"read_file","arguments":"{\"path\":\"/x\"}"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto), None);
    }

    #[test]
    fn extract_exec_workdir_malformed_arguments_json_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{not json"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto), None);
    }

    #[test]
    fn extract_exec_workdir_missing_workdir_field_returns_none() {
        let dto: CodexLineDto = serde_json::from_str(r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}"}}"#).unwrap();
        assert_eq!(extract_exec_workdir(&dto), None);
    }

    // ---- process_line transition-semantics tests ----

    fn empty_in_flight() -> InFlightToolCalls {
        HashMap::new()
    }

    #[test]
    fn process_line_first_cwd_always_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let line = r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#;
        process_line(
            line,
            "sid-1",
            None,
            &events,
            &mut emitter,
            &mut in_flight,
            &mut num_turns,
            &mut last_cwd,
        );

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 1);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(last_cwd.as_deref(), Some("/workspace/A"));
    }

    #[test]
    fn process_line_repeated_cwd_across_sources_suppresses() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}"#,
        ];
        for line in lines {
            process_line(
                line,
                "sid-1",
                None,
                &events,
                &mut emitter,
                &mut in_flight,
                &mut num_turns,
                &mut last_cwd,
            );
        }

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 1);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
    }

    #[test]
    fn process_line_cwd_transition_across_sources_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c2","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}"#,
        ];
        for line in lines {
            process_line(
                line,
                "sid-1",
                None,
                &events,
                &mut emitter,
                &mut in_flight,
                &mut num_turns,
                &mut last_cwd,
            );
        }

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 3);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1].1["cwd"], "/workspace/B");
        assert_eq!(cwd_events[2].1["cwd"], "/workspace/A");
    }

    /// v2-critical regression guard. Codex review on the v2 spec (HIGH)
    /// flagged that including turn_context.cwd as a cwd source would
    /// cause a false revert: after session_meta(A) → exec_command(B),
    /// the next turn's turn_context(A) (pinned to session-start) would
    /// emit agent-cwd=A and bounce the pane chip back. This test locks
    /// in the v2 design decision to skip turn_context entirely.
    /// If anyone re-adds turn_context to extract_session_cwd, this
    /// test fires.
    #[test]
    fn process_line_turn_context_after_exec_command_does_not_revert() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}"#,
        ];
        for line in lines {
            process_line(
                line,
                "sid-1",
                None,
                &events,
                &mut emitter,
                &mut in_flight,
                &mut num_turns,
                &mut last_cwd,
            );
        }

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(
            cwd_events.len(),
            2,
            "turn_context.cwd MUST NOT emit a cwd event \
             (would cause false revert to session-start after exec_command transition)"
        );
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1].1["cwd"], "/workspace/B");
        // Crucially, last_cwd should still be B — the worktree we're in.
        assert_eq!(last_cwd.as_deref(), Some("/workspace/B"));
    }

    // ---- DTO-migration regression tests (Task 1.6) ----

    #[test]
    fn process_line_wrong_typed_exit_code_emits_done() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let start = r#"{"timestamp":"2026-05-22T10:00:00Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\"}"}}"#;
        process_line(start, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let end = r#"{"timestamp":"2026-05-22T10:00:01Z","type":"event_msg","payload":{"type":"exec_command_end","call_id":"c1","exit_code":"bad","aggregated_output":"ok"}}"#;
        process_line(end, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let tool_calls: Vec<_> = sink.recorded().into_iter().filter(|(n, _)| n == "agent-tool-call").collect();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[1].1["status"], "done");
    }

    #[test]
    fn process_line_wrong_typed_success_emits_failed() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let start = r#"{"timestamp":"2026-05-22T10:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","call_id":"c1","input":"*** Begin Patch\n*** Update File: foo.ts\n*** End Patch"}}"#;
        process_line(start, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let end = r#"{"timestamp":"2026-05-22T10:00:01Z","type":"event_msg","payload":{"type":"patch_apply_end","call_id":"c1","success":"bad"}}"#;
        process_line(end, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let tool_calls: Vec<_> = sink.recorded().into_iter().filter(|(n, _)| n == "agent-tool-call").collect();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[1].1["status"], "failed");
    }

    #[test]
    fn process_line_duration_null_yields_zero_duration() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let start = r#"{"timestamp":"2026-05-22T10:00:00Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\"}"}}"#;
        process_line(start, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let end = r#"{"timestamp":"2026-05-22T10:00:01Z","type":"event_msg","payload":{"type":"exec_command_end","call_id":"c1","exit_code":0,"duration":null}}"#;
        process_line(end, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let tool_calls: Vec<_> = sink.recorded().into_iter().filter(|(n, _)| n == "agent-tool-call").collect();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[1].1["durationMs"], 0);
    }

    #[test]
    fn process_line_non_string_timestamp_emits_not_drops() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let line = r#"{"timestamp":42,"type":"event_msg","payload":{"type":"user_message","message":"hello"}}"#;
        process_line(line, "sid", None, &events, &mut emitter, &mut in_flight, &mut num_turns, &mut last_cwd);

        let turns: Vec<_> = sink.recorded().into_iter().filter(|(n, _)| n == "agent-turn").collect();
        assert_eq!(turns.len(), 1);
    }

    // ---- end-to-end watcher test (with v2 regression guard inline) ----

    #[test]
    fn start_tailing_emits_cwd_transitions_in_order() {
        let sink = Arc::new(FakeEventSink::new());

        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("rollout.jsonl");

        // 7 lines, 3 expected emissions:
        //   1. session_meta cwd=/workspace/A             (emit)
        //   2. turn_context cwd=/workspace/A             (no emit — extractor rejects turn_context)
        //   3. exec_command workdir=/workspace/B         (emit — transition)
        //   4. event_msg task_started                    (no emit)
        //   5. exec_command workdir=/workspace/B         (suppressed — same as last_cwd)
        //   6. turn_context cwd=/workspace/A             (no emit — REGRESSION GUARD: must not revert)
        //   7. exec_command workdir=/workspace/A         (emit — transition back)
        write_rollout(
            &transcript_path,
            &[
                json!({"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:02Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}),
                json!({"timestamp":"2026-05-22T10:00:03Z","type":"event_msg","payload":{"type":"task_started"}}),
                json!({"timestamp":"2026-05-22T10:00:04Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c2","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}),
                json!({"timestamp":"2026-05-22T10:00:04.5Z","type":"turn_context","payload":{"turn_id":"t2","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:05Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c3","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}),
            ],
        );

        let handle = start_tailing(sink.clone(), "sid-cwd".to_string(), transcript_path, None)
            .expect("start tailing");

        std::thread::sleep(Duration::from_millis(750));
        handle.stop();
        std::thread::sleep(Duration::from_millis(100));

        let cwd_events: Vec<Value> = sink
            .recorded()
            .into_iter()
            .filter(|(event, _)| event == "agent-cwd")
            .map(|(_, payload)| payload)
            .collect();

        assert_eq!(cwd_events.len(), 3, "expected exactly 3 cwd transitions");
        assert_eq!(cwd_events[0]["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1]["cwd"], "/workspace/B");
        assert_eq!(cwd_events[2]["cwd"], "/workspace/A");
        for ev in &cwd_events {
            assert_eq!(ev["sessionId"], "sid-cwd");
        }
    }
}
