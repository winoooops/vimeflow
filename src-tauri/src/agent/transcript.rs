//! Transcript JSONL parser for Claude Code tool call tracking
//!
//! Tails a Claude Code transcript JSONL file and extracts tool call events.
//! Emits `agent-tool-call` Tauri events for each tool call start and completion.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::Emitter;

use super::types::{AgentToolCallEvent, ToolCallStatus};

/// Poll interval for checking new transcript lines
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Maximum length for the args summary string
const MAX_ARGS_LEN: usize = 100;

/// Handle returned by `start_tailing` to control the background watcher
pub struct TranscriptHandle {
    stop_flag: Arc<AtomicBool>,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

impl TranscriptHandle {
    /// Signal the background thread to stop and wait for it to finish
    pub fn stop(mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

/// State shared across transcript watchers, keyed by session ID
#[derive(Default, Clone)]
pub struct TranscriptState {
    watchers: Arc<Mutex<HashMap<String, TranscriptHandle>>>,
}

impl TranscriptState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start tailing a transcript for the given session.
    /// If a watcher already exists for this session, it is stopped first.
    pub fn start(
        &self,
        app_handle: tauri::AppHandle,
        session_id: String,
        transcript_path: PathBuf,
    ) -> Result<(), String> {
        let mut watchers = self.watchers.lock().expect("failed to lock watchers");

        // Stop existing watcher for this session if any
        if let Some(old) = watchers.remove(&session_id) {
            old.stop();
        }

        let handle = start_tailing(app_handle, session_id.clone(), transcript_path)?;
        watchers.insert(session_id, handle);
        Ok(())
    }

    /// Stop tailing for the given session.
    pub fn stop(&self, session_id: &str) -> Result<(), String> {
        let mut watchers = self.watchers.lock().expect("failed to lock watchers");
        match watchers.remove(session_id) {
            Some(handle) => {
                handle.stop();
                Ok(())
            }
            None => Err(format!("No transcript watcher for session: {}", session_id)),
        }
    }
}

/// Start tailing a transcript JSONL file.
/// Seeks to end of file on start (don't replay history).
/// Emits `agent-tool-call` Tauri events for each tool call detected.
pub fn start_tailing(
    app_handle: tauri::AppHandle,
    session_id: String,
    transcript_path: PathBuf,
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
        tail_loop(app_handle, session_id, file, stop_clone);
    });

    Ok(TranscriptHandle {
        stop_flag,
        join_handle: Some(join_handle),
    })
}

