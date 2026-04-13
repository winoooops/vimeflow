//! Type definitions for agent detection and status tracking

use serde::{Deserialize, Serialize};

/// Agent type identifier
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub enum AgentType {
    /// Claude Code (claude.ai/code)
    ClaudeCode,
    /// Codex (AI coding agent)
    Codex,
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
    /// Total cost in USD
    pub total_cost_usd: f64,
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
    /// ISO 8601 timestamp when rate limit resets
    pub resets_at: String,
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

/// Event emitted when an agent executes a tool call
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Used by frontend and future sub-specs
pub struct AgentToolCallEvent {
    /// PTY session ID
    pub session_id: String,
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
}
