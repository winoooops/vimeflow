//! Builds a TestRunSnapshot from a matched test-run tool_use + tool_result.

use std::path::Path;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;

use super::matcher::MatchedCommand;
use super::preview::build_command_preview;
use super::sanitiser::sanitize_for_ui;
use super::timestamps::compute_duration_ms;
use super::types::{
    CapturedOutput, TestRunSnapshot, TestRunStatus, TestRunSummary,
};

const MAX_EXCERPT_LEN: usize = 240;

static ERROR_HINT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(error:|fail|panicked)").unwrap());
static ANSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());

pub struct BuildArgs<'a> {
    pub session_id: &'a str,
    pub matched: &'a MatchedCommand,
    pub started_at: &'a str,
    pub finished_at: &'a str,
    pub instant_fallback: Duration,
    pub captured: CapturedOutput,
    pub cwd: &'a Path,
}

pub fn build_snapshot(args: BuildArgs<'_>) -> TestRunSnapshot {
    let summary = (args.matched.runner.parse_result)(&args.captured, args.cwd);
    let status = derive_status(summary.as_ref(), args.captured.is_error);
    let summary = summary.unwrap_or_default();

    let output_excerpt = if matches!(status, TestRunStatus::Error) {
        Some(extract_excerpt(&args.captured.content))
    } else {
        None
    };

    TestRunSnapshot {
        session_id: args.session_id.to_string(),
        runner: args.matched.runner.name.to_string(),
        command_preview: build_command_preview(&args.matched.stripped_tokens),
        started_at: args.started_at.to_string(),
        finished_at: args.finished_at.to_string(),
        duration_ms: compute_duration_ms(
            args.started_at,
            args.finished_at,
            args.instant_fallback,
        ),
        status,
        summary,
        output_excerpt,
    }
}

/// Returns Some(snapshot) when an event should be emitted; None when we
/// don't know what happened (parser returned None AND not an error result).
pub fn maybe_build_snapshot(args: BuildArgs<'_>) -> Option<TestRunSnapshot> {
    let summary = (args.matched.runner.parse_result)(&args.captured, args.cwd);
    if summary.is_none() && !args.captured.is_error {
        log::debug!(
            "Test runner '{}' produced unparseable output, skipping emit",
            args.matched.runner.name
        );
        return None;
    }
    Some(build_snapshot(args))
}

fn derive_status(summary: Option<&TestRunSummary>, is_error: bool) -> TestRunStatus {
    match summary {
        Some(s) if s.failed > 0 => TestRunStatus::Fail,
        Some(s) if s.total == 0 => TestRunStatus::NoTests,
        Some(_) => TestRunStatus::Pass,
        None if is_error => TestRunStatus::Error,
        None => TestRunStatus::Error, // maybe_build_snapshot already filtered the unknown case
    }
}

fn extract_excerpt(content: &str) -> String {
    let stripped = ANSI_RE.replace_all(content, "");
    // Prefer the first line containing an error hint; else first non-blank line.
    let preferred = stripped
        .lines()
        .find(|l| ERROR_HINT_RE.is_match(l) && !l.trim().is_empty());
    let chosen = preferred.unwrap_or_else(|| {
        stripped.lines().find(|l| !l.trim().is_empty()).unwrap_or("")
    });
    let truncated: String = chosen.chars().take(MAX_EXCERPT_LEN).collect();
    sanitize_for_ui(&truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_prefers_error_hint() {
        let s = extract_excerpt(
            "  some preamble\n  error: type mismatch in foo.test.ts\n  more output",
        );
        assert!(s.contains("error: type mismatch"));
    }

    #[test]
    fn excerpt_falls_back_to_first_non_blank() {
        let s = extract_excerpt("\n   \nfirst real line\nsecond line");
        assert!(s.contains("first real line"));
    }

    #[test]
    fn excerpt_caps_length() {
        let long = "x".repeat(500);
        let body = format!("error: {}", long);
        let s = extract_excerpt(&body);
        assert!(s.chars().count() <= MAX_EXCERPT_LEN);
    }

    #[test]
    fn excerpt_runs_through_sanitiser() {
        let s = extract_excerpt("error: bearer eyJabcdefghijklmnop.body.sig was rejected");
        assert!(s.contains("[REDACTED]"));
    }

    #[test]
    fn derive_status_picks_fail_over_total() {
        let s = TestRunSummary { passed: 5, failed: 1, skipped: 0, total: 6, groups: vec![] };
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::Fail);
    }

    #[test]
    fn derive_status_picks_no_tests() {
        let s = TestRunSummary::default();
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::NoTests);
    }

    #[test]
    fn derive_status_picks_pass() {
        let s = TestRunSummary { passed: 3, failed: 0, skipped: 0, total: 3, groups: vec![] };
        assert_eq!(derive_status(Some(&s), false), TestRunStatus::Pass);
    }

    #[test]
    fn derive_status_picks_error_when_unparseable_and_is_error() {
        assert_eq!(derive_status(None, true), TestRunStatus::Error);
    }
}
