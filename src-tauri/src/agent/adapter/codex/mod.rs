//! Codex adapter implementation.

mod locator;
mod parser;
mod transcript;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

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
    resolved_rollout_path: Mutex<Option<PathBuf>>,
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            locator_cache: OnceLock::new(),
            resolved_rollout_path: Mutex::new(None),
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
            Ok(location) => {
                let rollout_path = location.rollout_path;
                if let Ok(mut slot) = self.resolved_rollout_path.lock() {
                    *slot = Some(rollout_path.clone());
                }

                Ok(StatusSource {
                    path: rollout_path,
                    trust_root: Self::codex_home(),
                })
            }
            Err(LocatorError::NotYetReady) => Err(BindError::Pending(
                "codex session row not yet committed".to_string(),
            )),
            Err(LocatorError::Unresolved(reason)) | Err(LocatorError::Fatal(reason)) => {
                Err(BindError::Fatal(reason))
            }
        }
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let transcript_path = self
            .resolved_rollout_path
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|path| path.to_string_lossy().to_string()));

        parser::parse_rollout(session_id, raw, transcript_path)
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
    fn parse_status_includes_resolved_rollout_path_when_available() {
        let adapter = CodexAdapter::new();
        {
            let mut slot = adapter
                .resolved_rollout_path
                .lock()
                .expect("resolved rollout path lock");
            *slot = Some(PathBuf::from("/tmp/codex-rollout.jsonl"));
        }
        let raw = r#"{"timestamp":"...","type":"session_meta","payload":{"id":"sess","cli_version":"0.128.0"}}
"#;

        let parsed =
            <CodexAdapter as AgentAdapter<MockRuntime>>::parse_status(&adapter, "pty-1", raw)
                .expect("minimal codex status parses");

        assert_eq!(
            parsed.transcript_path.as_deref(),
            Some("/tmp/codex-rollout.jsonl")
        );
    }

    #[test]
    fn validate_transcript_rejects_outside_codex_root() {
        let adapter = CodexAdapter::new();
        assert!(
            <CodexAdapter as AgentAdapter<MockRuntime>>::validate_transcript(&adapter, "/tmp/t")
                .is_err(),
            "path outside ~/.codex should be rejected"
        );
    }
}
