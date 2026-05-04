//! Parser for Codex rollout JSONL files.

use crate::agent::adapter::types::ParsedStatus;
use crate::agent::types::{
    AgentStatusEvent, ContextWindowStatus, CostMetrics, CurrentUsage, RateLimitInfo, RateLimits,
};
use serde_json::Value;

pub fn parse_rollout(
    session_id: &str,
    raw: &str,
    transcript_path: Option<String>,
) -> Result<ParsedStatus, String> {
    let mut state = CodexFoldState::default();
    let lines: Vec<&str> = raw.split('\n').collect();
    let trailing_complete = raw.ends_with('\n');

    for (idx, line) in lines.iter().enumerate() {
        let is_last = idx + 1 == lines.len();
        if line.is_empty() {
            continue;
        }
        if is_last && !trailing_complete {
            continue;
        }

        match serde_json::from_str::<Value>(line) {
            Ok(value) => fold_event(&mut state, &value),
            Err(_) => log::warn!(
                "codex: skipping malformed rollout line for sid={}",
                session_id
            ),
        }
    }

    Ok(ParsedStatus {
        event: state.into_event(session_id),
        transcript_path,
    })
}

#[derive(Default)]
struct CodexFoldState {
    agent_session_id: String,
    cli_version: String,
    model: String,
    last_task_started_context_window: Option<u64>,
    last_token_count_info: Option<TokenCountInfo>,
    last_rate_limits: Option<RateLimits>,
    total_duration_ms: u64,
}

#[derive(Clone)]
struct TokenCountInfo {
    last_input_tokens: u64,
    last_output_tokens: u64,
    last_cached_input_tokens: u64,
    last_total_tokens: u64,
    model_context_window: u64,
}

impl CodexFoldState {
    fn into_event(self, session_id: &str) -> AgentStatusEvent {
        let context_window_size = self
            .last_token_count_info
            .as_ref()
            .map(|info| info.model_context_window)
            .or(self.last_task_started_context_window)
            .unwrap_or(0);

        let used_percentage = self.last_token_count_info.as_ref().and_then(|info| {
            if context_window_size == 0 {
                None
            } else {
                Some(clamp_percentage(
                    (info.last_total_tokens as f64 / context_window_size as f64) * 100.0,
                ))
            }
        });

        let remaining_percentage = used_percentage
            .map(|used| clamp_percentage(100.0 - used))
            .unwrap_or(100.0);

        let context_window = ContextWindowStatus {
            used_percentage,
            remaining_percentage,
            context_window_size,
            total_input_tokens: self
                .last_token_count_info
                .as_ref()
                .map(|info| info.last_input_tokens)
                .unwrap_or(0),
            total_output_tokens: self
                .last_token_count_info
                .as_ref()
                .map(|info| info.last_output_tokens)
                .unwrap_or(0),
            current_usage: self
                .last_token_count_info
                .as_ref()
                .map(|info| CurrentUsage {
                    input_tokens: info.last_input_tokens,
                    output_tokens: info.last_output_tokens,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: info.last_cached_input_tokens,
                }),
        };

        let cost = CostMetrics {
            total_cost_usd: None,
            total_duration_ms: self.total_duration_ms,
            total_api_duration_ms: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
        };

        let rate_limits = self.last_rate_limits.unwrap_or(RateLimits {
            five_hour: RateLimitInfo {
                used_percentage: 0.0,
                resets_at: 0,
            },
            seven_day: None,
        });

        AgentStatusEvent {
            session_id: session_id.to_string(),
            agent_session_id: self.agent_session_id,
            model_id: if self.model.is_empty() {
                "unknown".to_string()
            } else {
                self.model.clone()
            },
            model_display_name: if self.model.is_empty() {
                "unknown".to_string()
            } else {
                self.model
            },
            version: self.cli_version,
            context_window,
            cost,
            rate_limits,
        }
    }
}

fn fold_event(state: &mut CodexFoldState, value: &Value) {
    match value.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            absorb_session_meta(state, value.get("payload").unwrap_or(&Value::Null))
        }
        Some("turn_context") => {
            absorb_turn_context(state, value.get("payload").unwrap_or(&Value::Null))
        }
        Some("event_msg") => {
            let payload = value.get("payload").unwrap_or(&Value::Null);
            match payload.get("type").and_then(Value::as_str) {
                Some("task_started") => absorb_task_started(state, payload),
                Some("task_complete") => absorb_task_complete(state, payload),
                Some("token_count") => absorb_token_count(state, payload),
                _ => {}
            }
        }
        _ => {}
    }
}

