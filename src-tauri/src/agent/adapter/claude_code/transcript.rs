//! Transcript JSONL parser for Claude Code tool call tracking
//!
//! Tails a Claude Code transcript JSONL file and extracts activity events.
//! Emits `agent-tool-call` Tauri events for each tool call start/completion
//! and `agent-turn` events as real user prompts are observed.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::Emitter;

use super::test_runners::emitter::TestRunEmitter;
use super::test_runners::matcher::{match_command, MatchedCommand};
use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::ValidateTranscriptError;
use crate::agent::types::{AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};

/// Poll interval for checking new transcript lines
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Maximum length for the args summary string
const MAX_ARGS_LEN: usize = 100;

const MAX_TOOL_RESULT_CONTENT_LEN: usize = 256 * 1024;
const TOOL_RESULT_TRUNCATED_MARKER: &str = "[output truncated]";

pub(crate) fn validate_transcript_path(
    transcript_path: &str,
) -> Result<PathBuf, ValidateTranscriptError> {
    if transcript_path.bytes().any(|b| b == 0) {
        return Err(ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        ));
    }

    let path = PathBuf::from(transcript_path);
    let canonical = fs::canonicalize(&path).map_err(|e| {
        // Classify directly from the canonicalize failure where the
        // ErrorKind is authoritative (no second syscall = no TOCTOU
        // window). Only `PermissionDenied` is ambiguous: Windows can
        // return it for missing-but-unreadable parents, where the
        // `try_exists()` fallback is the authoritative classifier.
        // All other kinds (Interrupted, InvalidData, etc.) become
        // `Other` directly. Claude review on PR #153, F5 (cycle-2
        // narrowing followed by a cycle-2-retry tightening — codex
        // flagged that the previous "fall back for all non-NotFound"
        // shape only narrowed the race instead of eliminating it).
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

    let home = dirs::home_dir().ok_or_else(|| {
        ValidateTranscriptError::Other("cannot determine home directory".to_string())
    })?;
    let claude_root = home.join(".claude");
    let claude_root = fs::canonicalize(&claude_root).map_err(|e| {
        ValidateTranscriptError::Other(format!(
            "cannot resolve Claude transcript root '{}': {}",
            claude_root.display(),
            e
        ))
    })?;

    if !canonical.starts_with(&claude_root) {
        return Err(ValidateTranscriptError::OutsideRoot {
            path: canonical,
            root: claude_root,
        });
    }

    Ok(canonical)
}

struct InFlightToolCall {
    started_at: Instant,
    started_at_iso: String,
    tool: String,
    args: String,
    is_test_file: bool,
    test_match: Option<MatchedCommand>,
}

type InFlightToolCalls = HashMap<String, InFlightToolCall>;

fn line_type(value: &Value) -> &str {
    value.get("type").and_then(Value::as_str).unwrap_or("")
}

fn tool_block_type(item: &Value) -> &str {
    line_type(item)
}

fn tool_use_id(item: &Value) -> Option<&str> {
    item.get("id").and_then(Value::as_str)
}

fn tool_name(item: &Value) -> &str {
    item.get("name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
}

fn bash_command(item: &Value) -> Option<&str> {
    if tool_name(item) != "Bash" {
        return None;
    }

    item.get("input")
        .and_then(|input| input.get("command"))
        .and_then(Value::as_str)
}

fn tool_file_path(item: &Value) -> Option<&str> {
    item.get("input")
        .and_then(|input| input.get("file_path"))
        .and_then(Value::as_str)
}

fn tool_result_id(value: &Value) -> Option<&str> {
    value.get("tool_use_id").and_then(Value::as_str)
}

fn tool_result_is_error(value: &Value) -> bool {
    value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn text_block_type(block: &Value) -> Option<&str> {
    block.get("type").and_then(Value::as_str)
}

fn text_block_text(block: &Value) -> Option<&str> {
    block.get("text").and_then(Value::as_str)
}

fn input_file_path(input: &Value) -> Option<&str> {
    input.get("file_path").and_then(Value::as_str)
}

fn input_command(input: &Value) -> Option<&str> {
    input.get("command").and_then(Value::as_str)
}

fn input_pattern(input: &Value) -> Option<&str> {
    input.get("pattern").and_then(Value::as_str)
}

/// Start tailing a transcript JSONL file.
/// Reads from the beginning to catch up on missed tool calls.
/// Emits `agent-tool-call` Tauri events for each tool call detected.
pub fn start_tailing<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    transcript_path: PathBuf,
    cwd: Option<PathBuf>,
) -> Result<TranscriptHandle, String> {
    let file = File::open(&transcript_path).map_err(|e| {
        format!(
            "Failed to open transcript: {}: {}",
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

/// Background loop that tails the transcript file
fn tail_loop<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    cwd: Option<PathBuf>,
    file: File,
    stop_flag: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(file);

    // Read from the beginning — each Claude Code session gets a unique JSONL
    // file, so all lines belong to the current session. Replay catches any
    // tool calls written before tailing started (the transcript file is often
    // created seconds after the statusline first reports its path).

    // In-flight tool calls: tool_use_id -> call details
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;

    // Replay-aware emitter — buffers test-run snapshots during the initial
    // catch-up read and emits the latest one (only) on the first EOF. Once
    // we're tailing live, every snapshot emits immediately.
    let mut emitter = TestRunEmitter::new(app_handle.clone());

    // Buffer for partial lines
    let mut line_buf = String::new();

    // Acquire pairs with the Release in `TranscriptHandle::stop` /
    // `Drop` (Claude review on PR #152, F12) so the stop signal is
    // observed promptly on weakly-ordered architectures. Same pattern
    // applied to `WatcherHandle`'s stop_flag in F8.
    while !stop_flag.load(Ordering::Acquire) {
        line_buf.clear();
        match reader.read_line(&mut line_buf) {
            Ok(0) => {
                // First EOF marks the end of replay; subsequent EOFs are
                // idempotent. After this, every submit emits live.
                emitter.finish_replay();
                std::thread::sleep(POLL_INTERVAL);
            }
            Ok(_) => {
                let line = line_buf.trim();
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
                log::warn!("Error reading transcript line: {}", e);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

/// Process a single JSONL line and emit events if it's a tool call
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
        Ok(v) => v,
        Err(_) => {
            // Malformed JSON — skip silently
            return;
        }
    };

    match line_type(&value) {
        "assistant" => {
            process_assistant_message(&value, session_id, cwd, app_handle, in_flight);
        }
        "user" => {
            process_user_message(
                &value, session_id, cwd, app_handle, emitter, in_flight, num_turns,
            );
        }
        "tool_result" => {
            let timestamp = extract_timestamp(&value);
            process_tool_result(
                &value, session_id, cwd, app_handle, emitter, in_flight, &timestamp,
            );
        }
        _ => {
            // Other message types — ignore
        }
    }
}

/// Extract tool_use entries from an assistant message
/// Pull the top-level `timestamp` field off a transcript line, or fall back
/// to the current clock. Claude Code JSONL lines carry the real event time —
/// `now_iso8601()` would otherwise stamp every event parsed in a single tick
/// (e.g. initial watch / batch catch-up) with the same "now", making the UI
/// feed look as if everything happened at once.
fn extract_timestamp(value: &Value) -> String {
    value
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}

fn process_assistant_message<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    in_flight: &mut InFlightToolCalls,
) {
    let content = match message_content_items(value) {
        Some(arr) => arr,
        None => return,
    };

    let timestamp = extract_timestamp(value);

    for item in content {
        if tool_block_type(item) != "tool_use" {
            continue;
        }

        let id = match tool_use_id(item) {
            Some(id) => id.to_string(),
            None => continue,
        };

        let name = tool_name(item).to_string();

        // Run the matcher BEFORE summarize_input truncates — the matcher
        // needs the full untruncated command to tokenize correctly.
        let test_match = bash_command(item).and_then(|cmd| match_command(cmd, cwd));

        let args = summarize_input(item.get("input"));

        // Tag Write/Edit on test files. Use the FULL untruncated
        // input.file_path — `args` is summarized to MAX_ARGS_LEN and
        // long workspace paths could otherwise drop the suffix that
        // makes a file recognizable as a test (e.g. `…ndle.test.ts`).
        let is_test_file = if matches!(name.as_str(), "Write" | "Edit") {
            tool_file_path(item)
                .map(super::test_runners::test_file_patterns::is_test_file)
                .unwrap_or(false)
        } else {
            false
        };

        let now = Instant::now();
        in_flight.insert(
            id.clone(),
            InFlightToolCall {
                started_at: now,
                started_at_iso: timestamp.clone(),
                tool: name.clone(),
                args: args.clone(),
                is_test_file,
                test_match,
            },
        );

        let event = AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool_use_id: id,
            tool: name,
            args,
            status: ToolCallStatus::Running,
            timestamp: timestamp.clone(),
            duration_ms: 0,
            is_test_file,
        };

        if let Err(e) = app_handle.emit("agent-tool-call", &event) {
            log::warn!("Failed to emit agent-tool-call event: {}", e);
        }
    }
}

/// Extract tool_result entries from a user message.
fn process_user_message<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) {
    let content = match message_content(value) {
        Some(content) => content,
        None => return,
    };

    let timestamp = extract_timestamp(value);

    if let Some(items) = content.as_array() {
        for item in items {
            if is_tool_result_block(item) {
                process_tool_result(
                    item, session_id, cwd, app_handle, emitter, in_flight, &timestamp,
                );
            }
        }
    }

    if is_user_prompt(content) {
        *num_turns = num_turns.saturating_add(1);
        let event = AgentTurnEvent {
            session_id: session_id.to_string(),
            num_turns: *num_turns,
        };

        if let Err(e) = app_handle.emit("agent-turn", &event) {
            log::warn!("Failed to emit agent-turn event: {}", e);
        }
    }
}

/// Process a tool_result line and emit Done/Failed event
fn process_tool_result<R: tauri::Runtime>(
    value: &Value,
    session_id: &str,
    cwd: Option<&Path>,
    app_handle: &tauri::AppHandle<R>,
    emitter: &mut TestRunEmitter<R>,
    in_flight: &mut InFlightToolCalls,
    timestamp: &str,
) {
    let tool_use_id = match tool_result_id(value) {
        Some(id) => id.to_string(),
        None => return,
    };

    let is_error = tool_result_is_error(value);

    // An orphaned tool_result — a tool_result whose parent tool_use was
    // never recorded in_flight — arrives most often when a Claude Code
    // session auto-compacts: earlier assistant messages (containing the
    // tool_use blocks) get trimmed from the transcript, but the later
    // user messages carrying their tool_results stay. Emitting a placeholder
    // 'unknown' event for each one surfaces misleading noise in the UI —
    // the tool name is lost, args is empty, duration is zero, and the chip
    // summary grows an 'unknown N' bucket users can't act on. Drop it.
    let Some(call) = in_flight.remove(&tool_use_id) else {
        return;
    };
    let duration_ms = call.started_at.elapsed().as_millis() as u64;
    let tool_name = call.tool;
    let args = call.args;
    let is_test_file = call.is_test_file;

    if let Some(matched) = call.test_match {
        // Pull the captured Bash output content.
        let content = extract_tool_result_content(value);
        let captured = super::test_runners::types::CapturedOutput { content, is_error };
        // Build the snapshot only when we have a workspace cwd. Falling
        // back to `Path::new(".")` would canonicalise to the Tauri app
        // process's cwd — NOT the user's workspace — so test-file groups
        // would resolve against the wrong directory (silently producing
        // non-clickable or misleadingly-scoped rows). When cwd is absent
        // the standard agent-tool-call event still fires below; only the
        // structured test-run snapshot is skipped.
        if let Some(cwd_ref) = cwd {
            let snapshot = super::test_runners::build::maybe_build_snapshot(
                super::test_runners::build::BuildArgs {
                    session_id,
                    matched: &matched,
                    started_at: &call.started_at_iso,
                    finished_at: timestamp,
                    instant_fallback: call.started_at.elapsed(),
                    captured,
                    cwd: cwd_ref,
                },
            );
            if let Some(snap) = snapshot {
                // Route through the replay-aware emitter — during the
                // initial catch-up read this batches to latest-only;
                // after first EOF it emits live.
                emitter.submit(snap);
            }
        } else {
            log::debug!(
                "Skipping test-run snapshot for session {}: no workspace cwd resolved",
                session_id
            );
        }
    }

    let status = if is_error {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    let event = AgentToolCallEvent {
        session_id: session_id.to_string(),
        tool_use_id,
        tool: tool_name,
        args,
        status,
        timestamp: timestamp.to_string(),
        duration_ms,
        is_test_file,
    };

    if let Err(e) = app_handle.emit("agent-tool-call", &event) {
        log::warn!("Failed to emit agent-tool-call event: {}", e);
    }
}

fn message_content_items(value: &Value) -> Option<&[Value]> {
    message_content(value)
        .and_then(|c| c.as_array())
        .map(Vec::as_slice)
}

fn message_content(value: &Value) -> Option<&Value> {
    value.get("message").and_then(|m| m.get("content"))
}

fn is_tool_result_block(value: &Value) -> bool {
    line_type(value) == "tool_result"
}

/// Whether a single content block represents real user content. `tool_result`
/// blocks are tool returns, not prompts. `text` blocks count only when the
/// inner text is non-whitespace (mirrors the symmetric guard on the
/// string-typed content path in `is_user_prompt`). Other block types
/// (image, document, etc.) count as content if present.
fn is_non_empty_user_block(item: &Value) -> bool {
    if is_tool_result_block(item) {
        return false;
    }
    if text_block_type(item) == Some("text") {
        return text_block_text(item)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
    }
    true
}

fn is_user_prompt(content: &Value) -> bool {
    if let Some(text) = content.as_str() {
        return !text.trim().is_empty();
    }

    let Some(items) = content.as_array() else {
        return false;
    };

    items.iter().any(is_non_empty_user_block)
}

/// Summarize a tool input Value into a short string (~100 chars max)
fn summarize_input(input: Option<&Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return String::new(),
    };

    // Try to extract file_path first (common across Read, Write, Edit)
    if let Some(path) = input_file_path(input) {
        return truncate_string(path, MAX_ARGS_LEN);
    }

    // Try command (Bash tool)
    if let Some(cmd) = input_command(input) {
        return truncate_string(cmd, MAX_ARGS_LEN);
    }

    // Try pattern (Grep tool)
    if let Some(pat) = input_pattern(input) {
        return truncate_string(&format!("pattern: {}", pat), MAX_ARGS_LEN);
    }

    // Fallback: stringify the whole input
    let s = input.to_string();
    truncate_string(&s, MAX_ARGS_LEN)
}

/// Truncate a string to max_len characters, appending "..." if truncated.
/// Uses char boundaries to avoid panics on multi-byte UTF-8 (emoji, CJK).
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let end = s
            .char_indices()
            .nth(max_len.saturating_sub(3))
            .map_or(s.len(), |(i, _)| i);
        format!("{}...", &s[..end])
    }
}

/// Get current time as ISO 8601 string (UTC)
fn now_iso8601() -> String {
    // Use std::time for a simple UTC timestamp without chrono dependency
    let now = std::time::SystemTime::now();
    let since_epoch = now
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = since_epoch.as_secs();

    // Simple UTC formatting: YYYY-MM-DDTHH:MM:SSZ
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Days since epoch to date (simplified Gregorian)
    let (year, month, day) = days_to_date(days);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since Unix epoch to (year, month, day)
fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Civil calendar algorithm
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Pull the textual `content` out of a tool_result JSON value.
/// Handles both the simple-string shape and the array-of-blocks shape
/// (where each block may carry `{type:"text", text:"..."}` payloads).
fn extract_tool_result_content(value: &Value) -> String {
    let raw = match value.get("content") {
        Some(c) => c,
        None => return String::new(),
    };
    if let Some(s) = raw.as_str() {
        return capped_tool_result_content(s);
    }
    if let Some(arr) = raw.as_array() {
        let mut out = String::new();
        // Two distinct truncation signals so the marker isn't emitted on
        // a separator-newline miss when the LAST text block exactly fills
        // the cap (Claude review on PR #153). `content_truncated` means
        // `append_capped_text` actually dropped bytes; `blocks_skipped`
        // means we broke out of the loop with more text blocks ahead. The
        // marker fires only if at least one of these is true.
        let mut content_truncated = false;
        let mut blocks_skipped = false;
        let mut iter = arr.iter();
        while let Some(block) = iter.next() {
            if text_block_type(block) == Some("text") {
                if let Some(text) = text_block_text(block) {
                    content_truncated = append_capped_text(&mut out, text);
                    if content_truncated {
                        blocks_skipped = iter.any(|b| {
                            text_block_type(b) == Some("text")
                                && text_block_text(b).is_some()
                        });
                        break;
                    }
                    // Add a separator newline only if the block didn't
                    // already end with one — terminal output frequently
                    // does, and an unconditional `push('\n')` would
                    // produce a double blank line at every block boundary
                    // (the simple-string code path above doesn't add
                    // anything, so this also brings the two paths into
                    // alignment).
                    if !out.ends_with('\n') {
                        if out.len() < MAX_TOOL_RESULT_CONTENT_LEN {
                            out.push('\n');
                        } else {
                            // Cap exactly hit by content; the LAST block
                            // itself wasn't truncated. Only flag the
                            // output as truncated if MORE text blocks
                            // follow this one — otherwise the marker
                            // would falsely claim content was dropped
                            // when only the inter-block separator was
                            // omitted.
                            blocks_skipped = iter.any(|b| {
                                text_block_type(b) == Some("text")
                                    && text_block_text(b).is_some()
                            });
                            break;
                        }
                    }
                }
            }
        }
        if content_truncated || blocks_skipped {
            append_truncated_marker(&mut out);
        }
        return out;
    }
    String::new()
}

fn capped_tool_result_content(content: &str) -> String {
    if content.len() <= MAX_TOOL_RESULT_CONTENT_LEN {
        return content.to_string();
    }

    let mut out = String::new();
    let _ = append_capped_text(&mut out, content);
    append_truncated_marker(&mut out);
    out
}

fn append_capped_text(out: &mut String, text: &str) -> bool {
    let remaining = MAX_TOOL_RESULT_CONTENT_LEN.saturating_sub(out.len());
    if text.len() <= remaining {
        out.push_str(text);
        return false;
    }

    let mut end = remaining;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    out.push_str(&text[..end]);
    true
}

fn append_truncated_marker(out: &mut String) {
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(TOOL_RESULT_TRUNCATED_MARKER);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_transcript_path_rejects_path_outside_claude_root() {
        let tmp = tempfile::tempdir().expect("failed to create temp dir");
        let transcript_path = tmp.path().join("transcript.jsonl");
        std::fs::write(&transcript_path, "").expect("failed to write transcript");

        let result = validate_transcript_path(
            transcript_path
                .to_str()
                .expect("temp transcript path should be UTF-8"),
        );

        assert!(result.is_err());
    }

    #[test]
    fn validate_transcript_path_rejects_null_byte() {
        let result = validate_transcript_path("/home/user/.claude/x.jsonl\0../../etc/passwd");

        assert!(matches!(
            result,
            Err(ValidateTranscriptError::InvalidPath(message))
                if message.contains("null byte")
        ));
    }

    #[test]
    fn parse_tool_use_from_assistant_line() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_abc","name":"Read","input":{"file_path":"/src/foo.ts"}}]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        let content = value["message"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1);

        let item = &content[0];
        assert_eq!(item["type"].as_str().unwrap(), "tool_use");
        assert_eq!(item["id"].as_str().unwrap(), "toolu_abc");
        assert_eq!(item["name"].as_str().unwrap(), "Read");
        assert_eq!(item["input"]["file_path"].as_str().unwrap(), "/src/foo.ts");
    }

    #[test]
    fn parse_tool_result_line() {
        let line = r#"{"type":"tool_result","tool_use_id":"toolu_abc","content":"file contents...","is_error":false}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        assert_eq!(value["type"].as_str().unwrap(), "tool_result");
        assert_eq!(value["tool_use_id"].as_str().unwrap(), "toolu_abc");
        assert!(!value["is_error"].as_bool().unwrap());
    }

    #[test]
    fn parse_tool_result_with_error() {
        let line = r#"{"type":"tool_result","tool_use_id":"toolu_xyz","content":"error msg","is_error":true}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        assert!(value["is_error"].as_bool().unwrap());
    }

    #[test]
    fn extract_tool_result_content_caps_simple_string() {
        let value = serde_json::json!({
            "content": "a".repeat(MAX_TOOL_RESULT_CONTENT_LEN + 1024)
        });

        let content = extract_tool_result_content(&value);

        assert!(content.len() < MAX_TOOL_RESULT_CONTENT_LEN + 1024);
        assert!(content.contains(TOOL_RESULT_TRUNCATED_MARKER));
    }

    #[test]
    fn extract_tool_result_content_caps_text_blocks() {
        let value = serde_json::json!({
            "content": [
                { "type": "text", "text": "a".repeat(MAX_TOOL_RESULT_CONTENT_LEN + 1024) },
                { "type": "text", "text": "should not be appended" }
            ]
        });

        let content = extract_tool_result_content(&value);

        assert!(content.contains(TOOL_RESULT_TRUNCATED_MARKER));
        assert!(!content.contains("should not be appended"));
    }

    /// F1 regression (Claude review on PR #153). When the LAST text
    /// block exactly fills `MAX_TOOL_RESULT_CONTENT_LEN` and does not
    /// end with `\n`, the pre-fix code emitted `[output truncated]`
    /// even though no content was dropped — only the inter-block
    /// separator newline was omitted. The post-fix code distinguishes
    /// `content_truncated` (bytes dropped by `append_capped_text`)
    /// from `blocks_skipped` (more text blocks ahead at break time)
    /// and emits the marker only when at least one is true.
    #[test]
    fn extract_tool_result_content_no_marker_on_exact_cap_fill_last_block() {
        // Block content with no trailing newline that exactly equals
        // the cap. If it were the only text block, the marker MUST NOT
        // be appended (no content was dropped, no blocks skipped).
        let exactly_at_cap: String = "a".repeat(MAX_TOOL_RESULT_CONTENT_LEN);
        let value = serde_json::json!({
            "content": [
                { "type": "text", "text": exactly_at_cap }
            ]
        });

        let content = extract_tool_result_content(&value);

        assert_eq!(content.len(), MAX_TOOL_RESULT_CONTENT_LEN);
        assert!(
            !content.contains(TOOL_RESULT_TRUNCATED_MARKER),
            "marker must not appear for an exact-cap fill on the last block"
        );
    }

    /// Sibling regression to the above: when the FIRST block exactly
    /// fills the cap (no trailing newline) AND a subsequent text block
    /// exists, the marker MUST appear because that subsequent block
    /// was skipped — `blocks_skipped` should be true.
    #[test]
    fn extract_tool_result_content_marker_on_exact_cap_fill_with_subsequent_block() {
        let exactly_at_cap: String = "a".repeat(MAX_TOOL_RESULT_CONTENT_LEN);
        let value = serde_json::json!({
            "content": [
                { "type": "text", "text": exactly_at_cap },
                { "type": "text", "text": "block-two-skipped" }
            ]
        });

        let content = extract_tool_result_content(&value);

        assert!(
            content.contains(TOOL_RESULT_TRUNCATED_MARKER),
            "marker should appear when subsequent text blocks are skipped"
        );
        assert!(!content.contains("block-two-skipped"));
    }

    #[test]
    fn parse_nested_tool_result_from_user_message() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_abc","content":"file contents...","is_error":false}]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        let content = message_content_items(&value).unwrap();
        let result = content
            .iter()
            .find(|item| is_tool_result_block(item))
            .unwrap();

        assert_eq!(result["type"].as_str().unwrap(), "tool_result");
        assert_eq!(result["tool_use_id"].as_str().unwrap(), "toolu_abc");
        assert!(!result["is_error"].as_bool().unwrap());
    }

    #[test]
    fn malformed_json_does_not_panic() {
        let bad_lines = vec![
            "{not valid json",
            "",
            "null",
            r#"{"type":"unknown"}"#,
            r#"{"type":"assistant","message":{}}"#,
            r#"{"type":"assistant","message":{"content":"not an array"}}"#,
            r#"{"type":"tool_result"}"#, // missing tool_use_id
        ];

        // process_line requires app_handle — test the parsing path directly
        for line in &bad_lines {
            let result: Result<Value, _> = serde_json::from_str(line);
            // Should either fail to parse or produce a Value we can handle
            if let Ok(value) = result {
                // These should not cause panics in extraction logic
                let _ = line_type(&value);
                let _ = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array());
                let _ = tool_result_id(&value);
            }
        }
    }

    #[test]
    fn summarize_input_file_path() {
        let input: Value =
            serde_json::from_str(r#"{"file_path":"/src/foo.ts","content":"hello"}"#).unwrap();
        let summary = summarize_input(Some(&input));
        assert_eq!(summary, "/src/foo.ts");
    }

    #[test]
    fn summarize_input_command() {
        let input: Value = serde_json::from_str(r#"{"command":"ls -la /tmp"}"#).unwrap();
        let summary = summarize_input(Some(&input));
        assert_eq!(summary, "ls -la /tmp");
    }

    #[test]
    fn summarize_input_pattern() {
        let input: Value = serde_json::from_str(r#"{"pattern":"foo.*bar"}"#).unwrap();
        let summary = summarize_input(Some(&input));
        assert_eq!(summary, "pattern: foo.*bar");
    }

    #[test]
    fn summarize_input_truncation() {
        let long_path = format!("/very/long/path/{}", "a".repeat(200));
        let input: Value =
            serde_json::from_str(&format!(r#"{{"file_path":"{}"}}"#, long_path)).unwrap();
        let summary = summarize_input(Some(&input));
        assert!(summary.len() <= MAX_ARGS_LEN);
        assert!(summary.ends_with("..."));
    }

    #[test]
    fn summarize_input_none() {
        let summary = summarize_input(None);
        assert!(summary.is_empty());
    }

    #[test]
    fn summarize_input_fallback() {
        let input: Value = serde_json::from_str(r#"{"some_field":"some_value"}"#).unwrap();
        let summary = summarize_input(Some(&input));
        assert!(!summary.is_empty());
        assert!(summary.contains("some_field"));
    }

    #[test]
    fn truncate_string_short() {
        assert_eq!(truncate_string("hello", 100), "hello");
    }

    #[test]
    fn truncate_string_long() {
        let long = "a".repeat(200);
        let result = truncate_string(&long, 100);
        // truncate_string's contract is bounded by character count, not
        // byte count — assert against `chars().count()` (Claude review
        // on PR #152, F17). For all-ASCII inputs `len()` and
        // `chars().count()` agree, so this also matches the previous
        // assertion.
        assert_eq!(result.chars().count(), 100);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn truncate_string_long_cjk_respects_char_boundary() {
        // Multi-byte UTF-8 input: each CJK char is 3 bytes. The byte
        // length of the truncated string can significantly exceed
        // max_len (97 chars × 3 bytes + 3 bytes for "..." = 294 bytes
        // for max_len=100), but the char count must remain at the cap.
        // Regression guard for F17: previously the test asserted
        // `result.len() <= MAX_ARGS_LEN` (bytes), which would have
        // passed for ASCII but given false assurance about CJK paths.
        let cjk = "中".repeat(200);
        let result = truncate_string(&cjk, 100);
        assert_eq!(result.chars().count(), 100);
        assert!(result.ends_with("..."));
        // Byte length is unbounded by design — sanity check it's larger
        // than max_len in chars, proving the char-count is the real cap.
        assert!(result.len() > 100, "byte length should exceed char cap");
    }

    #[test]
    fn now_iso8601_format() {
        let ts = now_iso8601();
        // Should match pattern: YYYY-MM-DDTHH:MM:SSZ
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 20);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], "T");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
    }

    #[test]
    fn days_to_date_pinned_dates() {
        // Pinned-date regression guards for the hand-rolled Hinnant
        // civil-calendar algorithm in `days_to_date` (Claude review on
        // PR #152, F18). The shape-only `now_iso8601_format` test
        // above can't catch off-by-one errors in leap-year accounting
        // or the March-epoch offset; these assertions can. Each entry
        // is `(days_since_unix_epoch, expected (year, month, day))`.
        // Sources: Hinnant reference, https://howardhinnant.github.io/date_algorithms.html
        let cases: [(u64, (u64, u64, u64)); 9] = [
            // Unix epoch.
            (0, (1970, 1, 1)),
            // First leap day after the epoch.
            (789, (1972, 2, 29)),
            // Day after a leap day.
            (790, (1972, 3, 1)),
            // Year-2000 leap year (divisible by 400 — leap).
            (11016, (2000, 2, 29)),
            // Day after a year-2000 leap day.
            (11017, (2000, 3, 1)),
            // Year-2100 NON-leap (divisible by 100 but not 400 — not leap).
            // 2100-02-28 = days_since_epoch 47540.
            (47540, (2100, 2, 28)),
            // Day after that — should be 2100-03-01, NOT 2100-02-29.
            (47541, (2100, 3, 1)),
            // Post-2038 sanity (32-bit-time-rollover-irrelevant for our u64).
            (25339, (2039, 5, 18)),
            // A round-millennium turnover.
            (10957, (2000, 1, 1)),
        ];
        for (days, expected) in cases.iter() {
            let got = days_to_date(*days);
            assert_eq!(
                got, *expected,
                "days_to_date({}) = {:?}, expected {:?}",
                days, got, expected
            );
        }
    }

    #[test]
    fn multiple_tool_uses_in_single_message() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/a.ts"}},{"type":"text","text":"reading"},{"type":"tool_use","id":"toolu_2","name":"Write","input":{"file_path":"/b.ts","content":"x"}}]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        let content = value["message"]["content"].as_array().unwrap();
        let tool_uses: Vec<&Value> = content
            .iter()
            .filter(|item| item["type"].as_str() == Some("tool_use"))
            .collect();

        assert_eq!(tool_uses.len(), 2);
        assert_eq!(tool_uses[0]["name"].as_str().unwrap(), "Read");
        assert_eq!(tool_uses[1]["name"].as_str().unwrap(), "Write");
    }

    #[test]
    fn in_flight_tracking() {
        // Simulate the in-flight map lifecycle
        let mut in_flight: InFlightToolCalls = HashMap::new();

        // Tool call starts
        let start = Instant::now();
        in_flight.insert(
            "toolu_abc".to_string(),
            InFlightToolCall {
                started_at: start,
                started_at_iso: "2026-04-28T12:00:00Z".to_string(),
                tool: "Read".to_string(),
                args: "/src/foo.ts".to_string(),
                is_test_file: false,
                test_match: None,
            },
        );
        assert!(in_flight.contains_key("toolu_abc"));

        // Tool result arrives
        let call = in_flight.remove("toolu_abc").unwrap();
        let duration = call.started_at.elapsed().as_millis() as u64;
        assert_eq!(call.tool, "Read");
        assert_eq!(call.args, "/src/foo.ts");
        assert!(duration < 1000); // Should be near-instant in test
        assert!(in_flight.is_empty());
    }

    #[test]
    fn orphan_signal_is_missing_in_flight_entry() {
        // process_tool_result keys its orphan-drop behavior off exactly
        // this signal: in_flight.remove(id) returns None when the parent
        // tool_use was never recorded (typically because Claude Code
        // transcript compaction trimmed it). The test asserts the
        // prerequisite, not the full emit-side path — a Tauri AppHandle
        // cannot be cheaply constructed in unit tests, so we can't
        // directly observe "no event was emitted" without refactoring
        // process_tool_result to accept an injected channel.
        //
        // If the orphan-drop signal ever changes (e.g. we switch to a
        // different data structure), update this test and the `let Some
        // (call) = in_flight.remove(...) else { return };` guard in
        // process_tool_result together.
        let mut in_flight: InFlightToolCalls = HashMap::new();
        let result = in_flight.remove("toolu_nonexistent");
        assert!(result.is_none());
    }

    // extract_timestamp drives the emitted AgentToolCallEvent.timestamp on
    // every line we parse; before this helper existed, every event was
    // stamped with now_iso8601() and the UI feed collapsed to "all happened
    // just now" on initial watch / batch catch-up. These tests lock in the
    // contract so future refactors can't silently regress it.
    #[test]
    fn extract_timestamp_uses_transcript_field_when_present() {
        let line =
            r#"{"type":"assistant","timestamp":"2026-04-22T10:30:00Z","message":{"content":[]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        assert_eq!(extract_timestamp(&value), "2026-04-22T10:30:00Z");
    }

    #[test]
    fn extract_timestamp_falls_back_to_now_when_absent() {
        let line = r#"{"type":"assistant","message":{"content":[]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        let ts = extract_timestamp(&value);

        // Shape check against now_iso8601 — same ISO-8601 UTC format
        // (YYYY-MM-DDTHH:MM:SSZ). We can't compare exact values because
        // the fallback calls now_iso8601() which reads the wall clock.
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 20);
        assert!(ts.starts_with("20"));
    }

    #[test]
    fn extract_timestamp_ignores_non_string_field() {
        // If a malformed line has a non-string timestamp (e.g. a number
        // or null), we should fall back rather than coerce.
        let line = r#"{"type":"assistant","timestamp":1234567890,"message":{"content":[]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        let ts = extract_timestamp(&value);

        // Falls back to now_iso8601 format (not the numeric literal).
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.len(), 20);
    }

    #[test]
    fn extract_timestamp_preserves_full_iso_string_exactly() {
        // Sub-second precision and timezone offsets should pass through
        // untouched — the frontend parses whatever we emit.
        let line =
            r#"{"type":"user","timestamp":"2026-04-22T10:30:45.123Z","message":{"content":[]}}"#;
        let value: Value = serde_json::from_str(line).unwrap();

        assert_eq!(extract_timestamp(&value), "2026-04-22T10:30:45.123Z");
    }

    // is_user_prompt / is_non_empty_user_block — direct in-module coverage.
    // The integration test at tests/transcript_turns.rs exercises these end
    // to end through the watcher; these unit tests pin the predicate
    // contract so a refactor can't silently regress the edge cases without
    // standing up the Tauri mock harness.

    #[test]
    fn is_user_prompt_string_path_rejects_whitespace_only() {
        assert!(!is_user_prompt(&Value::String("   ".into())));
        assert!(!is_user_prompt(&Value::String("\n\t  \n".into())));
    }

    #[test]
    fn is_user_prompt_string_path_rejects_empty_string() {
        assert!(!is_user_prompt(&Value::String(String::new())));
    }

    #[test]
    fn is_user_prompt_string_path_accepts_non_whitespace() {
        assert!(is_user_prompt(&Value::String("hi".into())));
    }

    #[test]
    fn is_user_prompt_array_path_empty_array_is_not_a_prompt() {
        let content: Value = serde_json::from_str("[]").unwrap();
        assert!(!is_user_prompt(&content));
    }

    #[test]
    fn is_user_prompt_array_path_only_tool_result_is_not_a_prompt() {
        let content: Value = serde_json::from_str(
            r#"[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]"#,
        )
        .unwrap();
        assert!(!is_user_prompt(&content));
    }

    #[test]
    fn is_user_prompt_array_path_whitespace_only_text_block_is_not_a_prompt() {
        let content: Value = serde_json::from_str(r#"[{"type":"text","text":"   "}]"#).unwrap();
        assert!(!is_user_prompt(&content));
    }

    #[test]
    fn is_user_prompt_array_path_mixed_tool_result_plus_text_is_a_prompt() {
        let content: Value = serde_json::from_str(
            r#"[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"},{"type":"text","text":"follow-up"}]"#,
        )
        .unwrap();
        assert!(is_user_prompt(&content));
    }

    #[test]
    fn is_user_prompt_neither_string_nor_array_is_not_a_prompt() {
        // Object / number / null content shapes should fail closed.
        let object: Value = serde_json::from_str(r#"{"key":"value"}"#).unwrap();
        assert!(!is_user_prompt(&object));
        assert!(!is_user_prompt(&Value::Null));
        assert!(!is_user_prompt(&serde_json::json!(42)));
    }

    #[test]
    fn is_non_empty_user_block_unknown_block_type_counts_as_content() {
        // An unknown non-tool_result block type (e.g. image, document, or
        // a future Claude block) is treated as content. Intentional default —
        // documented here so a future contributor doesn't tighten this
        // without thinking through the regression on, say, image messages.
        let block: Value =
            serde_json::from_str(r#"{"type":"image","source":{"type":"base64","data":"..."}}"#)
                .unwrap();
        assert!(is_non_empty_user_block(&block));
    }

    #[test]
    fn is_non_empty_user_block_text_block_with_missing_text_field_is_not_content() {
        // A `text` block without a `text` field, or with a non-string `text`
        // value, fails the non-whitespace check and does not count as content.
        let no_text: Value = serde_json::from_str(r#"{"type":"text"}"#).unwrap();
        assert!(!is_non_empty_user_block(&no_text));

        let non_string_text: Value = serde_json::from_str(r#"{"type":"text","text":42}"#).unwrap();
        assert!(!is_non_empty_user_block(&non_string_text));
    }

    #[test]
    fn is_non_empty_user_block_block_with_missing_or_non_string_type_falls_through_to_content() {
        // Blocks where the `type` field is absent or non-string take the
        // unknown-block fall-through and count as content. This mirrors the
        // image / document / future-Claude-block case (see
        // is_non_empty_user_block_unknown_block_type_counts_as_content) —
        // anything that is not explicitly `tool_result` and not an empty
        // `text` block is permissive by default. Documenting the contract
        // here so a future tightening (e.g. require an explicit allowlist
        // of known content types) is a deliberate change, not silent drift.
        let no_type: Value = serde_json::from_str("{}").unwrap();
        assert!(is_non_empty_user_block(&no_type));

        let non_string_type: Value = serde_json::from_str(r#"{"type":42,"text":"hello"}"#).unwrap();
        assert!(is_non_empty_user_block(&non_string_type));

        let null_type: Value = serde_json::from_str(r#"{"type":null,"text":"hello"}"#).unwrap();
        assert!(is_non_empty_user_block(&null_type));
    }
}
