//! Terminal PTY management module
//!
//! This module handles PTY (pseudo-terminal) spawning, lifecycle management,
//! and IPC communication with the frontend via Tauri commands and events.

pub mod commands;
pub mod state;
pub mod types;

pub use commands::*;
pub use state::PtyState;
