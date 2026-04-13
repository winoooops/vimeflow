//! Agent detection and status tracking module
//!
//! This module provides types and utilities for detecting which coding agent
//! (Claude Code, Codex, Aider) is running in a PTY session and tracking
//! agent status metrics.

pub mod commands;
pub mod detector;
pub mod statusline;
pub mod transcript;
pub mod types;
pub mod watcher;

// Re-export commonly used types for external modules and frontend
#[allow(unused_imports)]
pub use types::{AgentDetectedEvent, AgentDisconnectedEvent, AgentType};

// Re-export Tauri commands
pub use commands::detect_agent_in_session;
pub use watcher::{start_agent_watcher, stop_agent_watcher, AgentWatcherState};
pub use transcript::{start_transcript_watcher, stop_transcript_watcher, TranscriptState};
