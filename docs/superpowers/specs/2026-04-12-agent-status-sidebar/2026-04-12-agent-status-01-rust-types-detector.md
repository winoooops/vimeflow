# Sub-spec 1: Rust Agent Types + Detector

**Parent:** `CLAUDE.md`
**Scope:** Create the `src-tauri/src/agent/` module with shared types (ts-rs exported) and process tree agent detection.

## Files to Create

```
src-tauri/src/agent/
├── mod.rs          // Module exports, register commands in lib.rs
├── types.rs        // All shared types with ts-rs export
└── detector.rs     // Process tree inspection
```

## Files to Modify

- `src-tauri/src/lib.rs` — add `mod agent;` and register new Tauri commands

## Types to Define (`types.rs`)

All types must use `#[cfg_attr(test, derive(ts_rs::TS))]` and `#[serde(rename_all = "camelCase")]` following the existing pattern in `src-tauri/src/terminal/types.rs`.

```rust
/// Which coding agent is running
pub enum AgentType {
    ClaudeCode,
    Codex,
    Aider,
    Generic,
}

/// Agent detection result emitted as Tauri event
pub struct AgentDetectedEvent {
    pub session_id: String,       // Vimeflow PTY session ID
    pub agent_type: AgentType,
    pub pid: u32,                 // Agent process PID
}

/// Agent disconnection event
pub struct AgentDisconnectedEvent {
    pub session_id: String,
}

/// Context window status (from Claude Code statusline)
pub struct ContextWindowStatus {
    pub used_percentage: Option<f64>,
    pub remaining_percentage: Option<f64>,
    pub context_window_size: u64,       // 200000 or 1000000
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub current_usage: Option<CurrentUsage>,
}

pub struct CurrentUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

/// Cost and duration metrics
pub struct CostMetrics {
    pub total_cost_usd: f64,
    pub total_duration_ms: u64,
    pub total_api_duration_ms: u64,
    pub total_lines_added: u64,
    pub total_lines_removed: u64,
}

/// Rate limit info (Claude.ai subscribers only)
pub struct RateLimitInfo {
    pub used_percentage: f64,
    pub resets_at: u64,             // Unix epoch seconds
}

pub struct RateLimits {
    pub five_hour: RateLimitInfo,
    pub seven_day: Option<RateLimitInfo>,
}

/// Combined status update event (from statusline)
pub struct AgentStatusEvent {
    pub session_id: String,
    pub agent_session_id: Option<String>,  // Claude Code's own session_id
    pub model_id: Option<String>,
    pub model_display_name: Option<String>,
    pub version: Option<String>,
    pub context_window: Option<ContextWindowStatus>,
    pub cost: Option<CostMetrics>,
    pub rate_limits: Option<RateLimits>,
}

/// Tool call event (from transcript)
pub struct AgentToolCallEvent {
    pub session_id: String,
    pub tool: String,
    pub args: String,               // Summary/truncated
    pub status: ToolCallStatus,
    pub timestamp: String,          // ISO 8601
    pub duration_ms: Option<u64>,
}

pub enum ToolCallStatus {
    Running,
    Done,
    Failed,
}
```

## Detector (`detector.rs`)

### Purpose

Given a PTY child PID, walk the process tree to find known agent binaries.

### Interface

```rust
/// Check if a known coding agent is running under the given PID.
/// Walks the process tree (children of children) looking for known binary names.
pub fn detect_agent(pid: u32) -> Option<(AgentType, u32)>
```

### Detection logic

1. Read `/proc/<pid>/children` recursively (Linux) to get all descendant PIDs
2. For each descendant, read `/proc/<pid>/cmdline` or `/proc/<pid>/exe`
3. Match binary names:
   - `claude` → `AgentType::ClaudeCode`
   - `codex` → `AgentType::Codex`
   - `aider` → `AgentType::Aider`
4. Return the first match with its PID, or `None`

### Tauri Command

```rust
#[tauri::command]
pub async fn detect_agent_in_session(session_id: String) -> Result<Option<AgentDetectedEvent>, String>
```

This command is called by the frontend on a polling interval (~2s). It looks up the PTY session's child PID from the existing `PtyState`, then calls `detect_agent()`.

## Acceptance Criteria

- [ ] `cargo build` succeeds with new module
- [ ] `cargo test` passes — unit tests for `detect_agent()` with mock `/proc` data
- [ ] ts-rs bindings generated: run `cargo test` and verify new `.ts` files appear in `src/bindings/`
- [ ] Types use `camelCase` serialization matching existing convention
- [ ] `detect_agent_in_session` command registered in `lib.rs`

## Notes

- Follow the existing pattern in `src-tauri/src/terminal/` for module organization
- The detector is Linux-only for now (WSL2 target). macOS support can be added later with `sysctl` or `libproc`
- Don't add file watching here — that's sub-spec 2
