//! Parser for opencode bridge JSONL files.
//!
//! [`parse_bridge_snapshot`] folds a `<sessionID>.jsonl` (written by the
//! vimeflow-opencode-bridge plugin) into a [`StatusSnapshot`]. The fold
//! is tolerant: a malformed or partial-trailing line is silently skipped;
//! no line ever panics the whole document. This mirrors the shape of
//! `codex/parser.rs::parse_rollout_snapshot`.
//!
//! ## Field sources
//!
//! | StatusSnapshot field           | Bridge line                                      |
//! |-------------------------------|--------------------------------------------------|
//! | `agent_session_id`             | latest `session.created/updated` → `info.id`     |
//! | `model_id` / `model_display_name` | `info.model.id`                              |
//! | `version`                      | `info.version`                                   |
//! | `context_window.total_input_tokens`  | `info.tokens.input`                      |
//! | `context_window.total_output_tokens` | `info.tokens.output`                     |
//! | `cost.total_cost_usd`          | `info.cost`                                      |
//! | `context_window.current_usage` | latest `step-finish` → `data.part.tokens`        |
//! | `context_window_size`          | `OPENCODE_CONTEXT_WINDOW_SIZE` (0 = unknown)     |
//! | `rate_limits`                  | safe default (`five_hour: 0.0 / 0`)              |
//! | `usage_fetched`                | always `false`                                   |

use serde_json::Value;

use crate::agent::adapter::types::StatusSnapshot;
use crate::agent::adapter::opencode::transcript_dto::{OpencodeKind, OpencodeEventType, OpencodeLineDto};
use crate::agent::adapter::opencode::types::OPENCODE_CONTEXT_WINDOW_SIZE;
use crate::agent::types::{
    ContextWindowStatus, CostMetrics, CurrentUsage, RateLimitInfo, RateLimits,
};

// ─── fold accumulator ──────────────────────────────────────────────────────

#[derive(Default)]
struct OpencodeFoldState {
    /// Agent's internal session id (from `info.id`).
    agent_session_id: String,
    /// Model id (from `info.model.id`).
    model_id: String,
    /// Version string (from `info.version`).
    version: String,
    /// Lifetime total input tokens (from latest `session.created/updated`).
    total_input_tokens: u64,
    /// Lifetime total output tokens (from latest `session.created/updated`).
    total_output_tokens: u64,
    /// Total cost USD (from latest `session.created/updated` → `info.cost`).
    cost_usd: Option<f64>,
    /// Current-step usage from the latest `step-finish` part.
    step_usage: Option<StepUsage>,
}

#[derive(Clone)]
struct StepUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
}

impl OpencodeFoldState {
    fn into_snapshot(self) -> StatusSnapshot {
        let context_window_size = OPENCODE_CONTEXT_WINDOW_SIZE; // 0 = unknown

        // With context_window_size == 0 we cannot compute a meaningful percentage.
        let used_percentage: Option<f64> = if context_window_size == 0 {
            None
        } else {
            let total = self.total_input_tokens + self.total_output_tokens;
            Some((total as f64 / context_window_size as f64 * 100.0).clamp(0.0, 100.0))
        };

        let remaining_percentage = used_percentage
            .map(|u| (100.0_f64 - u).clamp(0.0, 100.0))
            .unwrap_or(100.0);

        let current_usage = self.step_usage.map(|su| CurrentUsage {
            input_tokens: su.input_tokens,
            output_tokens: su.output_tokens,
            cache_creation_input_tokens: su.cache_write_tokens,
            cache_read_input_tokens: su.cache_read_tokens,
        });

        let context_window = ContextWindowStatus {
            used_percentage,
            remaining_percentage,
            context_window_size,
            total_input_tokens: self.total_input_tokens,
            total_output_tokens: self.total_output_tokens,
            current_usage,
        };

        let cost = CostMetrics {
            total_cost_usd: self.cost_usd,
            total_duration_ms: 0,
            total_api_duration_ms: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
        };

        let rate_limits = RateLimits {
            five_hour: RateLimitInfo {
                used_percentage: 0.0,
                resets_at: 0,
            },
            seven_day: None,
        };

        let (model_id, model_display_name) = if self.model_id.is_empty() {
            ("unknown".to_string(), "unknown".to_string())
        } else {
            (self.model_id.clone(), self.model_id)
        };

        StatusSnapshot {
            agent_session_id: self.agent_session_id,
            model_id,
            model_display_name,
            version: self.version,
            context_window,
            cost,
            rate_limits,
            usage_fetched: false,
        }
    }
}