/// Background loop that tails the transcript file
fn tail_loop(
    app_handle: tauri::AppHandle,
    session_id: String,
    file: File,
    stop_flag: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(file);

    // Seek to end — don't replay old entries
    if let Err(e) = reader.seek(SeekFrom::End(0)) {
        log::error!("Failed to seek transcript to end: {}", e);
        return;
    }

    // In-flight tool calls: tool_use_id -> (start_time, tool_name)
    let mut in_flight: HashMap<String, (Instant, String)> = HashMap::new();

    // Buffer for partial lines
    let mut line_buf = String::new();

    while !stop_flag.load(Ordering::Relaxed) {
        line_buf.clear();
        match reader.read_line(&mut line_buf) {
            Ok(0) => {
                // No new data — sleep and retry
                std::thread::sleep(POLL_INTERVAL);
            }
            Ok(_) => {
                let line = line_buf.trim();
                if line.is_empty() {
                    continue;
                }
                process_line(line, &session_id, &app_handle, &mut in_flight);
            }
            Err(e) => {
                log::warn!("Error reading transcript line: {}", e);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

/// Process a single JSONL line and emit events if it's a tool call
fn process_line(
    line: &str,
    session_id: &str,
    app_handle: &tauri::AppHandle,
    in_flight: &mut HashMap<String, (Instant, String)>,
) {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            // Malformed JSON — skip silently
            return;
        }
    };

    let line_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match line_type {
        "assistant" => {
            process_assistant_message(&value, session_id, app_handle, in_flight);
        }
        "tool_result" => {
            process_tool_result(&value, session_id, app_handle, in_flight);
        }
        _ => {
            // Other message types — ignore
        }
    }
}

/// Extract tool_use entries from an assistant message
fn process_assistant_message(
    value: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle,
    in_flight: &mut HashMap<String, (Instant, String)>,
) {
    let content = match value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        Some(arr) => arr,
        None => return,
    };

    for item in content {
        let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if item_type != "tool_use" {
            continue;
        }

        let id = match item.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let args = summarize_input(item.get("input"));

        let now = Instant::now();
        in_flight.insert(id.clone(), (now, name.clone()));

        let event = AgentToolCallEvent {
            session_id: session_id.to_string(),
            tool: name,
            args,
            status: ToolCallStatus::Running,
            timestamp: now_iso8601(),
            duration_ms: 0,
        };

        if let Err(e) = app_handle.emit("agent-tool-call", &event) {
            log::warn!("Failed to emit agent-tool-call event: {}", e);
        }
    }
}

/// Process a tool_result line and emit Done/Failed event
fn process_tool_result(
    value: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle,
    in_flight: &mut HashMap<String, (Instant, String)>,
) {
    let tool_use_id = match value.get("tool_use_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return,
    };

    let is_error = value
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let (duration_ms, tool_name) = match in_flight.remove(&tool_use_id) {
        Some((start, name)) => {
            let dur = start.elapsed().as_millis() as u64;
            (dur, name)
        }
        None => {
            // No matching in-flight call — emit with unknown tool name
            (0, "unknown".to_string())
        }
    };

    let status = if is_error {
        ToolCallStatus::Failed
    } else {
        ToolCallStatus::Done
    };

    let event = AgentToolCallEvent {
        session_id: session_id.to_string(),
        tool: tool_name,
        args: String::new(),
        status,
        timestamp: now_iso8601(),
        duration_ms,
    };

    if let Err(e) = app_handle.emit("agent-tool-call", &event) {
        log::warn!("Failed to emit agent-tool-call event: {}", e);
    }
}

/// Summarize a tool input Value into a short string (~100 chars max)
fn summarize_input(input: Option<&Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return String::new(),
    };

    // Try to extract file_path first (common across Read, Write, Edit)
    if let Some(path) = input.get("file_path").and_then(|v| v.as_str()) {
        return truncate_string(path, MAX_ARGS_LEN);
    }

    // Try command (Bash tool)
    if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
        return truncate_string(cmd, MAX_ARGS_LEN);
    }

    // Try pattern (Grep tool)
    if let Some(pat) = input.get("pattern").and_then(|v| v.as_str()) {
        return truncate_string(&format!("pattern: {}", pat), MAX_ARGS_LEN);
    }

    // Fallback: stringify the whole input
    let s = input.to_string();
    truncate_string(&s, MAX_ARGS_LEN)
}

/// Truncate a string to max_len, appending "..." if truncated
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
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

// --- Tauri Commands ---

/// Start watching a transcript JSONL file for tool call events
#[tauri::command]
pub async fn start_transcript_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, TranscriptState>,
    session_id: String,
    transcript_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&transcript_path);
    if !path.exists() {
        return Err(format!("Transcript file not found: {}", transcript_path));
    }
    state.start(app_handle, session_id, path)
}

/// Stop watching a transcript JSONL file
#[tauri::command]
pub async fn stop_transcript_watcher(
    state: tauri::State<'_, TranscriptState>,
    session_id: String,
) -> Result<(), String> {
    state.stop(&session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

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
                let _ = value.get("type").and_then(|t| t.as_str());
                let _ = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array());
                let _ = value.get("tool_use_id").and_then(|v| v.as_str());
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
        assert_eq!(result.len(), 100);
        assert!(result.ends_with("..."));
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
        let mut in_flight: HashMap<String, (Instant, String)> = HashMap::new();

        // Tool call starts
        let start = Instant::now();
        in_flight.insert("toolu_abc".to_string(), (start, "Read".to_string()));
        assert!(in_flight.contains_key("toolu_abc"));

        // Tool result arrives
        let (start_time, tool_name) = in_flight.remove("toolu_abc").unwrap();
        let duration = start_time.elapsed().as_millis() as u64;
        assert_eq!(tool_name, "Read");
        assert!(duration < 1000); // Should be near-instant in test
        assert!(in_flight.is_empty());
    }

    #[test]
    fn tool_result_without_matching_start() {
        // Should handle gracefully when there's no matching in-flight call
        let mut in_flight: HashMap<String, (Instant, String)> = HashMap::new();

        let result = in_flight.remove("toolu_nonexistent");
        assert!(result.is_none());

        // The process_tool_result function handles this with defaults
        let (duration_ms, tool_name) = match result {
            Some((start, name)) => (start.elapsed().as_millis() as u64, name),
            None => (0, "unknown".to_string()),
        };
        assert_eq!(duration_ms, 0);
        assert_eq!(tool_name, "unknown");
    }
}
