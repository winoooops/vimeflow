//! Statusline JSON parser for Claude Code agent status
//!
//! Parses the JSON that Claude Code writes via its statusline command
//! into typed `AgentStatusEvent` structs. Uses `serde_json::Value` for
//! flexible parsing — gracefully handles partial/evolving JSON.

use crate::agent::types::{
    AgentStatusEvent, ContextWindowStatus, CostMetrics, CurrentUsage, RateLimitInfo, RateLimits,
};
use serde_json::Value;

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
    let value: Value = serde_json::from_str(json).map_err(|e| format!("invalid JSON: {}", e))?;

    if !value.is_object() {
        return Err("statusline JSON is not an object".to_string());
    }

    // Extract model info
    let model_id = model_id(&value);
    let model_display_name = model_display_name(&value, &model_id);

    // Extract session ID and version
    let agent_session_id = agent_session_id(&value);
    let version = version(&value);

    // Extract context window
    let context_window = parse_context_window(&value);

    // Extract cost metrics
    let cost = parse_cost_metrics(&value);

    // Extract rate limits
    let rate_limits = parse_rate_limits(&value);

    // Extract transcript path
    let transcript_path = transcript_path(&value);

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
fn parse_context_window(value: &Value) -> ContextWindowStatus {
    let defaults = ContextWindowStatus {
        used_percentage: None,
        remaining_percentage: 100.0,
        context_window_size: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        current_usage: None,
    };

    if !has_context_window(value) {
        return defaults;
    }

    let used_percentage = used_percentage(value);

    let remaining_percentage = remaining_percentage(value)
        .unwrap_or_else(|| used_percentage.map_or(100.0, |used| 100.0 - used));

    let context_window_size = context_window_size(value);

    let total_input_tokens = total_input_tokens(value);

    let total_output_tokens = total_output_tokens(value);

    let current_usage = current_usage(value);

    // If used_percentage is null (before first API response), compute it
    // from total_input_tokens / context_window_size. Claude Code doesn't
    // emit used_percentage during the loading phase (skills, MCPs, CLAUDE.md)
    // but it does report total_input_tokens which reflects system prompt size.
    let computed_percentage = used_percentage
        .or_else(|| {
            if context_window_size > 0 && total_input_tokens > 0 {
                Some((total_input_tokens as f64 / context_window_size as f64) * 100.0)
            } else {
                None
            }
        })
        .map(clamp_percentage);

    let computed_remaining = computed_percentage
        .map(|used| clamp_percentage(100.0 - used))
        .unwrap_or_else(|| clamp_percentage(remaining_percentage));

    ContextWindowStatus {
        used_percentage: computed_percentage,
        remaining_percentage: computed_remaining,
        context_window_size,
        total_input_tokens,
        total_output_tokens,
        current_usage,
    }
}

