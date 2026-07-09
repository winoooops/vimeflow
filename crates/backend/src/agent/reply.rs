//! Shared extraction + schema validation for the structured agent reply block
//! (VIM-283). Adapter-agnostic: each adapter passes the agent's completed reply
//! text; the sentinel scan, JSON parse, and schema live here once.

use serde::Deserialize;
use std::borrow::Cow;

use crate::agent::types::{AgentReply, AgentReplyStatus, AgentReplyTarget};

const OPEN: &str = "<<<VIMEFLOW_REPLY";
const CLOSE: &str = "VIMEFLOW_REPLY>>>";

#[derive(Debug, PartialEq)]
pub(crate) enum AgentReplyOutcome {
    // `nonce` is best-effort: Some when the block is a parseable object with a
    // non-empty string nonce (even if other schema checks fail), None only when
    // the JSON is unparseable. The frontend nonce-gates on it, so a malformed
    // block whose nonce still matches the pending dispatch reaches the degrade
    // path; a truly unparseable one (None) is ignored — it can't be correlated.
    Malformed {
        raw: String,
        nonce: Option<String>,
    },
    Structured {
        raw: String,
        nonce: String,
        replies: Vec<AgentReply>,
    },
}

#[derive(Deserialize)]
struct ReplyBlockDto {
    v: Option<i64>,
    nonce: Option<String>,
    replies: Option<Vec<ReplyDto>>,
}

#[derive(Deserialize)]
struct ReplyDto {
    id: Option<i64>,
    status: Option<String>,
    #[serde(default)]
    target: Option<String>,
    text: Option<String>,
}

/// None → no open sentinel (not a reply, caller emits nothing).
/// Some(Malformed) → sentinel present but truncated or schema-invalid.
/// Some(Structured) → schema-valid.
pub(crate) fn extract_agent_reply(reply_text: &str) -> Option<AgentReplyOutcome> {
    let open_at = reply_text.find(OPEN)?;
    let after_open = open_at + OPEN.len();
    let Some(close_rel) = reply_text[after_open..].find(CLOSE) else {
        let json = normalize_reply_json(reply_text[after_open..].trim());
        // open sentinel, no close → truncated
        return Some(AgentReplyOutcome::Malformed {
            raw: reply_text[open_at..].to_string(),
            nonce: best_effort_nonce(&json),
        });
    };
    let close_at = after_open + close_rel;
    let raw = reply_text[open_at..close_at + CLOSE.len()].to_string();
    let json = normalize_reply_json(reply_text[after_open..close_at].trim());

    match validate(&json) {
        Some((nonce, replies)) => Some(AgentReplyOutcome::Structured {
            raw,
            nonce,
            replies,
        }),
        // Best-effort nonce so a schema-invalid-but-parseable block can still be
        // nonce-gated by the frontend degrade path.
        None => Some(AgentReplyOutcome::Malformed {
            raw,
            nonce: best_effort_nonce(&json),
        }),
    }
}