// ─── fold helpers ──────────────────────────────────────────────────────────

/// Extract a string leaf from a `serde_json::Value` via a dot-separated path.
/// Returns `None` if any segment is missing or the final value is not a string.
fn value_str<'v>(v: &'v Value, path: &[&str]) -> Option<&'v str> {
    let mut cur = v;
    for seg in path {
        cur = cur.get(seg)?;
    }
    cur.as_str()
}

/// Extract a `u64` leaf from a `serde_json::Value` via a dot-separated path.
fn value_u64(v: &Value, path: &[&str]) -> Option<u64> {
    let mut cur = v;
    for seg in path {
        cur = cur.get(seg)?;
    }
    cur.as_u64()
}

/// Extract an `f64` leaf from a `serde_json::Value` via a dot-separated path.
fn value_f64(v: &Value, path: &[&str]) -> Option<f64> {
    let mut cur = v;
    for seg in path {
        cur = cur.get(seg)?;
    }
    cur.as_f64()
}

fn fold_session_info(state: &mut OpencodeFoldState, info: &Value) {
    if let Some(id) = value_str(info, &["id"]) {
        if !id.is_empty() {
            state.agent_session_id = id.to_string();
        }
    }
    if let Some(ver) = value_str(info, &["version"]) {
        if !ver.is_empty() {
            state.version = ver.to_string();
        }
    }
    if let Some(model_id) = value_str(info, &["model", "id"]) {
        if !model_id.is_empty() {
            state.model_id = model_id.to_string();
        }
    }
    if let Some(input) = value_u64(info, &["tokens", "input"]) {
        state.total_input_tokens = input;
    }
    if let Some(output) = value_u64(info, &["tokens", "output"]) {
        state.total_output_tokens = output;
    }
    // `cost` in the bridge is a number (USD); `None` means missing field.
    if let Some(cost) = value_f64(info, &["cost"]) {
        state.cost_usd = Some(cost);
    }
}

