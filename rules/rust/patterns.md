# Rust Backend Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Rust-specific content for the `vimeflow-backend` sidecar crate (the Rust process that Electron spawns and talks to over stdio).

> Historical note: this file used to document `#[tauri::command]` handlers and `tauri::State<'_, _>`. PR-D3 (2026-05-16) removed the Tauri runtime; the patterns below describe the post-PR-D3 architecture (`BackendState` + `_inner` helpers + LSP-framed JSON IPC).

## BackendState + `_inner` helpers

The runtime-neutral entry point for every IPC command is a method on `BackendState` (defined in `crates/backend/src/runtime/state.rs`). It delegates to a `pub(crate) fn xxx_inner(...)` helper that takes plain arguments (no runtime handle):

```rust
// crates/backend/src/runtime/state.rs — the IPC router calls these methods.
impl BackendState {
    pub async fn spawn_pty(
        &self,
        request: SpawnPtyRequest,
    ) -> Result<PtySession, String> {
        crate::terminal::commands::spawn_pty_inner(
            self.pty.clone(),
            self.sessions.clone(),
            self.events.clone(),
            request,
        )
        .await
    }
}

// crates/backend/src/terminal/commands.rs — the actual logic; runtime-neutral.
pub(crate) async fn spawn_pty_inner(
    pty: PtyState,
    sessions: Arc<SessionCache>,
    events: Arc<dyn EventSink>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    // Validate input
    // Perform operation
    // Return result
}
```

- All `BackendState` method args and return types implement `serde::Serialize` / `serde::Deserialize` — the IPC router (`crates/backend/src/runtime/ipc.rs`) deserializes the request frame and re-serializes the response.
- Return `Result<T, String>` so the bare-string rejection contract makes it all the way to the renderer (`src/lib/backend.ts`'s `invoke` rejects with the same string).
- Validate all inputs in the `_inner` helper — frames coming off stdio are untrusted.
- Co-locate a `#[cfg(test)] pub fn xxx(args)` alias next to each `_inner` helper so tests call the command name directly without setting up a `BackendState` (see `crates/backend/src/git/mod.rs:559`).

## State ownership

`BackendState` is the only shared-mutable-state container the sidecar exposes. Build it once in `crates/backend/src/bin/vimeflow-backend.rs`, wrap in `Arc`, and pass into the IPC router:

```rust
let sink: Arc<dyn EventSink> = Arc::new(ipc::StdoutEventSink::new(tx.clone()));
let state = Arc::new(BackendState::new(app_data_dir, sink));
ipc::run(state.clone(), tokio::io::stdin(), tx, cancel.clone()).await;
```

- Wrap fine-grained mutable state inside `BackendState` (`PtyState`, `SessionCache`, etc.) in `Mutex<T>` / `RwLock<T>` — `BackendState` itself is shared via `Arc` and accessed concurrently from the IPC router's per-request `JoinSet` tasks.
- Keep lock scopes short. Prefer `RwLock` when reads vastly outnumber writes.

## Event System

Push notifications from sidecar to renderer go through `EventSink` (defined in `crates/backend/src/runtime/event_sink.rs`):

```rust
// Backend emits via the trait.
pub trait EventSink: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: serde_json::Value) -> Result<(), String>;
}

// Production: StdoutEventSink writes an LSP-framed `event` frame.
events.emit_json("pty-data", serde_json::json!({
    "sessionId": id,
    "data": chunk,
    "offsetStart": offset,
    "byteLen": bytes.len(),
}))?;

// Tests: FakeEventSink records emissions for assertions.
```

The renderer subscribes through the bridge:

```ts
import { listen, type UnlistenFn } from '@/lib/backend'

const unlisten: UnlistenFn = await listen('pty-data', (payload) => {
  // payload is the bare value, NOT a Tauri Event<T> envelope
})

// Clean up on component unmount.
unlisten()
```

- Use IPC requests (`invoke`) for renderer-initiated round-trips; events for sidecar-initiated push.
- Keep event payloads JSON-serializable and small. The IPC writer task is bounded (`STDOUT_QUEUE_CAPACITY`); backpressure logs a warning and blocks the producer task.
- Always `await listen(...)` before triggering an IPC call that would otherwise race the attachment (the renderer-side bridge resolves only after the transport listener is attached).

## Error types

Define a domain error enum for `_inner` helpers and surface it as a `String` at the `BackendState` boundary:

```rust
#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

// At the BackendState boundary, flatten to String so the IPC router can
// put it in the response frame's `error` field.
impl BackendState {
    pub fn list_dir(&self, request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
        crate::filesystem::list::list_dir_inner(request).map_err(|e| e.to_string())
    }
}
```

The renderer-side bridge throws the bare string as-is (no `Error` wrap), so unit tests can `await expect(invoke(...)).rejects.toBe('Not found: ...')`.