pub(crate) fn normalize_reply_json(json: &str) -> Cow<'_, str> {
    if !json.lines().any(|line| line.trim_start().starts_with("> ")) {
        return Cow::Borrowed(json);
    }

    Cow::Owned(
        json.lines()
            .map(|line| {
                line.trim_start()
                    .strip_prefix("> ")
                    .or_else(|| line.trim_start().strip_prefix('>'))
                    .unwrap_or(line)
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// A non-empty string `nonce` from an otherwise-invalid block; None if the JSON
/// is unparseable or has no usable nonce.
fn best_effort_nonce(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let nonce = value.get("nonce")?.as_str()?;

    (!nonce.is_empty()).then(|| nonce.to_string())
}

fn validate(json: &str) -> Option<(String, Vec<AgentReply>)> {
    let dto: ReplyBlockDto = serde_json::from_str(json).ok()?;
    if dto.v != Some(1) {
        return None;
    }
    let nonce = dto.nonce.filter(|n| !n.is_empty())?;
    let raw_replies = dto.replies.filter(|r| !r.is_empty())?;

    let mut seen = std::collections::HashSet::new();
    let mut replies = Vec::with_capacity(raw_replies.len());
    for entry in raw_replies {
        // positive u32 only: zero, negative, or oversized → None (malformed).
        let id = u32::try_from(entry.id?).ok().filter(|&n| n > 0)?;
        if !seen.insert(id) {
            return None; // duplicate id
        }
        let status = match entry.status.as_deref()? {
            "reply" => AgentReplyStatus::Reply,
            "clarify" => AgentReplyStatus::Clarify,
            "resolved" => AgentReplyStatus::Resolved,
            "deferred" => AgentReplyStatus::Deferred,
            "rejected" => AgentReplyStatus::Rejected,
            // Legacy literals (pre-VIM-304) mapped canonically so replies keep
            // parsing while the dispatch prompt + any in-flight agents migrate.
            // TODO(VIM-304): once the migrated dispatch prompt (Task 16) has
            // shipped and no agent emits answered/changed/skipped anymore, delete
            // these three arms. Grep the repo for answered/changed/skipped first
            // to sweep any lingering references (prompt text, docs, or a legacy
            // type/alias) in the same cleanup.
            "answered" => AgentReplyStatus::Reply,
            "changed" => AgentReplyStatus::Resolved,
            "skipped" => AgentReplyStatus::Rejected,
            _ => return None,
        };
        // Absent target → Comment (shipped replies); unknown value → malformed.
        let target = match entry.target.as_deref() {
            Some("finding") => AgentReplyTarget::Finding,
            Some("comment") | None => AgentReplyTarget::Comment,
            Some(_) => return None,
        };
        replies.push(AgentReply {
            id,
            status,
            target,
            text: entry.text?,
        });
    }

    Some((nonce, replies))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(json: &str) -> String {
        format!("prose before\n{OPEN}\n{json}\n{CLOSE}\nprose after")
    }

    #[test]
    fn no_sentinel_returns_none() {
        assert_eq!(extract_agent_reply("just a normal reply"), None);
    }

    #[test]
    fn valid_block_is_structured() {
        let text =
            block(r#"{"v":1,"nonce":"abc","replies":[{"id":1,"status":"answered","text":"hi"}]}"#);
        match extract_agent_reply(&text) {
            Some(AgentReplyOutcome::Structured { nonce, replies, .. }) => {
                assert_eq!(nonce, "abc");
                assert_eq!(replies.len(), 1);
                assert_eq!(replies[0].id, 1);
                // legacy "answered" maps to the new canonical Reply outcome.
                assert_eq!(replies[0].status, AgentReplyStatus::Reply);
                assert_eq!(replies[0].text, "hi");
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }

    fn parse_status(literal: &str) -> AgentReplyStatus {
        let text = block(&format!(
            r#"{{"v":1,"nonce":"n","replies":[{{"id":1,"status":"{literal}","text":"t"}}]}}"#
        ));
        match extract_agent_reply(&text) {
            Some(AgentReplyOutcome::Structured { replies, .. }) => replies[0].status.clone(),
            other => panic!("expected Structured for {literal}, got {other:?}"),
        }
    }

    #[test]
    fn new_outcome_literals_parse() {
        assert_eq!(parse_status("reply"), AgentReplyStatus::Reply);
        assert_eq!(parse_status("clarify"), AgentReplyStatus::Clarify);
        assert_eq!(parse_status("resolved"), AgentReplyStatus::Resolved);
        assert_eq!(parse_status("deferred"), AgentReplyStatus::Deferred);
        assert_eq!(parse_status("rejected"), AgentReplyStatus::Rejected);
    }

    #[test]
    fn legacy_status_literals_map_canonically() {
        assert_eq!(parse_status("answered"), AgentReplyStatus::Reply);
        assert_eq!(parse_status("changed"), AgentReplyStatus::Resolved);
        assert_eq!(parse_status("skipped"), AgentReplyStatus::Rejected);
    }

    fn parse_one(json: &str) -> AgentReply {
        match extract_agent_reply(&block(json)) {
            Some(AgentReplyOutcome::Structured { replies, .. }) => {
                replies.into_iter().next().unwrap()
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }

    #[test]
    fn reply_target_finding_parses() {
        let reply = parse_one(
            r#"{"v":1,"nonce":"n","replies":[{"target":"finding","id":1,"status":"resolved","text":"t"}]}"#,
        );
        assert_eq!(reply.target, AgentReplyTarget::Finding);
    }

    #[test]
    fn reply_target_absent_defaults_to_comment() {
        // Shipped replies carry no `target`; they must keep landing on the comment.
        let reply =
            parse_one(r#"{"v":1,"nonce":"n","replies":[{"id":1,"status":"reply","text":"t"}]}"#);
        assert_eq!(reply.target, AgentReplyTarget::Comment);
    }

    #[test]
    fn reply_target_unknown_is_malformed() {
        let outcome = extract_agent_reply(&block(
            r#"{"v":1,"nonce":"n","replies":[{"target":"nope","id":1,"status":"reply","text":"t"}]}"#,
        ));
        assert!(matches!(outcome, Some(AgentReplyOutcome::Malformed { .. })));
    }

    #[test]
    fn open_without_close_is_malformed() {
        let text = format!("{OPEN}\n{{\"v\":1}}");
        assert!(matches!(
            extract_agent_reply(&text),
            Some(AgentReplyOutcome::Malformed { .. })
        ));
    }

    #[test]
    fn bad_json_is_malformed() {
        assert!(matches!(
            extract_agent_reply(&block("{not json")),
            Some(AgentReplyOutcome::Malformed { .. })
        ));
    }

    #[test]
    fn schema_violations_are_malformed() {
        let cases = [
            r#"{"v":2,"nonce":"a","replies":[{"id":1,"status":"answered","text":"x"}]}"#, // bad version
            r#"{"v":1,"nonce":"","replies":[{"id":1,"status":"answered","text":"x"}]}"#, // empty nonce
            r#"{"v":1,"nonce":"a","replies":[]}"#, // empty replies
            r#"{"v":1,"nonce":"a","replies":[{"id":0,"status":"answered","text":"x"}]}"#, // zero id
            r#"{"v":1,"nonce":"a","replies":[{"id":-1,"status":"answered","text":"x"}]}"#, // negative id
            r#"{"v":1,"nonce":"a","replies":[{"id":1,"status":"bogus","text":"x"}]}"#, // unknown status
            r#"{"v":1,"nonce":"a","replies":[{"id":1,"status":"answered","text":"x"},{"id":1,"status":"changed","text":"y"}]}"#, // dup id
        ];
        for case in cases {
            assert!(
                matches!(
                    extract_agent_reply(&block(case)),
                    Some(AgentReplyOutcome::Malformed { .. })
                ),
                "expected Malformed for: {case}"
            );
        }
    }

    #[test]
    fn schema_invalid_but_parseable_block_keeps_the_nonce() {
        // Bad status, but the object + nonce parse → Malformed carries the nonce
        // so the frontend can still nonce-gate the degrade.
        let text =
            block(r#"{"v":1,"nonce":"keep","replies":[{"id":1,"status":"bogus","text":"x"}]}"#);
        assert!(matches!(
            extract_agent_reply(&text),
            Some(AgentReplyOutcome::Malformed { nonce: Some(n), .. }) if n == "keep"
        ));
    }

    #[test]
    fn truncated_block_keeps_parseable_nonce() {
        let text = format!("{OPEN}\n{{\"v\":1,\"nonce\":\"keep\",\"replies\":[]}}");
        assert!(matches!(
            extract_agent_reply(&text),
            Some(AgentReplyOutcome::Malformed { nonce: Some(n), .. }) if n == "keep"
        ));
    }

    #[test]
    fn quoted_payload_is_normalized_before_validation() {
        let text = format!(
            "prose before\n{OPEN}\n> {{\"v\":1,\"nonce\":\"abc\",\"replies\":[{{\"id\":1,\"status\":\"answered\",\"text\":\"hi\"}}]}}\n> \n{CLOSE}\nprose after"
        );
        assert!(matches!(
            extract_agent_reply(&text),
            Some(AgentReplyOutcome::Structured { nonce, replies, .. })
                if nonce == "abc" && replies.len() == 1
        ));
    }

    #[test]
    fn unparseable_json_has_no_nonce() {
        assert!(matches!(
            extract_agent_reply(&block("{not json")),
            Some(AgentReplyOutcome::Malformed { nonce: None, .. })
        ));
    }

    #[test]
    fn multiline_text_round_trips() {
        let text = block(
            r#"{"v":1,"nonce":"a","replies":[{"id":2,"status":"changed","text":"line1\nline2"}]}"#,
        );
        match extract_agent_reply(&text) {
            Some(AgentReplyOutcome::Structured { replies, .. }) => {
                assert_eq!(replies[0].text, "line1\nline2")
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }
}
