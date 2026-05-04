//! Codex adapter implementation.

mod locator;
mod parser;
mod transcript;

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::AppHandle;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::types::{
    BindContext, BindError, ParsedStatus, StatusSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;

use self::locator::{CodexSessionLocator, CompositeLocator, LocatorError};

pub struct CodexAdapter {
    locator_cache: OnceLock<CompositeLocator>,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            locator_cache: OnceLock::new(),
        }
    }

    fn locator(&self) -> &CompositeLocator {
        self.locator_cache.get_or_init(|| {
            let codex_home = Self::codex_home();
            log::info!(
                "codex adapter: locator cache initialized (codex_home={})",
                codex_home.display()
            );
            CompositeLocator::new(codex_home)
        })
    }

    fn codex_home() -> PathBuf {
        dirs::home_dir()
            .map(|home| home.join(".codex"))
            .unwrap_or_else(|| PathBuf::from(".codex"))
    }
}

impl<R: tauri::Runtime> AgentAdapter<R> for CodexAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn status_source(&self, ctx: &BindContext<'_>) -> Result<StatusSource, BindError> {
        match self.locator().resolve_rollout(ctx) {
            Ok(location) => Ok(StatusSource {
                path: location.rollout_path,
                trust_root: Self::codex_home(),
            }),
            Err(LocatorError::NotYetReady) => Err(BindError::Pending(
                "codex session row not yet committed".to_string(),
            )),
            Err(LocatorError::Unresolved(reason)) | Err(LocatorError::Fatal(reason)) => {
                Err(BindError::Fatal(reason))
            }
        }
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        parser::parse_rollout(session_id, raw)
    }

    fn validate_transcript(&self, _raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript()
    }

    fn tail_transcript(
        &self,
        _app: AppHandle<R>,
        _session_id: String,
        _cwd: Option<PathBuf>,
        _transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::tail_transcript()
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;
    use tauri::test::MockRuntime;

    #[test]
    fn parse_status_delegates_to_parser_with_transcript_path_none() {
        let adapter = CodexAdapter::new();
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;
        let parsed =
            <CodexAdapter as AgentAdapter<MockRuntime>>::parse_status(&adapter, "pty-1", raw)
                .expect("minimal codex status parses");

        assert_eq!(parsed.event.agent_session_id, "sess");
        assert!(parsed.transcript_path.is_none());
    }

    #[test]
    fn validate_transcript_returns_v1_stub_err() {
        let adapter = CodexAdapter::new();
        let err =
            <CodexAdapter as AgentAdapter<MockRuntime>>::validate_transcript(&adapter, "/tmp/t")
                .expect_err("transcript tailing is still a stub");

        match err {
            ValidateTranscriptError::Other(message) => {
                assert!(
                    message.contains("not yet implemented"),
                    "stub message changed: {}",
                    message
                );
            }
            other => panic!("expected Other variant, got {:?}", other),
        }
    }
}