fn fold_step_finish(state: &mut OpencodeFoldState, part: &Value) {
    // `data.part.tokens` carries per-step usage for a `step-finish` part.
    let tokens = match part.get("tokens") {
        Some(t) if t.is_object() => t,
        _ => return,
    };

    let input = tokens.get("input").and_then(Value::as_u64).unwrap_or(0);
    let output = tokens.get("output").and_then(Value::as_u64).unwrap_or(0);
    let cache_read = tokens
        .get("cache")
        .and_then(|c| c.get("read"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_write = tokens
        .get("cache")
        .and_then(|c| c.get("write"))
        .and_then(Value::as_u64)
        .unwrap_or(0);

    state.step_usage = Some(StepUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
    });
}

fn fold_line(state: &mut OpencodeFoldState, dto: &OpencodeLineDto) {
    match dto.kind() {
        OpencodeKind::Event => match dto.event_type() {
            OpencodeEventType::SessionCreated | OpencodeEventType::SessionUpdated => {
                if let Some(info) = dto.data.get("info") {
                    fold_session_info(state, info);
                }
            }
            OpencodeEventType::MessagePartUpdated => {
                // Only fold `step-finish` parts.
                if let Some(part) = dto.data.get("part") {
                    if part.get("type").and_then(Value::as_str) == Some("step-finish") {
                        fold_step_finish(state, part);
                    }
                }
            }
            _ => {} // All other event types are not needed by the snapshot decoder.
        },
        // tool.before / tool.after / Unknown — not needed by the snapshot fold.
        _ => {}
    }
}

// ─── public entry point ────────────────────────────────────────────────────

/// Fold `raw` (the contents of a `<sessionID>.jsonl` bridge file) into a
/// [`StatusSnapshot`].
///
/// Every line is parsed independently. Empty lines and lines that fail to
/// deserialize are silently skipped (the same tolerant behavior as
/// `codex/parser.rs::parse_rollout_snapshot`). The incomplete partial-trailing
/// line that a mid-write tail produces is also dropped.
///
/// The first caller in production is M5's `StateDecoder` impl on
/// `OpenCodeAdapter`.
#[allow(dead_code)]
pub(crate) fn parse_bridge_snapshot(raw: &str) -> StatusSnapshot {
    let mut state = OpencodeFoldState::default();

    let lines: Vec<&str> = raw.split('\n').collect();
    let trailing_complete = raw.ends_with('\n');

    for (idx, line) in lines.iter().enumerate() {
        let is_last = idx + 1 == lines.len();
        if line.is_empty() {
            continue;
        }
        // Drop the last line if it has no trailing newline — it's a partial write.
        if is_last && !trailing_complete {
            continue;
        }

        match serde_json::from_str::<OpencodeLineDto>(line) {
            Ok(dto) => fold_line(&mut state, &dto),
            Err(_) => log::warn!("opencode: skipping malformed bridge line"),
        }
    }

    state.into_snapshot()
}

// ─── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Load the authored `sample_bridge.jsonl` fixture (embedded at
    /// compile time so the test works regardless of cwd).
    const SAMPLE_BRIDGE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/agent/adapter/opencode/fixtures/sample_bridge.jsonl"
    ));

    // ── fixture-based tests ───────────────────────────────────────────

    #[test]
    fn snapshot_has_correct_model_and_version_from_fixture() {
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        assert_eq!(snap.model_id, "claude-sonnet-4");
        assert_eq!(snap.model_display_name, "claude-sonnet-4");
        assert_eq!(snap.version, "1.17.8");
    }

    #[test]
    fn snapshot_has_correct_agent_session_id_from_fixture() {
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        assert_eq!(snap.agent_session_id, "ses_sample001");
    }

    #[test]
    fn snapshot_has_correct_token_totals_from_session_updated() {
        // The fixture's `session.updated` (the last session event) carries
        // tokens: { input: 1820, output: 260, ... }.
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        assert_eq!(snap.context_window.total_input_tokens, 1820);
        assert_eq!(snap.context_window.total_output_tokens, 260);
    }

    #[test]
    fn snapshot_has_correct_cost_from_fixture() {
        // `session.updated` carries `cost: 0.012`.
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        let cost = snap.cost.total_cost_usd.expect("cost should be set");
        assert!((cost - 0.012).abs() < 1e-9, "cost should be 0.012, got {cost}");
    }

    #[test]
    fn snapshot_current_usage_from_step_finish() {
        // The fixture's `step-finish` part carries
        // tokens: { input: 1820, output: 260, cache: { read: 1200, write: 600 } }.
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        let cu = snap
            .context_window
            .current_usage
            .expect("current_usage should be present from step-finish");
        assert_eq!(cu.input_tokens, 1820);
        assert_eq!(cu.output_tokens, 260);
        assert_eq!(cu.cache_read_input_tokens, 1200);
        assert_eq!(cu.cache_creation_input_tokens, 600);
    }

    #[test]
    fn context_window_size_is_zero_unknown() {
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        assert_eq!(snap.context_window.context_window_size, 0);
        // With size == 0 we cannot compute a percentage.
        assert!(snap.context_window.used_percentage.is_none());
    }

    #[test]
    fn rate_limits_are_safe_default() {
        let snap = parse_bridge_snapshot(SAMPLE_BRIDGE);
        assert!((snap.rate_limits.five_hour.used_percentage - 0.0).abs() < f64::EPSILON);
        assert_eq!(snap.rate_limits.five_hour.resets_at, 0);
        assert!(snap.rate_limits.seven_day.is_none());
        assert!(!snap.usage_fetched);
    }

    // ── malformed / edge-case tests ────────────────────────────────────

    /// A garbage line in the middle is skipped; the fold succeeds and the
    /// good lines before and after still contribute.
    #[test]
    fn malformed_mid_line_is_tolerated() {
        let raw = concat!(
            "{\"v\":1,\"ts\":1,\"kind\":\"event\",\"type\":\"session.created\",\"data\":{\"info\":{\"id\":\"ses_tol\",\"version\":\"1.0.0\",\"model\":{\"id\":\"claude-opus\"},\"cost\":0,\"tokens\":{\"input\":100,\"output\":50,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
            "THIS IS NOT JSON AT ALL !!!\n",
            "{\"v\":1,\"ts\":2,\"kind\":\"event\",\"type\":\"session.updated\",\"data\":{\"info\":{\"id\":\"ses_tol\",\"version\":\"1.0.0\",\"model\":{\"id\":\"claude-opus\"},\"cost\":0.001,\"tokens\":{\"input\":200,\"output\":80,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
        );

        let snap = parse_bridge_snapshot(raw);
        assert_eq!(snap.agent_session_id, "ses_tol");
        assert_eq!(snap.model_id, "claude-opus");
        // The second good session.updated (after the garbage line) is applied.
        assert_eq!(snap.context_window.total_input_tokens, 200);
        assert_eq!(snap.context_window.total_output_tokens, 80);
        let cost = snap.cost.total_cost_usd.expect("cost set");
        assert!((cost - 0.001).abs() < 1e-9);
    }

    /// A bridge with no `step-finish` event → current_usage is None, no panic.
    #[test]
    fn no_step_finish_yields_zero_current_usage() {
        let raw = concat!(
            "{\"v\":1,\"ts\":1,\"kind\":\"event\",\"type\":\"session.created\",\"data\":{\"info\":{\"id\":\"ses_nostep\",\"version\":\"1.0.0\",\"model\":{\"id\":\"gpt-4o\"},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
        );

        let snap = parse_bridge_snapshot(raw);
        assert_eq!(snap.agent_session_id, "ses_nostep");
        assert!(snap.context_window.current_usage.is_none());
        assert_eq!(snap.context_window.total_input_tokens, 0);
    }

    /// An entirely empty input produces a default snapshot without panicking.
    #[test]
    fn empty_input_returns_default_snapshot_no_panic() {
        let snap = parse_bridge_snapshot("");
        assert_eq!(snap.agent_session_id, "");
        assert_eq!(snap.model_id, "unknown");
        assert_eq!(snap.model_display_name, "unknown");
        assert_eq!(snap.version, "");
        assert_eq!(snap.context_window.total_input_tokens, 0);
        assert_eq!(snap.context_window.total_output_tokens, 0);
        assert!(snap.context_window.current_usage.is_none());
        assert!(snap.cost.total_cost_usd.is_none());
        assert!(!snap.usage_fetched);
    }

    /// A file that ends with a partial (no trailing newline) last line
    /// silently drops it and still folds the rest correctly.
    #[test]
    fn partial_trailing_line_dropped_silently() {
        // The second line has no trailing '\n' — it must be dropped.
        let raw = "{\"v\":1,\"ts\":1,\"kind\":\"event\",\"type\":\"session.created\",\"data\":{\"info\":{\"id\":\"ses_partial\",\"version\":\"0.9\",\"model\":{\"id\":\"m1\"},\"cost\":0,\"tokens\":{\"input\":10,\"output\":5,\"cache\":{\"read\":0,\"write\":0}}}}}\n{INCOMPLETE";

        let snap = parse_bridge_snapshot(raw);
        assert_eq!(snap.agent_session_id, "ses_partial");
        assert_eq!(snap.model_id, "m1");
    }

    /// The latest `session.updated` wins over an earlier `session.created`
    /// for all session-level fields.
    #[test]
    fn latest_session_event_wins() {
        let raw = concat!(
            "{\"v\":1,\"ts\":1,\"kind\":\"event\",\"type\":\"session.created\",\"data\":{\"info\":{\"id\":\"ses_win\",\"version\":\"1.0.0\",\"model\":{\"id\":\"old-model\"},\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
            "{\"v\":1,\"ts\":2,\"kind\":\"event\",\"type\":\"session.updated\",\"data\":{\"info\":{\"id\":\"ses_win\",\"version\":\"1.17.8\",\"model\":{\"id\":\"new-model\"},\"cost\":0.5,\"tokens\":{\"input\":500,\"output\":100,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
        );

        let snap = parse_bridge_snapshot(raw);
        assert_eq!(snap.model_id, "new-model");
        assert_eq!(snap.version, "1.17.8");
        assert_eq!(snap.context_window.total_input_tokens, 500);
        let cost = snap.cost.total_cost_usd.expect("cost set");
        assert!((cost - 0.5).abs() < 1e-9);
    }

    /// The latest `step-finish` part's tokens win when there are multiple.
    #[test]
    fn latest_step_finish_wins() {
        let raw = concat!(
            "{\"v\":1,\"ts\":1,\"kind\":\"event\",\"type\":\"message.part.updated\",\"data\":{\"part\":{\"type\":\"step-finish\",\"tokens\":{\"input\":100,\"output\":20,\"cache\":{\"read\":0,\"write\":0}}}}}\n",
            "{\"v\":1,\"ts\":2,\"kind\":\"event\",\"type\":\"message.part.updated\",\"data\":{\"part\":{\"type\":\"step-finish\",\"tokens\":{\"input\":300,\"output\":60,\"cache\":{\"read\":50,\"write\":10}}}}}\n",
        );

        let snap = parse_bridge_snapshot(raw);
        let cu = snap
            .context_window
            .current_usage
            .expect("current_usage present");
        assert_eq!(cu.input_tokens, 300);
        assert_eq!(cu.output_tokens, 60);
        assert_eq!(cu.cache_read_input_tokens, 50);
        assert_eq!(cu.cache_creation_input_tokens, 10);
    }
}
