//! Type definitions for agent detection and status tracking

use serde::{Deserialize, Serialize};

/// Agent type identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub enum AgentType {
    /// Claude Code (claude.ai/code)
    ClaudeCode,
    /// Codex (AI coding agent)
    Codex,
    /// Kimi Code (Moonshot kimi-code CLI)
    Kimi,
    /// opencode (AI coding agent by SST)
    Opencode,
    /// Aider (AI pair programming tool)
    Aider,
    /// Generic/unknown agent
    Generic,
}

/// Event emitted when an agent is detected in a PTY session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectedEvent {
    /// PTY session ID
    pub session_id: String,
    /// Detected agent type
    pub agent_type: AgentType,
    /// Process ID of the agent
    pub pid: u32,
}

/// Event emitted when an agent disconnects from a PTY session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct AgentDisconnectedEvent {
    /// PTY session ID
    pub session_id: String,
}

/// Current token usage for a single operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct CurrentUsage {
    /// Input tokens used
    pub input_tokens: u64,
    /// Output tokens generated
    pub output_tokens: u64,
    /// Cache creation input tokens
    pub cache_creation_input_tokens: u64,
    /// Cache read input tokens
    pub cache_read_input_tokens: u64,
}

/// Context window status and token usage
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct ContextWindowStatus {
    /// Percentage of context window used (0.0-100.0)
    #[cfg_attr(test, ts(optional))]
    pub used_percentage: Option<f64>,
    /// Percentage of context window remaining (0.0-100.0)
    pub remaining_percentage: f64,
    /// Total context window size in tokens
    pub context_window_size: u64,
    /// Total input tokens consumed
    pub total_input_tokens: u64,
    /// Total output tokens generated
    pub total_output_tokens: u64,
    /// Current usage breakdown
    #[cfg_attr(test, ts(optional))]
    pub current_usage: Option<CurrentUsage>,
}

/// Cost and performance metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct CostMetrics {
    /// Total cost in USD. `None` for codex (no cost surface).
    pub total_cost_usd: Option<f64>,
    /// Total session duration in milliseconds
    pub total_duration_ms: u64,
    /// Total API call duration in milliseconds
    pub total_api_duration_ms: u64,
    /// Total lines of code added
    pub total_lines_added: u64,
    /// Total lines of code removed
    pub total_lines_removed: u64,
}

/// Rate limit information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct RateLimitInfo {
    /// Percentage of rate limit used (0.0-100.0)
    pub used_percentage: f64,
    /// Unix epoch seconds when rate limit resets
    pub resets_at: u64,
}

/// Rate limits for different time windows
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct RateLimits {
    /// 5-hour rate limit window
    pub five_hour: RateLimitInfo,
    /// 7-day rate limit window (if applicable)
    #[cfg_attr(test, ts(optional))]
    pub seven_day: Option<RateLimitInfo>,
}

/// Agent status event with metrics and context window info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct AgentStatusEvent {
    /// PTY session ID
    pub session_id: String,
    /// Agent's internal session ID
    pub agent_session_id: String,
    /// Model identifier (e.g., "claude-3-5-sonnet-20241022")
    pub model_id: String,
    /// Human-readable model name
    pub model_display_name: String,
    /// Agent version string
    pub version: String,
    /// Context window usage
    pub context_window: ContextWindowStatus,
    /// Cost and performance metrics
    pub cost: CostMetrics,
    /// Rate limit status
    pub rate_limits: RateLimits,
    /// Whether `rate_limits` is a real network-fetched value vs a placeholder.
    /// `false` for claude/codex and for a kimi session that hasn't fetched yet;
    /// the kimi usage gate reads it to tell LOADING from ON.
    pub usage_fetched: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend
