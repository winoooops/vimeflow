# Tracing Observability Design

**Date:** 2026-06-08
**Branch:** `feat/tracing-observability`
**Scope:** Additive tracing for selected user interaction, IPC, backend, and agent
state transitions. This does not replace existing `log::` or renderer diagnostic
logging.

## Architecture

Tracing is a local-only JSONL store owned by the Rust sidecar. The renderer never
writes files; it sends trace-safe interaction metadata over the existing backend
IPC bridge. `BackendState` owns a `TraceService` rooted at the existing
`--app-data-dir`, and wraps the existing stdout `EventSink` with a tracing sink
that forwards unchanged `agent-*` IPC events while also appending trace records.

The initial vertical slice instruments pane rename because it naturally crosses
all required boundaries: command-palette or rename chord user action,
`rename_agent_session` IPC, backend PTY write, and the later Claude Code/Codex
agent title event. The same service can be expanded to other interactions and
agent fields without changing existing frontend event schemas.

## Store And Retention

Trace files live under `<app-data-dir>/logs/trace.jsonl`, where
`<app-data-dir>` is the sidecar flag already used for `sessions.json`.

Per-OS defaults:

- Linux: `~/.local/share/vimeflow/logs/trace.jsonl`
- macOS: `~/Library/Application Support/vimeflow/logs/trace.jsonl`
- Windows: unsupported for this feature

The file is created with mode `0600` on Unix, newline/CR content is escaped before
serialization, and path resolution fails closed when no app-data directory is
available. Rotation is size bounded: when `trace.jsonl` reaches the configured
maximum, existing generations shift to `.2` / `.3`, the current file becomes
`.1`, and the oldest generation is deleted.

## JSONL Schema

Each line is one JSON object:

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-06-08T12:34:56.789Z",
  "correlationId": "vf_...",
  "spanId": "vf_...",
  "parentSpanId": "vf_...",
  "layer": "frontend|ipc|backend|agent",
  "event": "user.interaction|ipc.request|backend.work|agent.event|ipc.result",
  "sessionId": "pty-1",
  "agentType": "codex",
  "status": "ok|error",
  "attributes": {}
}
```

`attributes` is allowlisted per event. Prompt text, response text, terminal
input, file contents, tool arguments, and transcript bodies are not persisted by
default.

## Correlation Flow

The renderer generates a correlation id and root span id for the user action,
records `frontend/user.interaction`, then sends the same correlation id through
the IPC request payload. The sidecar records `ipc/request`, `backend/work`, and
`ipc/result` records around the command. For commands tied to a PTY session, the
sidecar stores a short-lived `session_id -> correlation_id` association. When
the tracing event sink observes a later `agent-*` event for that session, it
records `agent/event` with the same correlation id while forwarding the original
event unchanged to the renderer.

## Privacy And Redaction

Tracing is disabled by default and must be enabled by an explicit setting over
IPC. It never sends data off-device. Event attributes are allowlisted and then
redacted defensively:

- secret-looking keys such as `token`, `password`, `secret`, `apiKey`, and
  `authorization` are replaced with `[redacted]`
- bearer tokens and common API-key/token patterns inside strings are replaced
  with `[redacted]`
- file paths are reduced to safe basenames or event-specific metadata unless an
  event explicitly needs a workspace/session id
- string values are length capped after newline and carriage-return escaping

If tracing cannot safely write to the app-data log path, the sidecar drops the
trace record and returns an error for explicit trace commands. It does not fall
back to temporary directories.
