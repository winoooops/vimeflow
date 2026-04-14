//! Statusline JSON parser for Claude Code agent status
//!
//! Parses the JSON that Claude Code writes via its statusline command
//! into typed `AgentStatusEvent` structs. Uses `serde_json::Value` for
//! flexible parsing — gracefully handles partial/evolving JSON.

use super::types::{
    AgentStatusEvent, ContextWindowStatus, CostMetrics, CurrentUsage, RateLimitInfo, RateLimits,
};

/// Parsed statusline result with the event and optional transcript path
#[derive(Debug, Clone)]
pub struct ParsedStatusline {
    /// The typed agent status event
    pub event: AgentStatusEvent,
    /// Transcript path extracted from statusline (used by watcher to start tailing)
    pub transcript_path: Option<String>,
}

/// Parse raw JSON string from the statusline file into an `AgentStatusEvent`.
///
/// All fields are optional — gracefully handles partial/evolving JSON.
/// Returns `Err` only if the input is not valid JSON at all.
pub fn parse_statusline(session_id: &str, json: &str) -> Result<ParsedStatusline, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid JSON: {}", e))?;

    let obj = value
        .as_object()
        .ok_or("statusline JSON is not an object")?;

    // Extract model info
    let model = obj.get("model");
    let model_id = model
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let model_display_name = model
        .and_then(|m| m.get("display_name"))
        .and_then(|v| v.as_str())
        .unwrap_or(&model_id)
        .to_string();

    // Extract session ID and version
    let agent_session_id = obj
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version = obj
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Extract context window
    let cw = obj.get("context_window");
    let context_window = parse_context_window(cw);

    // Extract cost metrics
    let cost_obj = obj.get("cost");
    let cost = parse_cost_metrics(cost_obj);

    // Extract rate limits
    let rl = obj.get("rate_limits");
    let rate_limits = parse_rate_limits(rl);

    // Extract transcript path
    let transcript_path = obj
        .get("transcript_path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let event = AgentStatusEvent {
        session_id: session_id.to_string(),
        agent_session_id,
        model_id,
        model_display_name,
        version,
        context_window,
        cost,
        rate_limits,
    };

    Ok(ParsedStatusline {
        event,
        transcript_path,
    })
}

/// Parse context window fields from a JSON value
fn parse_context_window(value: Option<&serde_json::Value>) -> ContextWindowStatus {
    let defaults = ContextWindowStatus {
        used_percentage: None,
        remaining_percentage: 100.0,
        context_window_size: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        current_usage: None,
    };

    let Some(cw) = value.and_then(|v| v.as_object()) else {
        return defaults;
    };

    let used_percentage = cw.get("used_percentage").and_then(|v| v.as_f64());

    let remaining_percentage = cw
        .get("remaining_percentage")
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| used_percentage.map_or(100.0, |used| 100.0 - used));

    let context_window_size = cw
        .get("context_window_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let total_input_tokens = cw
        .get("total_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let total_output_tokens = cw
        .get("total_output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let current_usage = cw.get("current_usage").and_then(|cu| {
        let cu_obj = cu.as_object()?;
        Some(CurrentUsage {
            input_tokens: cu_obj
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            output_tokens: cu_obj
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cache_creation_input_tokens: cu_obj
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cache_read_input_tokens: cu_obj
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        })
    });

    // If used_percentage is null (before first API response), compute it
    // from total_input_tokens / context_window_size. Claude Code doesn't
    // emit used_percentage during the loading phase (skills, MCPs, CLAUDE.md)
    // but it does report total_input_tokens which reflects system prompt size.
    let computed_percentage = used_percentage.or_else(|| {
        if context_window_size > 0 && total_input_tokens > 0 {
            Some((total_input_tokens as f64 / context_window_size as f64) * 100.0)
        } else {
            None
        }
    });

    let computed_remaining = computed_percentage
        .map(|used| 100.0 - used)
        .unwrap_or(remaining_percentage);

    ContextWindowStatus {
        used_percentage: computed_percentage,
        remaining_percentage: computed_remaining,
        context_window_size,
        total_input_tokens,
        total_output_tokens,
        current_usage,
    }
}

