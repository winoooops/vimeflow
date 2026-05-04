//! Transcript tailer for Codex rollout JSONL files.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::Emitter;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::claude_code::test_runners::build::{maybe_build_snapshot, BuildArgs};
use crate::agent::adapter::claude_code::test_runners::emitter::TestRunEmitter;
use crate::agent::adapter::claude_code::test_runners::matcher::{match_command, MatchedCommand};
use crate::agent::adapter::claude_code::test_runners::test_file_patterns::is_test_file;
use crate::agent::adapter::claude_code::test_runners::timestamps::compute_duration_ms;
use crate::agent::adapter::claude_code::test_runners::types::CapturedOutput;
use crate::agent::adapter::types::ValidateTranscriptError;
use crate::agent::types::{AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};

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

pub(super) fn start_tailing<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
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
        tail_loop(app_handle, session_id, cwd, file, stop_clone);
    });

    Ok(TranscriptHandle::new(stop_flag, join_handle))
}

fn tail_loop<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
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
    let mut emitter = TestRunEmitter::new(app_handle.clone());

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
                        &app_handle,
                        &mut emitter,
                        &mut in_flight,
                        &mut num_turns,
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
                    &app_handle,
                    &mut emitter,
                    &mut in_flight,
                    &mut num_turns,
                );
            }
            Err(e) => {
                log::warn!("Error reading Codex rollout transcript line: {}", e);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn process_line<R: tauri::Runtime>(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return,
    };

    match value.get("type").and_then(Value::as_str) {
        Some("response_item") => {
            process_response_item(&value, session_id, cwd, app_handle, in_flight);
        }
        Some("event_msg") => {
            process_event_msg(
                &value, session_id, cwd, app_handle, emitter, in_flight, num_turns,
            );
        }
        _ => {}
    }
}

fn process_response_item<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
) {
    let payload = value.get("payload").unwrap_or(&Value::Null);
    let timestamp = extract_timestamp(value);

    match payload.get("type").and_then(Value::as_str) {
        Some("function_call") => {
            start_function_call(
                payload,
                session_id,
                cwd,
                app_handle,
                in_flight,
                &timestamp,
            );
        }
        Some("custom_tool_call") => {
            start_custom_tool_call(payload, session_id, app_handle, in_flight, &timestamp);
        }
        Some("function_call_output") => {
            process_output_completion(
                payload,
                session_id,
                app_handle,
                in_flight,
                &timestamp,
                false,
            );
        }
        Some("custom_tool_call_output") => {
            process_output_completion(
                payload,
                session_id,
                app_handle,
                in_flight,
                &timestamp,
                true,
            );
        }
        _ => {}
    }
}

fn process_event_msg<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) {
    let payload = value.get("payload").unwrap_or(&Value::Null);
    let timestamp = extract_timestamp(value);

    match payload.get("type").and_then(Value::as_str) {
        Some("user_message") => {
            process_user_message(payload, session_id, app_handle, num_turns);
        }
        Some("exec_command_end") => {
            process_exec_command_end(
                payload,
                session_id,
                cwd,
                app_handle,
                emitter,
                in_flight,
                &timestamp,
            );
        }
        Some("patch_apply_end") => {
            process_patch_apply_end(payload, session_id, app_handle, in_flight, &timestamp);
        }
        _ => {}
    }
}

fn process_user_message<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle<R>,
    num_turns: &mut u32,
) {
    let Some(message) = payload.get("message").and_then(Value::as_str) else {
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

    if let Err(e) = app_handle.emit("agent-turn", &event) {
        log::warn!("Failed to emit agent-turn event: {}", e);
    }
}

fn start_function_call<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
        return;
    };
    let tool = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let args = summarize_function_call_args(payload);
    let cmd = function_call_cmd(payload);
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
        app_handle,
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

fn start_custom_tool_call<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
        return;
    };
    let tool = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let args = summarize_custom_tool_input(payload);
    let is_test_file = custom_tool_is_test_file(payload);

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
        app_handle,
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

