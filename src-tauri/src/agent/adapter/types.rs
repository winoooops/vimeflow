//! Provider-hook types used by `AgentAdapter` implementations.

use std::path::PathBuf;

use crate::agent::types::AgentStatusEvent;

#[derive(Debug, Clone)]
pub struct StatusSource {
    pub path: PathBuf,
    pub trust_root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ParsedStatus {
    pub event: AgentStatusEvent,
    pub transcript_path: Option<String>,
}
