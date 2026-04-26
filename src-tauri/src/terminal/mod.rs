//! Terminal PTY management module
//!
//! This module handles PTY (pseudo-terminal) spawning, lifecycle management,
//! and IPC communication with the frontend via Tauri commands and events.

pub mod bridge;
pub mod cache;
pub mod commands;
pub mod state;
#[cfg(feature = "e2e-test")]
pub mod test_commands;
pub mod types;

pub use cache::SessionCache;
pub use commands::{
    kill_pty, list_sessions, reorder_sessions, resize_pty, set_active_session, spawn_pty,
    update_session_cwd, write_pty,
};
pub use state::PtyState;
pub use types::{
    ReorderSessionsRequest, SessionInfo, SessionList, SessionStatus, SetActiveSessionRequest,
    UpdateSessionCwdRequest,
};