fn absorb_session_meta(state: &mut CodexFoldState, payload: &Value) {
    if let Some(id) = payload.get("id").and_then(Value::as_str) {
        state.agent_session_id = id.to_string();
    }
    if let Some(version) = payload.get("cli_version").and_then(Value::as_str) {
        state.cli_version = version.to_string();
    }
}

fn absorb_turn_context(state: &mut CodexFoldState, payload: &Value) {
    if let Some(model) = payload.get("model").and_then(Value::as_str) {
        state.model = model.to_string();
    }
}

fn absorb_task_started(state: &mut CodexFoldState, payload: &Value) {
    if let Some(size) = payload.get("model_context_window").and_then(Value::as_u64) {
        state.last_task_started_context_window = Some(size);
    }
}

fn absorb_task_complete(state: &mut CodexFoldState, payload: &Value) {
    if let Some(duration_ms) = payload.get("duration_ms").and_then(Value::as_u64) {
        state.total_duration_ms = state.total_duration_ms.saturating_add(duration_ms);
    }
}

fn absorb_token_count(state: &mut CodexFoldState, payload: &Value) {
    if let Some(info) = payload.get("info") {
        if !info.is_null() {
            state.last_token_count_info = Some(parse_token_count_info(info));
        }
    }

    if let Some(rate_limits) = payload.get("rate_limits") {
        if !rate_limits.is_null() {
            state.last_rate_limits = Some(parse_rate_limits(rate_limits));
        }
    }
}