fn clamp_percentage(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

/// Parse cost metrics from a JSON value
fn parse_cost_metrics(value: &Value) -> CostMetrics {
    let defaults = CostMetrics {
        total_cost_usd: 0.0,
        total_duration_ms: 0,
        total_api_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
    };

    if !has_cost(value) {
        return defaults;
    }

    CostMetrics {
        total_cost_usd: total_cost_usd(value),
        total_duration_ms: total_duration_ms(value),
        total_api_duration_ms: total_api_duration_ms(value),
        total_lines_added: total_lines_added(value),
        total_lines_removed: total_lines_removed(value),
    }
}

/// Parse rate limits from a JSON value
fn parse_rate_limits(value: &Value) -> RateLimits {
    let default_info = RateLimitInfo {
        used_percentage: 0.0,
        resets_at: 0,
    };

    let defaults = RateLimits {
        five_hour: default_info.clone(),
        seven_day: None,
    };

    if !has_rate_limits(value) {
        return defaults;
    }

    let five_hour = five_hour_rate_limit(value).unwrap_or(RateLimitInfo {
        used_percentage: 0.0,
        resets_at: 0,
    });

    let seven_day = seven_day_rate_limit(value);

    RateLimits {
        five_hour,
        seven_day,
    }
}

fn model_id(value: &Value) -> String {
    value
        .get("model")
        .and_then(|model| model.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

fn model_display_name(value: &Value, model_id: &str) -> String {
    value
        .get("model")
        .and_then(|model| model.get("display_name"))
        .and_then(Value::as_str)
        .unwrap_or(model_id)
        .to_string()
}

fn agent_session_id(value: &Value) -> String {
    value
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn version(value: &Value) -> String {
    value
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn transcript_path(value: &Value) -> Option<String> {
    value
        .get("transcript_path")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn has_context_window(value: &Value) -> bool {
    value.get("context_window").is_some_and(Value::is_object)
}

fn used_percentage(value: &Value) -> Option<f64> {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("used_percentage"))
        .and_then(Value::as_f64)
}

fn remaining_percentage(value: &Value) -> Option<f64> {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("remaining_percentage"))
        .and_then(Value::as_f64)
}

fn context_window_size(value: &Value) -> u64 {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("context_window_size"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn total_input_tokens(value: &Value) -> u64 {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("total_input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn total_output_tokens(value: &Value) -> u64 {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("total_output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn current_usage(value: &Value) -> Option<CurrentUsage> {
    has_current_usage(value).then(|| CurrentUsage {
        input_tokens: u64_or(
            value,
            &["context_window", "current_usage", "input_tokens"],
            0,
        ),
        output_tokens: u64_or(
            value,
            &["context_window", "current_usage", "output_tokens"],
            0,
        ),
        cache_creation_input_tokens: u64_or(
            value,
            &[
                "context_window",
                "current_usage",
                "cache_creation_input_tokens",
            ],
            0,
        ),
        cache_read_input_tokens: u64_or(
            value,
            &["context_window", "current_usage", "cache_read_input_tokens"],
            0,
        ),
    })
}

fn has_current_usage(value: &Value) -> bool {
    value
        .get("context_window")
        .and_then(|context_window| context_window.get("current_usage"))
        .is_some_and(Value::is_object)
}

fn has_cost(value: &Value) -> bool {
    value.get("cost").is_some_and(Value::is_object)
}

fn total_cost_usd(value: &Value) -> f64 {
    value
        .get("cost")
        .and_then(|cost| cost.get("total_cost_usd"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn total_duration_ms(value: &Value) -> u64 {
    value
        .get("cost")
        .and_then(|cost| cost.get("total_duration_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn total_api_duration_ms(value: &Value) -> u64 {
    value
        .get("cost")
        .and_then(|cost| cost.get("total_api_duration_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn total_lines_added(value: &Value) -> u64 {
    value
        .get("cost")
        .and_then(|cost| cost.get("total_lines_added"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn total_lines_removed(value: &Value) -> u64 {
    value
        .get("cost")
        .and_then(|cost| cost.get("total_lines_removed"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn has_rate_limits(value: &Value) -> bool {
    value.get("rate_limits").is_some_and(Value::is_object)
}

fn five_hour_rate_limit(value: &Value) -> Option<RateLimitInfo> {
    has_rate_limit_window(value, "five_hour").then(|| RateLimitInfo {
        used_percentage: f64_or(value, &["rate_limits", "five_hour", "used_percentage"], 0.0),
        resets_at: u64_or(value, &["rate_limits", "five_hour", "resets_at"], 0),
    })
}

fn seven_day_rate_limit(value: &Value) -> Option<RateLimitInfo> {
    has_rate_limit_window(value, "seven_day").then(|| RateLimitInfo {
        used_percentage: f64_or(value, &["rate_limits", "seven_day", "used_percentage"], 0.0),
        resets_at: u64_or(value, &["rate_limits", "seven_day", "resets_at"], 0),
    })
}

fn has_rate_limit_window(value: &Value, window: &str) -> bool {
    value
        .get("rate_limits")
        .and_then(|rate_limits| rate_limits.get(window))
        .is_some_and(Value::is_object)
}

fn value_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
}

fn f64_at(value: &Value, path: &[&str]) -> Option<f64> {
    value_at(value, path).and_then(Value::as_f64)
}

fn u64_or(value: &Value, path: &[&str], default: u64) -> u64 {
    value_at(value, path)
        .and_then(Value::as_u64)
        .unwrap_or(default)
}

fn f64_or(value: &Value, path: &[&str], default: f64) -> f64 {
    f64_at(value, path).unwrap_or(default)
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
    fn clamps_context_window_percentages() {
        let json = r#"{
            "context_window": {
                "used_percentage": 150.0,
                "remaining_percentage": -50.0,
                "context_window_size": 200000,
                "total_input_tokens": 300000,
                "total_output_tokens": 0
            }
        }"#;
        let result = parse_statusline("pty-clamp", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.context_window.used_percentage, Some(100.0));
        assert!((event.context_window.remaining_percentage - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn clamps_computed_context_window_percentage() {
        let json = r#"{
            "context_window": {
                "used_percentage": null,
                "context_window_size": 200000,
                "total_input_tokens": 300000,
                "total_output_tokens": 0
            }
        }"#;
        let result = parse_statusline("pty-computed-clamp", json);
        assert!(result.is_ok());

        let event = &result.unwrap().event;
        assert_eq!(event.context_window.used_percentage, Some(100.0));
        assert!((event.context_window.remaining_percentage - 0.0).abs() < f64::EPSILON);
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
