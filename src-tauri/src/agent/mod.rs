//! Agent detection and status tracking module
//!
//! This module provides types and utilities for detecting which coding agent
//! (Claude Code, Codex, Aider) is running in a PTY session and tracking
//! agent status metrics.

pub mod adapter;
pub mod commands;
pub mod detector;
pub mod types;

// Re-export commonly used types for external modules and frontend
#[allow(unused_imports)]
pub use types::{AgentDetectedEvent, AgentDisconnectedEvent, AgentType};

// Re-export Tauri commands
pub use adapter::base::TranscriptState;
pub use adapter::{AgentWatcherState, start_agent_watcher, stop_agent_watcher};
pub use commands::detect_agent_in_session;
