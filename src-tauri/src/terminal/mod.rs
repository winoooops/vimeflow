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

// Public command exports (consumed by lib.rs's invoke_handler! macro).
#[cfg(not(test))]
pub use commands::{
    kill_pty, list_sessions, reorder_sessions, resize_pty, set_active_session, spawn_pty,
    update_session_cwd, write_pty,
};
pub use state::PtyState;

// Note: `cache::SessionCache` and the request/response types are accessed
// via fully-qualified paths (`crate::terminal::cache::SessionCache`,
// `super::types::SessionList`, etc.). Re-exporting them here previously
// produced unused-import warnings since nothing consumed `terminal::*`
// for those names — removed.
