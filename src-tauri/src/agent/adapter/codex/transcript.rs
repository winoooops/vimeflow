//! Codex transcript tailer stub.

use std::path::PathBuf;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::ValidateTranscriptError;

pub(super) fn validate_transcript() -> Result<PathBuf, ValidateTranscriptError> {
    Err(ValidateTranscriptError::Other(
        "codex transcript tailer not yet implemented".to_string(),
    ))
}

pub(super) fn tail_transcript() -> Result<TranscriptHandle, String> {
    Err("codex transcript tailer not yet implemented".to_string())
}
