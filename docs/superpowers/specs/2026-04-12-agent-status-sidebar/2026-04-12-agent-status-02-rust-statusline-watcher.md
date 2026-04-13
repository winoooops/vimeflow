# Sub-spec 2: Rust Statusline Watcher + Parser

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 1 (types)
**Scope:** File watcher that observes Claude Code's statusline JSON output and emits Tauri events.

## Files to Create

```
src-tauri/src/agent/
├── watcher.rs       // AgentWatcher — orchestrates fs::notify watching
└── statusline.rs    // Parse Claude Code statusline JSON into typed structs
```

## Files to Modify

- `src-tauri/src/agent/mod.rs` — export new modules
- `src-tauri/Cargo.toml` — add `notify` crate dependency

## Dependencies

```toml
[dependencies]
notify = "6"     # File system notification
```

## Statusline Parser (`statusline.rs`)

### Purpose

Parse the JSON that Claude Code writes via its statusline command into our typed structs.

### Input format

Claude Code sends JSON to the statusline command's stdin. Our generated script writes it to `<project>/.vimeflow/sessions/<id>/status.json`. The JSON schema is documented in the parent spec under "Statusline JSON Fields Used".

### Interface

```rust
/// Parse raw JSON string from the statusline file into an AgentStatusEvent.
/// All fields are optional — gracefully handle partial/evolving JSON.
pub fn parse_statusline(session_id: &str, json: &str) -> Result<AgentStatusEvent, String>
```

### Parsing rules

- Use `serde_json::Value` for flexible parsing — don't require all fields
- Map `context_window.used_percentage` (may be null before first API call)
- Map `cost.*` fields
- Map `rate_limits` if present (subscriber detection)
- Map `model.id` and `model.display_name`
- Extract `transcript_path` — return it separately so the watcher can start tailing it
- Log warnings for unexpected formats, don't fail

### Return type

```rust
pub struct ParsedStatusline {
    pub event: AgentStatusEvent,
    pub transcript_path: Option<String>,  // Used by watcher to start transcript tailing
}
```

## Agent Watcher (`watcher.rs`)

### Purpose

Watch a status file for changes and emit Tauri events when it updates.

### Interface

```rust
/// Start watching a statusline file for a given session.
/// Emits `agent-status` Tauri events on each file change.
/// Returns a handle that can be used to stop watching.
pub fn start_watching(
    app_handle: tauri::AppHandle,
    session_id: String,
    status_file_path: PathBuf,
) -> Result<WatcherHandle, String>

/// Stop watching a session's status file.
pub fn stop_watching(handle: WatcherHandle)
```

### Implementation

1. Use `notify::RecommendedWatcher` to watch the status file's parent directory
2. Filter events to only the target file (ignore other files in the directory)
3. On `ModifyKind::Data` or `CreateKind::File` event:
   a. Read the file contents
   b. Call `parse_statusline()` to get typed data
   c. Emit `agent-status` Tauri event with the `AgentStatusEvent` payload
   d. If `transcript_path` is present and transcript watcher isn't started, signal to start it
4. Debounce: ignore events within 100ms of the last processed event (Claude Code already debounces at 300ms, but be safe)

### State management

Use `Arc<Mutex<HashMap<String, WatcherHandle>>>` to track active watchers per session. Same pattern as `PtyState` in `src-tauri/src/terminal/state.rs`.

### Tauri Commands

```rust
#[tauri::command]
pub async fn start_agent_watcher(
    app_handle: tauri::AppHandle,
    session_id: String,
    status_file_path: String,
) -> Result<(), String>

#[tauri::command]
pub async fn stop_agent_watcher(session_id: String) -> Result<(), String>
```

### Tauri Events Emitted

| Event name     | Payload type       | When                        |
| -------------- | ------------------ | --------------------------- |
| `agent-status` | `AgentStatusEvent` | Each statusline file update |

## Acceptance Criteria

- [ ] `cargo build` succeeds with `notify` crate
- [ ] Unit tests for `parse_statusline()` with sample Claude Code JSON (include partial JSON, missing fields, null values)
- [ ] Integration test: write a JSON file, verify watcher emits event
- [ ] Debouncing works — rapid file writes produce at most one event per 100ms
- [ ] `start_agent_watcher` / `stop_agent_watcher` commands registered in `lib.rs`
- [ ] Watcher cleans up on stop (no leaked file handles or threads)

## Notes

- The `notify` crate is battle-tested and used by tools like `cargo-watch`
- The watcher runs on a background thread — don't block the Tauri async runtime
- Status file path follows convention: `<project>/.vimeflow/sessions/<pty-session-id>/status.json`
- Add `.vimeflow/` to `.gitignore` if not already present
