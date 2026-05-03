//! Claude Code adapter implementation.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{ParsedStatus, StatusSource, ValidateTranscriptError};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;

pub mod statusline;
pub mod test_runners;
pub mod transcript;

pub struct ClaudeCodeAdapter;

impl<R: tauri::Runtime> AgentAdapter<R> for ClaudeCodeAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn status_source(&self, cwd: &Path, session_id: &str) -> StatusSource {
        StatusSource {
            path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
        }
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let parsed = statusline::parse_statusline(session_id, raw)?;
        Ok(ParsedStatus {
            event: parsed.event,
            transcript_path: parsed.transcript_path,
        })
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript_path(raw)
    }

    fn tail_transcript(
        &self,
        app: AppHandle<R>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::start_tailing(app, session_id, transcript_path, cwd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::MockRuntime;

    #[test]
    fn agent_type_returns_claude_code() {
        let adapter = ClaudeCodeAdapter;
        assert!(matches!(
            <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::agent_type(&adapter),
            AgentType::ClaudeCode
        ));
    }

    #[test]
    fn status_source_returns_claude_path_under_cwd() {
        let adapter = ClaudeCodeAdapter;
        let cwd = PathBuf::from("/tmp/ws");
        let src = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::status_source(
            &adapter, &cwd, "sess-1",
        );
        assert_eq!(
            src.path,
            cwd.join(".vimeflow")
                .join("sessions")
                .join("sess-1")
                .join("status.json")
        );
        assert_eq!(src.trust_root, cwd);
    }

    #[test]
    fn parse_status_minimal_json_matches_statusline_module() {
        let adapter = ClaudeCodeAdapter;
        let parsed = <ClaudeCodeAdapter as AgentAdapter<MockRuntime>>::parse_status(
            &adapter, "sess-1", r#"{}"#,
        )
        .expect("minimal json should parse");
        assert_eq!(parsed.event.session_id, "sess-1");
        assert!(parsed.transcript_path.is_none());
    }
}
