//! Provider-hook types used by `AgentAdapter` implementations.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

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

#[derive(Debug, Clone, Copy)]
pub struct BindContext<'a> {
    pub session_id: &'a str,
    pub cwd: &'a Path,
    pub pid: u32,
    pub pty_start: SystemTime,
}

#[derive(Debug, Clone)]
pub enum BindError {
    Pending(String),
    Fatal(String),
}

impl std::fmt::Display for BindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending(reason) => write!(f, "bind pending: {}", reason),
            Self::Fatal(reason) => write!(f, "bind fatal: {}", reason),
        }
    }
}

impl std::error::Error for BindError {}

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
            // `InvalidPath` carries a structural prefix so log scrapers
            // and SIEM rules keying on Display output can distinguish
            // potentially-adversarial input (currently null-byte
            // injection) from generic validation failures, even if the
            // inner message wording changes (Claude review on PR #153,
            // F7). The matching `TxOutcome::InvalidPath` variant in
            // `diagnostics.rs` provides the structured signal at the
            // tx_status= layer; this prefix complements that for
            // free-text-only consumers.
            Self::InvalidPath(message) => write!(f, "invalid transcript path: {}", message),
            Self::Other(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ValidateTranscriptError {}

#[cfg(test)]
mod display_tests {
    use super::*;
    use std::path::PathBuf;

    /// Pinned-format regression test for the `Display` impl. Cycle-3 of
    /// PR #153 introduced a stable `invalid transcript path: ` prefix
    /// for `InvalidPath` so SIEM rules and log scrapers can distinguish
    /// security-relevant validation failures from generic ones (F7).
    /// The prefix is therefore part of the de-facto logging contract;
    /// future edits to `Display` should preserve it.
    #[test]
    fn display_invalid_path_has_stable_security_prefix() {
        let e = ValidateTranscriptError::InvalidPath(
            "transcript path contains null byte".to_string(),
        );
        assert_eq!(
            e.to_string(),
            "invalid transcript path: transcript path contains null byte"
        );
    }

    #[test]
    fn display_other_remains_bare_message() {
        let e = ValidateTranscriptError::Other("something else went wrong".to_string());
        assert_eq!(e.to_string(), "something else went wrong");
    }

    #[test]
    fn display_invalid_path_and_other_are_structurally_distinguishable() {
        let invalid = ValidateTranscriptError::InvalidPath("msg".to_string());
        let other = ValidateTranscriptError::Other("msg".to_string());
        assert_ne!(
            invalid.to_string(),
            other.to_string(),
            "InvalidPath and Other must produce different Display output \
             so log-only consumers can tell them apart"
        );
    }

    #[test]
    fn display_not_found_and_outside_root_unchanged() {
        let nf = ValidateTranscriptError::NotFound(PathBuf::from("/tmp/missing.jsonl"));
        assert!(nf.to_string().starts_with("transcript path not found: "));

        let outside = ValidateTranscriptError::OutsideRoot {
            path: PathBuf::from("/etc/passwd"),
            root: PathBuf::from("/home/user/.claude"),
        };
        let s = outside.to_string();
        assert!(s.starts_with("transcript path is outside Claude directory: "));
        assert!(s.contains(" not under "));
    }

    #[test]
    fn bind_error_display_pending_format() {
        let e = BindError::Pending("logs row not yet committed".to_string());
        assert_eq!(e.to_string(), "bind pending: logs row not yet committed");
    }

    #[test]
    fn bind_error_display_fatal_format() {
        let e = BindError::Fatal("permission denied on ~/.codex".to_string());
        assert_eq!(e.to_string(), "bind fatal: permission denied on ~/.codex");
    }
}