fn process_output_completion<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
    is_custom_tool_output: bool,
) {
    let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
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

    let status = if is_custom_tool_output && custom_tool_output_failed(payload) {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    emit_tool_call(
        app_handle,
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

fn process_exec_command_end<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
        return;
    };

    let Some(call) = in_flight.remove(call_id) else {
        return;
    };

    if let Some(matched) = call.test_match {
        if let Some(cwd_ref) = cwd {
            let captured = CapturedOutput {
                content: payload
                    .get("aggregated_output")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                is_error: payload
                    .get("exit_code")
                    .and_then(Value::as_i64)
                    .is_some_and(|code| code != 0),
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

    let status = if payload
        .get("exit_code")
        .and_then(Value::as_i64)
        .is_some_and(|code| code != 0)
    {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    emit_tool_call(
        app_handle,
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

fn process_patch_apply_end<R: tauri::Runtime>(
    payload: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
        return;
    };

    let Some(call) = in_flight.remove(call_id) else {
        return;
    };

    let status = if payload
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        ToolCallStatus::Done
    } else {
        ToolCallStatus::Failed
    };

    emit_tool_call(
        app_handle,
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

fn emit_tool_call<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>, event: AgentToolCallEvent) {
    if let Err(e) = app_handle.emit("agent-tool-call", &event) {
        log::warn!("Failed to emit agent-tool-call event: {}", e);
    }
}

fn extract_timestamp(value: &Value) -> String {
    value
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}

fn function_call_cmd(payload: &Value) -> Option<String> {
    let raw = payload.get("arguments").and_then(Value::as_str)?;
    let args: Value = serde_json::from_str(raw).ok()?;
    args.get("cmd")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            args.get("command")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn summarize_function_call_args(payload: &Value) -> String {
    if let Some(cmd) = function_call_cmd(payload) {
        return truncate_string(&cmd, MAX_ARGS_LEN);
    }

    let raw = payload
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if let Ok(args) = serde_json::from_str::<Value>(raw) {
        if let Some(path) = args
            .get("path")
            .and_then(Value::as_str)
            .or_else(|| args.get("file_path").and_then(Value::as_str))
        {
            return truncate_string(path, MAX_ARGS_LEN);
        }
    }

    truncate_string(raw, MAX_ARGS_LEN)
}

fn summarize_custom_tool_input(payload: &Value) -> String {
    let input = payload
        .get("input")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(first_path) = extract_patch_paths(input).into_iter().next() {
        return truncate_string(&first_path, MAX_ARGS_LEN);
    }
    truncate_string(input, MAX_ARGS_LEN)
}

fn custom_tool_is_test_file(payload: &Value) -> bool {
    let input = payload
        .get("input")
        .and_then(Value::as_str)
        .unwrap_or_default();

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

fn custom_tool_output_failed(payload: &Value) -> bool {
    let raw = payload.get("output").and_then(Value::as_str).unwrap_or_default();
    let parsed: Value = match serde_json::from_str(raw) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    parsed
        .get("metadata")
        .and_then(|meta| meta.get("exit_code"))
        .and_then(Value::as_i64)
        .is_some_and(|code| code != 0)
}

fn exec_command_duration_ms(payload: &Value) -> Option<u64> {
    let duration = payload.get("duration")?;
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
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tauri::Listener;
    use tauri::test::{mock_builder, MockRuntime};

    fn collect_emits(app: &tauri::App<MockRuntime>, event_name: &'static str) -> Arc<Mutex<Vec<String>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let clone = received.clone();
        app.handle().listen(event_name, move |event| {
            clone
                .lock()
                .expect("event collector lock")
                .push(event.payload().to_string());
        });
        received
    }

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
        std::fs::create_dir_all(
            transcript_path
                .parent()
                .expect("rollout parent directory"),
        )
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
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let tool_calls = collect_emits(&app, "agent-tool-call");
        let turns = collect_emits(&app, "agent-turn");
        let test_runs = collect_emits(&app, "test-run");

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
            app.handle().clone(),
            "sid-1".to_string(),
            transcript_path,
            Some(workspace.clone()),
        )
        .expect("tailing should start");

        std::thread::sleep(Duration::from_millis(750));
        handle.stop();
        std::thread::sleep(Duration::from_millis(100));

        let tool_call_payloads: Vec<Value> = tool_calls
            .lock()
            .expect("tool calls lock")
            .iter()
            .map(|payload| serde_json::from_str(payload).expect("tool call payload json"))
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

        let turn_payloads: Vec<Value> = turns
            .lock()
            .expect("turns lock")
            .iter()
            .map(|payload| serde_json::from_str(payload).expect("turn payload json"))
            .collect();
        assert_eq!(turn_payloads.len(), 1);
        assert_eq!(turn_payloads[0]["sessionId"], "sid-1");
        assert_eq!(turn_payloads[0]["numTurns"], 1);

        let test_run_payloads: Vec<Value> = test_runs
            .lock()
            .expect("test runs lock")
            .iter()
            .map(|payload| serde_json::from_str(payload).expect("test-run payload json"))
            .collect();
        assert_eq!(test_run_payloads.len(), 1);
        assert_eq!(test_run_payloads[0]["runner"], "cargo");
        assert_eq!(test_run_payloads[0]["summary"]["passed"], 1);
        assert_eq!(test_run_payloads[0]["summary"]["failed"], 0);
    }

    #[test]
    fn summarize_function_call_args_prefers_exec_command_cmd() {
        let payload = json!({
            "arguments": "{\"cmd\":\"cargo test --workspace --all-features\",\"workdir\":\"/tmp/ws\"}"
        });

        assert_eq!(
            summarize_function_call_args(&payload),
            "cargo test --workspace --all-features"
        );
    }

    #[test]
    fn custom_tool_output_failed_reads_metadata_exit_code() {
        let payload = json!({
            "output": "{\"output\":\"nope\",\"metadata\":{\"exit_code\":1}}"
        });

        assert!(custom_tool_output_failed(&payload));
    }
}
