# Rust / Tauri Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Rust and Tauri-specific content.

## Tauri Command Handlers

Commands are the primary IPC mechanism (request/response from frontend to backend):

```rust
#[tauri::command]
async fn my_command(
    state: tauri::State<'_, AppState>,
    arg: String,
) -> Result<ResponseType, String> {
    // Validate input
    // Perform operation
    // Return result
}
```

- All arguments and return types must implement `serde::Serialize` / `serde::Deserialize`
- Return `Result<T, String>` or a custom error type implementing `Into<tauri::InvokeError>`
- Validate all inputs on the Rust side — the frontend is untrusted
- Register commands in `tauri::Builder` via `.invoke_handler(tauri::generate_handler![...])`

## Managed State

Use Tauri's state management for shared application state:

```rust
struct AppState {
    data: Mutex<MyData>,
}

// Register at startup
app.manage(AppState { data: Mutex::new(MyData::default()) });

// Access in commands
fn my_command(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    // use data
}
```

- Wrap mutable state in `Mutex<T>` or `RwLock<T>` for thread safety
- Keep lock scopes short to avoid contention and deadlocks
- Prefer `RwLock` when reads vastly outnumber writes

## Event System

Events are for push notifications from backend to frontend:

```rust
// Backend emits
app_handle.emit_all("event-name", payload)?;
window.emit("event-name", payload)?;

// Frontend listens
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen('event-name', (event) => { ... });
// Clean up on component unmount
unlisten();
```

- Use commands for request/response; events for backend-initiated notifications
- Keep event payloads small and JSON-serializable

## Error Types

Define a domain error enum for command handlers:

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

impl From<AppError> for tauri::InvokeError {
    fn from(err: AppError) -> Self {
        tauri::InvokeError::from(err.to_string())
    }
}
```
