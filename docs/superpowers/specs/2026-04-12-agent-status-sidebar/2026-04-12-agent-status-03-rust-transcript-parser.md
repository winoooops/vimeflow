# Sub-spec 3: Rust Transcript Parser

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 1 (types)
**Scope:** Tail Claude Code's transcript JSONL file and extract tool call events.

## Files to Create

```
src-tauri/src/agent/
└── transcript.rs    // TranscriptParser — tail JSONL, extract tool calls
```

## Files to Modify

- `src-tauri/src/agent/mod.rs` — export new module
- `src-tauri/src/agent/watcher.rs` — start transcript tailing when `transcript_path` is received from statusline

## Purpose

Claude Code writes a JSONL transcript file (one JSON object per line) at the path provided in `statusline.transcript_path`. This file contains the full conversation including tool calls, results, and messages.

We tail this file (read new lines as they're appended) and extract tool call events to emit as Tauri events.

## Transcript JSONL Format

Each line is a JSON object. The relevant entries for tool calls look like:

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_xxx","name":"Read","input":{"file_path":"/src/foo.ts"}}]}}
{"type":"tool_result","tool_use_id":"toolu_xxx","content":"file contents...","is_error":false}
```

### Extraction rules

1. **Tool call start**: look for `type: "assistant"` messages containing `content[].type == "tool_use"`
   - Extract: `name` (tool name), `input` (stringify/truncate to ~100 chars for `args`)
   - Emit: `AgentToolCallEvent` with `status: Running`

2. **Tool call result**: look for `type: "tool_result"` with matching `tool_use_id`
   - Extract: `is_error` (maps to `Done` or `Failed`)
   - Emit: updated `AgentToolCallEvent` with `status: Done` or `Failed`
   - Calculate `duration_ms` from timestamps if available

3. **File changes**: derive from tool calls
   - `Write` tool → file created/overwritten
   - `Edit` tool → file modified
   - Extract file path from `input.file_path`

## Interface

```rust
/// Start tailing a transcript JSONL file.
/// Seeks to end of file on start (don't replay history).
/// Emits `agent-tool-call` Tauri events for each tool call detected.
pub fn start_tailing(
    app_handle: tauri::AppHandle,
    session_id: String,
    transcript_path: PathBuf,
) -> Result<TranscriptHandle, String>

/// Stop tailing.
pub fn stop_tailing(handle: TranscriptHandle)
```

## Implementation

1. Open the transcript file, seek to end
2. Spawn a background thread that polls for new data every 500ms (or use `notify` on the file)
3. Read new lines, parse each as JSON
4. Match on relevant types, extract tool call data
5. Maintain an in-memory map of `tool_use_id → start_time` for duration calculation
6. Emit Tauri events

### Robustness

- Handle partial lines (line not yet fully written) — buffer until newline
- Handle JSON parse errors on individual lines — skip and continue
- Handle file truncation (unlikely but possible) — reset to beginning
- Handle file not existing yet — retry with backoff

## Tauri Events Emitted

| Event name        | Payload type         | When                                |
| ----------------- | -------------------- | ----------------------------------- |
| `agent-tool-call` | `AgentToolCallEvent` | Each tool call start and completion |

## Tauri Commands

```rust
#[tauri::command]
pub async fn start_transcript_watcher(
    app_handle: tauri::AppHandle,
    session_id: String,
    transcript_path: String,
) -> Result<(), String>

#[tauri::command]
pub async fn stop_transcript_watcher(session_id: String) -> Result<(), String>
```

## Acceptance Criteria

- [ ] `cargo build` succeeds
- [ ] Unit tests: parse sample JSONL lines, verify correct `AgentToolCallEvent` extraction
- [ ] Unit tests: handle partial lines, malformed JSON, missing fields
- [ ] Integration test: append lines to a file, verify events emitted
- [ ] Seeks to end on start — doesn't replay old tool calls
- [ ] Commands registered in `lib.rs`
- [ ] Background thread cleans up on stop

## Notes

- The transcript format is Claude Code's internal format — it may change between versions. Parse defensively with `serde_json::Value`, not strict struct deserialization.
- Don't store the full transcript in memory — only track the last ~10 tool calls for the "recent" list. The frontend manages its own state.
- This module is started by the watcher (sub-spec 2) when it receives `transcript_path` from the first statusline update. It can also be started independently via the Tauri command.
