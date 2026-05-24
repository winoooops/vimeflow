//! The four new trait splits introduced by Step B' of the v4-frozen
//! refactor plan (#246). Step 0c already extracted
//! [`crate::agent::adapter::types::TranscriptPathSource`] into the
//! types module; this file collects the four remaining splits in one
//! place so a reader can see the post-B' adapter contract at a
//! glance:
//!
//! - [`StatusSourceLocator`] — "where is the statusline file for this
//!   session" + the attach-time transcript hint (former
//!   `AgentAdapter::located_status_source`).
//! - [`StateDecoder`] — "given raw statusline content, what's the
//!   current snapshot" (former `AgentAdapter::parse_status`, now
//!   returning [`StatusSnapshot`] without `session_id`; the runtime
//!   stamps the session id when composing `AgentStatusEvent`).
//! - [`TranscriptPathValidator`] — "is this raw path safe to tail"
//!   (former `AgentAdapter::validate_transcript`).
//! - [`TranscriptStreamer`] — "spawn a thread that emits events from
//!   this JSONL" (former `AgentAdapter::tail_transcript`).
//!
//! All four are `pub(crate)` per frozen constraint #3. The existing
//! `AgentAdapter` trait stays alive in B' as a transitional façade —
//! `TranscriptState::start_or_replace` still takes `Arc<dyn AgentAdapter>`
//! and B'' (the next step) is where it migrates onto
//! `Arc<dyn TranscriptStreamer>`. Until then, each adapter struct
//! implements both `AgentAdapter` and the four split traits side by
//! side.

use std::path::PathBuf;
use std::sync::Arc;

use super::base::TranscriptHandle;
use super::types::{LocatedStatusSource, StatusSnapshot, ValidateTranscriptError};
use crate::runtime::EventSink;

/// Discover the statusline file + the attach-time transcript hint
/// for one PTY session.
///
/// Replaces `AgentAdapter::located_status_source` in the post-B'
/// world. The trait error type is `String` because providers vary in
/// what they classify as a hard failure: Claude's locator is
/// infallible (it just joins a path), Codex's locator does
/// retry+fallback across multiple strategies and folds an internal
/// `LocatorError` into a `String` at this boundary.
pub(crate) trait StatusSourceLocator: Send + Sync {
    fn locate(
        &self,
        cwd: &std::path::Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String>;
}

/// Decode raw statusline content into a provider-neutral
/// [`StatusSnapshot`]. Replaces `AgentAdapter::parse_status` in the
/// post-B' world.
///
/// The decoder output (`StatusSnapshot`) is deliberately
/// session-id-free — the runtime composes
/// `AgentStatusEvent { session_id, ...snapshot }` after the decoder
/// returns. This was R2.2 of the v4-frozen plan: "decoder
/// session-id-free, runtime stamps the id".
///
/// The `session_id: Option<&str>` parameter is **diagnostic-only**:
/// providers may attach it to per-line log messages so multi-session
/// debugging can correlate "malformed rollout line" warnings to the
/// affected PTY session. It does NOT appear in the returned
/// `StatusSnapshot` and MUST NOT influence decoding semantics — same
/// raw bytes + different session_id must yield the same snapshot. R2.2
/// is therefore preserved (output identity-free; input is annotated
/// for observability only). PR #261 cycle 2 review flagged the
/// information loss: the pre-B' parser logged `for sid={session_id}`,
/// and the refactor stripped that context.
pub(crate) trait StateDecoder: Send + Sync {
    fn decode(
        &self,
        session_id: Option<&str>,
        raw: &str,
    ) -> Result<StatusSnapshot, String>;
}

/// Validate a raw transcript path against path-security policy
/// before any file I/O. Replaces `AgentAdapter::validate_transcript`
/// in the post-B' world.
pub(crate) trait TranscriptPathValidator: Send + Sync {
    fn validate(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;
}

/// Spawn a background thread that tails the given transcript JSONL
/// and emits per-event `AgentToolCall` / `AgentTurn` / `TestRun`
/// events through the supplied [`EventSink`]. Replaces
/// `AgentAdapter::tail_transcript` in the post-B' world.
///
/// `TranscriptHandle` (defined in `base::transcript_state`) is the
/// per-stream stop / generation handle the watcher already owns;
/// B'' will migrate `TranscriptState::start_or_replace` to take
/// `Arc<dyn TranscriptStreamer>` directly instead of going through
/// `Arc<dyn AgentAdapter>`.
pub(crate) trait TranscriptStreamer: Send + Sync {
    fn tail(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