fn parse_token_count_info(info: &Value) -> TokenCountInfo {
    let last = info.get("last_token_usage").unwrap_or(&Value::Null);

    TokenCountInfo {
        last_input_tokens: last
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        last_output_tokens: last
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        last_cached_input_tokens: last
            .get("cached_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        last_total_tokens: last
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        model_context_window: info
            .get("model_context_window")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

fn parse_rate_limits(value: &Value) -> RateLimits {
    let primary = value.get("primary").unwrap_or(&Value::Null);
    let five_hour = RateLimitInfo {
        used_percentage: primary
            .get("used_percent")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        resets_at: primary
            .get("resets_at")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    };

    let seven_day = value.get("secondary").and_then(|secondary| {
        if secondary.is_null() {
            None
        } else {
            Some(RateLimitInfo {
                used_percentage: secondary
                    .get("used_percent")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                resets_at: secondary
                    .get("resets_at")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            })
        }
    });

    RateLimits {
        five_hour,
        seven_day,
    }
}

fn clamp_percentage(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/codex")
            .join(name);

        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read fixture {}: {}", path.display(), e))
    }

    #[test]
    fn parses_minimal_single_turn() {
        let raw = fixture("rollout-minimal.jsonl");
        let parsed = parse_rollout("pty-test", &raw, None).expect("happy path");
        let event = parsed.event;

        assert_eq!(event.session_id, "pty-test");
        assert_eq!(
            event.agent_session_id,
            "019defd8-15a1-7401-9f4f-40fe52a1c590"
        );
        assert_eq!(event.model_id, "gpt-5.4");
        assert_eq!(event.model_display_name, "gpt-5.4");
        assert_eq!(event.version, "0.128.0");
        assert_eq!(event.context_window.context_window_size, 258400);
        assert_eq!(event.context_window.total_input_tokens, 52685);
        assert_eq!(event.context_window.total_output_tokens, 2177);

        let used = event
            .context_window
            .used_percentage
            .expect("used percentage");
        assert!(
            (used - 21.23).abs() < 0.5,
            "used_percentage near 21%, got {}",
            used
        );

        let current_usage = event
            .context_window
            .current_usage
            .expect("current usage should be present");
        assert_eq!(current_usage.cache_read_input_tokens, 51584);
        assert_eq!(current_usage.cache_creation_input_tokens, 0);

        assert_eq!(event.cost.total_cost_usd, None);
        assert_eq!(event.cost.total_duration_ms, 208025);
        assert_eq!(event.cost.total_api_duration_ms, 0);
        assert!((event.rate_limits.five_hour.used_percentage - 8.0).abs() < f64::EPSILON);
        assert!(
            (event
                .rate_limits
                .seven_day
                .expect("seven day limit")
                .used_percentage
                - 26.0)
                .abs()
                < f64::EPSILON
        );
        assert!(parsed.transcript_path.is_none());
    }

    #[test]
    fn long_session_uses_last_token_usage_not_lifetime() {
        let raw = fixture("rollout-long-session.jsonl");
        let parsed = parse_rollout("pty-long", &raw, None).expect("long session");
        let event = parsed.event;
        let used = event
            .context_window
            .used_percentage
            .expect("used percentage");

        assert!(
            (used - 20.94).abs() < 0.5,
            "used_percentage must reflect last_token_usage, got {}",
            used
        );
        assert!(used < 100.0);
        assert_eq!(event.context_window.total_input_tokens, 52000);
        assert_eq!(event.context_window.total_output_tokens, 2100);
    }

    #[test]
    fn token_count_info_null_preserves_prior_context() {
        let raw = fixture("rollout-info-null.jsonl");
        let parsed = parse_rollout("pty-info-null", &raw, None).expect("info-null");
        let event = parsed.event;

        assert_eq!(event.context_window.total_input_tokens, 1000);
        assert_eq!(event.context_window.total_output_tokens, 200);
        assert!((event.rate_limits.five_hour.used_percentage - 4.0).abs() < f64::EPSILON);
    }

    #[test]
    fn multi_turn_sums_durations() {
        let raw = fixture("rollout-multi-turn.jsonl");
        let parsed = parse_rollout("pty-multi", &raw, None).expect("multi-turn");
        assert_eq!(parsed.event.cost.total_duration_ms, 60000);
    }

    #[test]
    fn incomplete_trailing_line_dropped_silently() {
        let raw = fixture("rollout-incomplete-trail.jsonl");
        let parsed = parse_rollout("pty-trail", &raw, None).expect("incomplete trail");

        assert_eq!(parsed.event.cost.total_duration_ms, 0);
        assert_eq!(parsed.event.model_id, "gpt-5.4");
    }

    #[test]
    fn malformed_mid_line_skipped_with_warn() {
        let raw = fixture("rollout-malformed-mid.jsonl");
        let parsed = parse_rollout("pty-malformed", &raw, None).expect("malformed mid");

        assert_eq!(parsed.event.agent_session_id, "sess-malformed");
        assert_eq!(parsed.event.model_id, "gpt-5.4");
    }

    #[test]
    fn task_started_fallback_for_context_window_size() {
        let raw = r#"{"timestamp":"...","type":"event_msg","payload":{"type":"task_started","model_context_window":128000}}
"#;
        let parsed = parse_rollout("pty-fallback", raw, None).expect("task_started fallback");
        assert_eq!(parsed.event.context_window.context_window_size, 128000);
    }

    #[test]
    fn empty_rollout_returns_defaults() {
        let parsed = parse_rollout("pty-empty", "", None).expect("empty rollout");
        assert_eq!(parsed.event.model_id, "unknown");
        assert_eq!(parsed.event.context_window.context_window_size, 0);
        assert!(parsed.event.context_window.used_percentage.is_none());
        assert_eq!(parsed.event.cost.total_cost_usd, None);
    }

    #[test]
    fn unknown_event_type_ignored_without_error() {
        let raw = r#"{"timestamp":"...","type":"future_event_kind","payload":{"hello":"world"}}
"#;
        let parsed = parse_rollout("pty-unknown", raw, None).expect("unknown event kind");
        assert_eq!(parsed.event.model_id, "unknown");
    }

    #[test]
    fn includes_transcript_path_when_provided() {
        let raw = fixture("rollout-minimal.jsonl");
        let parsed = parse_rollout(
            "pty-test",
            &raw,
            Some("/home/user/.codex/sessions/rollout.jsonl".to_string()),
        )
        .expect("happy path");

        assert_eq!(
            parsed.transcript_path.as_deref(),
            Some("/home/user/.codex/sessions/rollout.jsonl")
        );
    }
}