/// Parse cost metrics from a JSON value
fn parse_cost_metrics(value: Option<&serde_json::Value>) -> CostMetrics {
    let defaults = CostMetrics {
        total_cost_usd: 0.0,
        total_duration_ms: 0,
        total_api_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
    };

    let Some(cost) = value.and_then(|v| v.as_object()) else {
        return defaults;
    };

    CostMetrics {
        total_cost_usd: cost
            .get("total_cost_usd")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        total_duration_ms: cost
            .get("total_duration_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        total_api_duration_ms: cost
            .get("total_api_duration_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        total_lines_added: cost
            .get("total_lines_added")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        total_lines_removed: cost
            .get("total_lines_removed")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    }
}

/// Parse rate limits from a JSON value
fn parse_rate_limits(value: Option<&serde_json::Value>) -> RateLimits {
    let default_info = RateLimitInfo {
        used_percentage: 0.0,
        resets_at: 0,
    };

    let defaults = RateLimits {
        five_hour: default_info.clone(),
        seven_day: None,
    };

    let Some(rl) = value.and_then(|v| v.as_object()) else {
        return defaults;
    };

    let five_hour = rl
        .get("five_hour")
        .and_then(|v| v.as_object())
        .map(|fh| RateLimitInfo {
            used_percentage: fh
                .get("used_percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            resets_at: fh.get("resets_at").and_then(|v| v.as_u64()).unwrap_or(0),
        })
        .unwrap_or(RateLimitInfo {
            used_percentage: 0.0,
            resets_at: 0,
        });

    let seven_day = rl.get("seven_day").and_then(|v| {
        if v.is_null() {
            return None;
        }
        let sd = v.as_object()?;
        Some(RateLimitInfo {
            used_percentage: sd
                .get("used_percentage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            resets_at: sd.get("resets_at").and_then(|v| v.as_u64()).unwrap_or(0),
        })
    });

    RateLimits {
        five_hour,
        seven_day,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Full Claude Code statusline JSON sample
    fn sample_full_json() -> &'static str {
        r#"{
            "session_id": "abc-123",
            "version": "1.0.30",
            "model": {
                "id": "claude-sonnet-4-20250514",
                "display_name": "Claude Sonnet 4"
            },
            "context_window": {
                "used_percentage": 42.5,
                "remaining_percentage": 57.5,
                "context_window_size": 200000,
                "total_input_tokens": 85000,
                "total_output_tokens": 5000,
                "current_usage": {
                    "input_tokens": 1200,
                    "output_tokens": 300,
                    "cache_creation_input_tokens": 500,
                    "cache_read_input_tokens": 200
                }
            },
            "cost": {
                "total_cost_usd": 0.42,
                "total_duration_ms": 120000,
                "total_api_duration_ms": 45000,
                "total_lines_added": 150,
                "total_lines_removed": 30
            },
            "rate_limits": {
                "five_hour": {
                    "used_percentage": 15.3,
                    "resets_at": 1776081600
                },
                "seven_day": {
                    "used_percentage": 5.0,
                    "resets_at": 1776340800
                }
            },
            "transcript_path": "/home/user/.claude/sessions/abc-123/transcript.jsonl"
        }"#
    }

    #[test]
    fn parses_full_statusline_json() {
        let result = parse_statusline("pty-1", sample_full_json());
        assert!(result.is_ok());

        let parsed = result.unwrap();
        let event = &parsed.event;

        assert_eq!(event.session_id, "pty-1");
        assert_eq!(event.agent_session_id, "abc-123");
        assert_eq!(event.model_id, "claude-sonnet-4-20250514");
        assert_eq!(event.model_display_name, "Claude Sonnet 4");
        assert_eq!(event.version, "1.0.30");

        // Context window
        assert_eq!(event.context_window.used_percentage, Some(42.5));
        assert!((event.context_window.remaining_percentage - 57.5).abs() < f64::EPSILON);
        assert_eq!(event.context_window.context_window_size, 200000);
        assert_eq!(event.context_window.total_input_tokens, 85000);
        assert_eq!(event.context_window.total_output_tokens, 5000);

        let cu = event.context_window.current_usage.as_ref().unwrap();
        assert_eq!(cu.input_tokens, 1200);
        assert_eq!(cu.output_tokens, 300);
        assert_eq!(cu.cache_creation_input_tokens, 500);
        assert_eq!(cu.cache_read_input_tokens, 200);

        // Cost
        assert!((event.cost.total_cost_usd - 0.42).abs() < f64::EPSILON);
        assert_eq!(event.cost.total_duration_ms, 120000);
        assert_eq!(event.cost.total_api_duration_ms, 45000);
        assert_eq!(event.cost.total_lines_added, 150);
        assert_eq!(event.cost.total_lines_removed, 30);

        // Rate limits
        assert!((event.rate_limits.five_hour.used_percentage - 15.3).abs() < f64::EPSILON);
        assert_eq!(event.rate_limits.five_hour.resets_at, 1776081600);
        let seven_day = event.rate_limits.seven_day.as_ref().unwrap();
        assert!((seven_day.used_percentage - 5.0).abs() < f64::EPSILON);

        // Transcript path
        assert_eq!(
            parsed.transcript_path.as_deref(),
            Some("/home/user/.claude/sessions/abc-123/transcript.jsonl")
        );
    }

    #[test]
    fn parses_minimal_json() {
        let json = r#"{}"#;
        let result = parse_statusline("pty-2", json);
        assert!(result.is_ok());

        let parsed = result.unwrap();
        let event = &parsed.event;

        assert_eq!(event.session_id, "pty-2");
        assert_eq!(event.agent_session_id, "");
        assert_eq!(event.model_id, "unknown");
        assert_eq!(event.model_display_name, "unknown");
        assert_eq!(event.version, "");
        assert_eq!(event.context_window.used_percentage, None);
        assert!((event.context_window.remaining_percentage - 100.0).abs() < f64::EPSILON);
        assert_eq!(event.context_window.context_window_size, 0);
        assert!(event.context_window.current_usage.is_none());
        assert!((event.cost.total_cost_usd).abs() < f64::EPSILON);
        assert!(parsed.transcript_path.is_none());
    }

    #[test]
    fn handles_null_used_percentage() {
        let json = r#"{
            "context_window": {
                "used_percentage": null,
                "remaining_percentage": 100.0,
                "context_window_size": 200000,
                "total_input_tokens": 0,
                "total_output_tokens": 0
            }
        }"#;
        let result = parse_statusline("pty-3", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.context_window.used_percentage, None);
        assert!((event.context_window.remaining_percentage - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn handles_missing_context_window() {
        let json = r#"{"model": {"id": "claude-opus-4-20250514"}}"#;
        let result = parse_statusline("pty-4", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.model_id, "claude-opus-4-20250514");
        assert_eq!(event.context_window.used_percentage, None);
        assert_eq!(event.context_window.context_window_size, 0);
    }

    #[test]
    fn handles_null_seven_day_rate_limit() {
        let json = r#"{
            "rate_limits": {
                "five_hour": {
                    "used_percentage": 10.0,
                    "resets_at": 1776081600
                },
                "seven_day": null
            }
        }"#;
        let result = parse_statusline("pty-5", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert!(event.rate_limits.seven_day.is_none());
        assert!((event.rate_limits.five_hour.used_percentage - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn rejects_invalid_json() {
        let result = parse_statusline("pty-6", "not json at all");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid JSON"));
    }

    #[test]
    fn rejects_non_object_json() {
        let result = parse_statusline("pty-7", "42");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not an object"));
    }

    #[test]
    fn handles_partial_cost_fields() {
        let json = r#"{
            "cost": {
                "total_cost_usd": 1.23
            }
        }"#;
        let result = parse_statusline("pty-8", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert!((event.cost.total_cost_usd - 1.23).abs() < f64::EPSILON);
        assert_eq!(event.cost.total_duration_ms, 0);
        assert_eq!(event.cost.total_api_duration_ms, 0);
        assert_eq!(event.cost.total_lines_added, 0);
        assert_eq!(event.cost.total_lines_removed, 0);
    }

    #[test]
    fn computes_remaining_from_used_when_missing() {
        let json = r#"{
            "context_window": {
                "used_percentage": 30.0,
                "context_window_size": 200000,
                "total_input_tokens": 60000,
                "total_output_tokens": 0
            }
        }"#;
        let result = parse_statusline("pty-9", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.context_window.used_percentage, Some(30.0));
        assert!((event.context_window.remaining_percentage - 70.0).abs() < f64::EPSILON);
    }

    #[test]
    fn model_display_name_falls_back_to_id() {
        let json = r#"{"model": {"id": "claude-opus-4-20250514"}}"#;
        let result = parse_statusline("pty-10", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.model_id, "claude-opus-4-20250514");
        assert_eq!(event.model_display_name, "claude-opus-4-20250514");
    }
}
