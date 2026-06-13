//! Kimi Code adapter implementation.

mod locator;
mod parser;
mod transcript;
mod transcript_dto;
mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::traits::{
    StateDecoder, StatusSourceLocator as _, TranscriptPathValidator, TranscriptStreamer,
};
use crate::agent::adapter::types::{
    stamp_snapshot, LocatedStatusSource, ParsedStatus, RawPath, StatusSnapshot,
    TranscriptPathSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;

pub(crate) use self::locator::KimiLocator;
pub(crate) use self::types::default_kimi_home;

/// Adapter for the kimi-code CLI. Holds a shared `Arc<KimiLocator>` so
/// `AgentBindings::for_attach` can share one locator between
/// `bindings.locator` and the adapter's decoder/validator/streamer views.
pub struct KimiAdapter {
    locator: Arc<KimiLocator>,
}

impl KimiAdapter {
    pub(crate) fn with_locator(locator: Arc<KimiLocator>) -> Self {
        Self { locator }
    }

    fn locator(&self) -> &KimiLocator {
        &self.locator
    }
}

impl TranscriptPathSource for KimiAdapter {
    /// kimi-code's transcript path is the same `wire.jsonl` the locator
    /// resolves at attach time; surface it via the static hint.
    fn static_hint(&self, located: &LocatedStatusSource) -> Option<RawPath> {
        located.static_transcript_hint.clone()
    }

    // `dynamic_hint` defaults to `None` — kimi never writes the transcript
    // path inside the status stream.
}

impl StateDecoder for KimiAdapter {
    fn decode(&self, session_id: Option<&str>, raw: &str) -> Result<StatusSnapshot, String> {
        parser::parse_wire_snapshot(session_id, raw)
    }
}

impl TranscriptPathValidator for KimiAdapter {
    fn validate(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript_path(raw)
    }
}

impl TranscriptStreamer for KimiAdapter {
    fn tail(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        transcript::start_tailing(events, session_id, transcript_path, cwd)
    }
}

impl AgentAdapter for KimiAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::Kimi
    }

    fn located_status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String> {
        self.locator().locate(cwd, session_id)
    }

    fn parse_status(&self, session_id: &str, raw: &str) -> Result<ParsedStatus, String> {
        let snapshot = <Self as StateDecoder>::decode(self, Some(session_id), raw)?;
        Ok(ParsedStatus {
            event: stamp_snapshot(session_id, snapshot),
        })
    }

    fn validate_transcript(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        <Self as TranscriptPathValidator>::validate(self, raw)
    }

    fn tail_transcript(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String> {
        <Self as TranscriptStreamer>::tail(self, events, session_id, cwd, transcript_path)
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;

    fn adapter() -> KimiAdapter {
        KimiAdapter::with_locator(Arc::new(KimiLocator::new(PathBuf::from("/tmp/.kimi-code"))))
    }

    #[test]
    fn agent_type_is_kimi() {
        assert_eq!(
            <KimiAdapter as AgentAdapter>::agent_type(&adapter()),
            AgentType::Kimi
        );
    }

    #[test]
    fn static_hint_surfaces_located_transcript_hint() {
        let adapter = adapter();
        let tps: &dyn TranscriptPathSource = &adapter;

        let located = LocatedStatusSource {
            status_path: PathBuf::from(
                "/home/u/.kimi-code/sessions/wd/session_1/agents/main/wire.jsonl",
            ),
            trust_root: PathBuf::from("/home/u/.kimi-code"),
            static_transcript_hint: Some(
                "/home/u/.kimi-code/sessions/wd/session_1/agents/main/wire.jsonl".to_string(),
            ),
            agent_session_id: Some("session_1".to_string()),
        };
        assert_eq!(
            tps.static_hint(&located).as_deref(),
            Some("/home/u/.kimi-code/sessions/wd/session_1/agents/main/wire.jsonl"),
        );

        let without = LocatedStatusSource {
            status_path: PathBuf::from("/tmp/x"),
            trust_root: PathBuf::from("/tmp"),
            static_transcript_hint: None,
            agent_session_id: None,
        };
        assert_eq!(tps.static_hint(&without), None);
    }

    #[test]
    fn dynamic_hint_is_none_regardless_of_raw() {
        let adapter = adapter();
        let tps: &dyn TranscriptPathSource = &adapter;
        assert_eq!(tps.dynamic_hint(r#"{"transcript_path":"/ignored"}"#), None);
    }

    #[test]
    fn decode_parses_wire_into_snapshot() {
        let adapter = adapter();
        let raw = concat!(
            r#"{"type":"config.update","modelAlias":"kimi-code/kimi-for-coding"}"#,
            "\n",
            r#"{"type":"usage.record","model":"kimi-code/kimi-for-coding","usage":{"inputOther":211,"output":35,"inputCacheRead":16128,"inputCacheCreation":0}}"#,
            "\n",
        );
        let snapshot = <KimiAdapter as StateDecoder>::decode(&adapter, Some("pty"), raw)
            .expect("kimi snapshot decodes");
        assert_eq!(snapshot.model_id, "kimi-code/kimi-for-coding");
        assert_eq!(snapshot.context_window.total_input_tokens, 211);
    }

    #[test]
    fn validate_transcript_rejects_path_outside_kimi_root() {
        let adapter = adapter();
        assert!(
            <KimiAdapter as AgentAdapter>::validate_transcript(&adapter, "/tmp/not-kimi").is_err(),
            "path outside kimi home should be rejected",
        );
    }
}
