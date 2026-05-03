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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidateTranscriptError {
    NotFound(PathBuf),
    OutsideRoot { path: PathBuf, root: PathBuf },
    NotAFile(PathBuf),
    InvalidPath(String),
    Other(String),
}

impl std::fmt::Display for ValidateTranscriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(path) => write!(f, "transcript path not found: {}", path.display()),
            Self::OutsideRoot { path, root } => write!(
                f,
                "transcript path is outside Claude directory: {} not under {}",
                path.display(),
                root.display()
            ),
            Self::NotAFile(path) => write!(f, "not a transcript file: {}", path.display()),
            Self::InvalidPath(message) | Self::Other(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ValidateTranscriptError {}
