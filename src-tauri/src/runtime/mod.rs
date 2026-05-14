//! Runtime-neutral backend layer. Production builds bind to Tauri via
//! `TauriEventSink`; PR-B will add a sidecar IPC sink. Tests use
//! `FakeEventSink`.

pub mod event_sink;
pub mod ipc;
pub mod state;
pub mod tauri_bridge;

pub(crate) use event_sink::serialize_event;
pub use event_sink::EventSink;
pub use state::BackendState;
pub use tauri_bridge::TauriEventSink;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