pub struct AgentSessionTitleEvent {
    /// PTY session ID. Same shape as AgentStatusEvent.session_id;
    /// the frontend matches on this.
    pub session_id: String,
    /// Agent's own session UUID (Claude transcript `sessionId` /
    /// Codex `session_index.jsonl` `id`). Informational; frontend
    /// does not join on this.
    pub agent_session_id: String,
    /// Sanitized title string. Empty string is the explicit "clear"
    /// signal; the frontend coerces empty to `agentTitle: undefined`.
    pub title: String,
    /// Where the title came from.
    pub source: TitleSource,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum TitleSource {
    /// Claude `ai-title` event or uncorrelated Codex `thread_name` update.
    AiGenerated,
    /// Claude `custom-title` event or Codex `thread_name` update correlated
    /// with a Vimeflow `/rename` write.
    UserRenamed,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct RenameAgentSessionRequest {
    pub pty_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum RenameAgentSessionErrorReason {
    NoLiveAgent,
    UnsupportedAgent,
    EmptyTitle,
    PtyWrite,
}

impl RenameAgentSessionErrorReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoLiveAgent => "no-live-agent",
            Self::UnsupportedAgent => "unsupported-agent",
            Self::EmptyTitle => "empty-title",
            Self::PtyWrite => "pty-write",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameAgentSessionError {
    pub reason: RenameAgentSessionErrorReason,
    message: String,
}

impl RenameAgentSessionError {
    pub fn new(reason: RenameAgentSessionErrorReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RenameAgentSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RenameAgentSessionError {}

/// Event emitted when the agent's tracked working directory changes.
///
/// Sourced from each adapter's structured cwd channel in its transcript
/// JSONL:
/// - **Claude Code** writes a top-level `cwd` field on every transcript
///   entry; transitions fire as soon as the next line is parsed.
/// - **Codex** writes cwd in two places the watcher reads:
///   `session_meta.payload.cwd` (once, at session start) and
///   `response_item.payload.arguments.workdir` for `exec_command`
///   function calls (the mid-session signal — fires whenever codex
///   runs a tool command in a new directory). Codex also writes
///   `turn_context.payload.cwd` on every turn, but the watcher
///   intentionally ignores that field because it's pinned to the
///   session-start value and would cause false reverts after a
///   mid-session `exec_command.workdir` transition.
///
/// In both cases this is the authoritative signal for "where the agent
/// currently is" — it picks up tool-call-driven moves like Claude's
/// `EnterWorktree` and codex's "switch to worktree" navigation that
/// intentionally do NOT mutate the interactive shell's `$PWD`, so
/// neither OSC 7 nor PTY text patterns can catch them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentCwdEvent {
    /// PTY session ID
    pub session_id: String,
    /// Absolute working directory the agent reports itself to be in.
    pub cwd: String,
}

/// Event emitted when a Claude transcript reveals the latest user-prompt
/// count.
///
/// **Duplication note (PR #302 cycle 13 F2):** same restart-boundary
/// duplicate window as `AgentToolCallEvent` — see that struct's doc.
/// Unlike tool-call events, `agent-turn` does NOT have a reliable
/// dedup key in the current schema: `num_turns` is monotonic WITHIN a
/// single Claude invocation but resets to 0 when a new Claude run
/// starts on the same PTY (existing frontend behavior accepts this
/// reset as a legitimate restart). A `(session_id, num_turns)`
/// dedup rule would therefore drop the first turns of post-restart
/// invocations and is unsafe. The duplicate window is bounded to
/// ≤2 events at restart boundaries, so the practical impact is a
/// transient over-count of `num_turns` displayed in the UI — typically
/// invisible because subsequent live turns immediately re-establish
/// the correct count. Adding a stable transcript/agent-session id to
/// the payload (out of scope for PR #302) would enable safe dedup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct AgentTurnEvent {
    /// PTY session ID
    pub session_id: String,
    /// Number of real user prompts observed in this transcript
    pub num_turns: u32,
}

/// Tool call execution status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub enum ToolCallStatus {
    /// Tool call is running
    Running,
    /// Tool call completed successfully
    Done,
    /// Tool call failed
    Failed,
}

/// Event emitted when an agent executes a tool call.
///
/// **Duplication note (PR #302 cycle 13 F2):** during a watcher restart
/// where the new handle's inline-init didn't claim transcript ownership,
/// the OLD transcript tail is signaled-stop under the per-session gate
/// but the actual thread-join happens AFTER gate release (cycle 11 F2,
/// to avoid stalling concurrent gate waiters for ~500ms). In that
/// ≤500ms window before the OLD tail observes its stop flag, the OLD
/// tail may emit one or two more `agent-tool-call` events while the
/// NEW handle is already active. Consumers SHOULD dedup by
/// `tool_use_id` (stable per tool call across both tails). The
/// duplicate window is bounded to one POLL_INTERVAL (500ms) and only
/// occurs at restart boundaries.
///
/// For `AgentTurnEvent`'s analogous note (no reliable dedup key in the
/// current schema), see that struct's doc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct AgentToolCallEvent {
    /// PTY session ID
    pub session_id: String,
    /// Anthropic tool_use id (e.g., "toolu_01ABC..."). Stable per
    /// tool call — used on the frontend as the React key so parallel
    /// tool calls sharing a message-level timestamp don't collide.
    /// **Also serves as the natural dedup key** for the ≤500ms
    /// restart-boundary duplicate window (see struct-level doc).
    pub tool_use_id: String,
    /// Tool name (e.g., "Read", "Write", "Bash")
    pub tool: String,
    /// Tool call arguments (JSON string)
    pub args: String,
    /// Execution status
    pub status: ToolCallStatus,
    /// ISO 8601 timestamp
    pub timestamp: String,
    /// Execution duration in milliseconds
    pub duration_ms: u64,
    /// True when this is a Write/Edit on a path that matches a known
    /// test-file convention (e.g. `*.test.ts`, `*_test.rs`). Frontend
    /// uses this to render the activity feed glyph and verb without
    /// needing to glob the path itself.
    pub is_test_file: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub enum AgentPhase {
    Running,
    Idle,
    Awaiting, // reserved — never emitted until VIM-93b
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // phase fields consumed by the frontend
pub struct AgentLifecycleEvent {
    pub session_id: String,
    /// The agent's own session identity (Claude transcript stem, Codex session_meta.id); lets the bridge drop a stale tail across restart.
    pub agent_session_id: String,
    pub phase: AgentPhase,
}
