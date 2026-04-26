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

pub use commands::*;
pub use state::PtyState;
