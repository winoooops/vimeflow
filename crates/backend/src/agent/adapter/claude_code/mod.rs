//! Claude Code adapter implementation.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::traits::{
    StateDecoder, StatusSourceLocator, TranscriptPathValidator, TranscriptStreamer,
};
use crate::agent::adapter::types::{
    stamp_snapshot, LocatedStatusSource, ParsedStatus, RawPath, StatusSnapshot,
    TranscriptPathSource, ValidateTranscriptError,
};
use crate::agent::adapter::AgentAdapter;
use crate::agent::types::AgentType;
use crate::runtime::EventSink;

pub mod statusline;
pub mod test_runners;
pub mod transcript;

#[cfg(test)]
mod transcript_fixture_tests;

pub struct ClaudeCodeAdapter;

impl TranscriptPathSource for ClaudeCodeAdapter {
    // `static_hint` defaults to `None` — Claude's locator has no
    // attach-time transcript knowledge; the path arrives dynamically
    // inside every statusline JSON update.

    fn dynamic_hint(&self, raw: &str) -> Option<RawPath> {
        // Re-parses the JSON to surface just `transcript_path`. The
        // win vs. calling `parse_statusline` here is skipping the
        // event construction, NOT skipping the JSON parse itself —
        // see `statusline::extract_transcript_path` docs for the
        // detail and the deferred-optimization escape hatch.
        statusline::extract_transcript_path(raw)
    }
}

// ---------------- Step B' trait splits ----------------
//
// Each `impl` below is a leaf piece of the former `AgentAdapter`
// trait, broken out per the v4-frozen plan. Bodies are unchanged vs.
// the `impl AgentAdapter for ClaudeCodeAdapter` below — the
// `AgentAdapter` methods now delegate to these for the duration of
// step B' (until B'' / D' migrate the callers).

impl StatusSourceLocator for ClaudeCodeAdapter {
    fn locate(&self, cwd: &Path, session_id: &str) -> Result<LocatedStatusSource, String> {
        Ok(LocatedStatusSource {
            status_path: cwd
                .join(".vimeflow")
                .join("sessions")
                .join(session_id)
                .join("status.json"),
            trust_root: cwd.to_path_buf(),
            static_transcript_hint: None,
        })
    }
}

impl StateDecoder for ClaudeCodeAdapter {
    /// `session_id` is ignored — Claude's parser deserializes the whole
    /// JSON document atomically (one `Result`), so there's no per-line
    /// warn site that needs the context.
    fn decode(
        &self,
        _session_id: Option<&str>,
        raw: &str,
    ) -> Result<StatusSnapshot, String> {
        statusline::parse_statusline_snapshot(raw)
    }
}

impl TranscriptPathValidator for ClaudeCodeAdapter {
    fn validate(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError> {
        transcript::validate_transcript_path(raw)
    }
}

impl TranscriptStreamer for ClaudeCodeAdapter {
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

// Step B': `AgentAdapter` is the transitional façade —
// `TranscriptState::start_or_replace` still consumes
// `Arc<dyn AgentAdapter>` until B'' migrates it onto
// `Arc<dyn TranscriptStreamer>`. Each method delegates to the
// matching split-trait impl above so the bodies live in one place.
impl AgentAdapter for ClaudeCodeAdapter {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn located_status_source(
        &self,
        cwd: &Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String> {
        <Self as StatusSourceLocator>::locate(self, cwd, session_id)
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
mod tests {
    use super::*;

    #[test]
    fn agent_type_returns_claude_code() {
        let adapter = ClaudeCodeAdapter;
        assert!(matches!(
            <ClaudeCodeAdapter as AgentAdapter>::agent_type(&adapter),
            AgentType::ClaudeCode
        ));
    }

    #[test]
    fn located_status_source_returns_claude_path_under_cwd() {
        let adapter = ClaudeCodeAdapter;
        let cwd = PathBuf::from("/tmp/ws");
        let src =
            <ClaudeCodeAdapter as AgentAdapter>::located_status_source(&adapter, &cwd, "sess-1")
                .expect("claude status source is infallible");
        assert_eq!(
            src.status_path,
            cwd.join(".vimeflow")
                .join("sessions")
                .join("sess-1")
                .join("status.json")
        );
        assert_eq!(src.trust_root, cwd);
        // Claude always reports `None` for the static hint — Step 0c
        // contract: the transcript path is purely dynamic for Claude.
        assert_eq!(src.static_transcript_hint, None);
    }

    #[test]
    fn parse_status_minimal_json_matches_statusline_module() {
        let adapter = ClaudeCodeAdapter;
        let parsed = <ClaudeCodeAdapter as AgentAdapter>::parse_status(&adapter, "sess-1", r#"{}"#)
            .expect("minimal json should parse");
        assert_eq!(parsed.event.session_id, "sess-1");
    }

    /// Step 0c: with `transcript_path` removed from `ParsedStatus`, the
    /// Claude adapter resolves it via `dynamic_hint` instead. Pin both
    /// branches of the lookup so a regression to "extracts None even
    /// when present" or "extracts something even when absent" is loud.
    #[test]
    fn dynamic_hint_extracts_transcript_path_when_present() {
        let adapter = ClaudeCodeAdapter;
        // Step B' (round 1 codex fix): call `TranscriptPathSource`
        // methods directly on the adapter — the former
        // `AgentAdapter::transcript_path_source` accessor was
        // removed so the trait can narrow to `pub(crate)`.
        let tps: &dyn TranscriptPathSource = &adapter;

        let with_path = r#"{"transcript_path":"/tmp/conv.jsonl","model":{"id":"x"}}"#;
        assert_eq!(
            tps.dynamic_hint(with_path),
            Some("/tmp/conv.jsonl".to_string()),
        );

        let without_path = r#"{"model":{"id":"x"}}"#;
        assert_eq!(tps.dynamic_hint(without_path), None);
    }

    /// Claude's `static_hint` must stay `None` no matter what the
    /// supplied `LocatedStatusSource.static_transcript_hint` says —
    /// Step 0c contract: Claude's hint is purely dynamic. Defensive
    /// test: even if the watcher happens to carry a hint set by a
    /// future bug, Claude does not surface it.
    #[test]
    fn static_hint_is_none_for_claude_regardless_of_located_value() {
        let adapter = ClaudeCodeAdapter;
        // Step B' (round 1 codex fix): call `TranscriptPathSource`
        // methods directly on the adapter — the former
        // `AgentAdapter::transcript_path_source` accessor was
        // removed so the trait can narrow to `pub(crate)`.
        let tps: &dyn TranscriptPathSource = &adapter;
        let located = LocatedStatusSource {
            status_path: PathBuf::from("/tmp/status.json"),
            trust_root: PathBuf::from("/tmp"),
            static_transcript_hint: Some("/tmp/should_be_ignored.jsonl".to_string()),
        };
        assert_eq!(tps.static_hint(&located), None);
    }
}
