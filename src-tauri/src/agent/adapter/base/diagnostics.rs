//! Debug diagnostics for the status watcher runtime.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Outcome of a transcript-start attempt. Returned so event diagnostics can
/// report an accurate status without re-walking the transcript path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TxOutcome {
    Started,
    Replaced,
    AlreadyRunning,
    Missing,
    OutsidePath,
    NotFile,
    StartFailed,
    NoPath,
    ParseError,
}

impl TxOutcome {
    pub(super) fn label(&self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Replaced => "replaced",
            Self::AlreadyRunning => "already_running",
            Self::Missing => "missing",
            Self::OutsidePath => "outside_path",
            Self::NotFile => "not_file",
            Self::StartFailed => "start_failed",
            Self::NoPath => "no_path",
            Self::ParseError => "parse_error",
        }
    }
}

/// Per-source timing state. Notify and poll each keep their own timing so the
/// logs can show which source is firing and how far apart events are.
#[derive(Default)]
pub(super) struct EventTiming {
    last_event_at: Option<Instant>,
}

/// Cross-source transcript-path history. This is shared by inline, notify,
/// and poll so a speculative path observed by one source and a resolved path
/// observed by another still records a path change.
#[derive(Default)]
pub(super) struct PathHistory {
    last_tx_path: Option<String>,
    same_path_repeat: u32,
}

impl PathHistory {
    pub(super) fn observe(&mut self, tx_path: Option<&str>) -> Option<String> {
        match (tx_path, self.last_tx_path.as_deref()) {
            (Some(new), Some(old)) if new != old => {
                let old_owned = old.to_string();
                self.last_tx_path = Some(new.to_string());
                self.same_path_repeat = 1;
                Some(old_owned)
            }
            (Some(new), None) => {
                self.last_tx_path = Some(new.to_string());
                self.same_path_repeat = 1;
                None
            }
            (Some(_), Some(_)) => {
                self.same_path_repeat = self.same_path_repeat.saturating_add(1);
                None
            }
            (None, _) => {
                self.last_tx_path = None;
                self.same_path_repeat = 0;
                None
            }
        }
    }
}

pub(super) fn short_sid(sid: &str) -> &str {
    sid.get(..8).unwrap_or(sid)
}

fn short_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.get(..8).unwrap_or(s).to_string())
        .unwrap_or_else(|| "?".to_string())
}

pub(super) fn record_event_diag(
    timing: Option<&Mutex<EventTiming>>,
    path_history: &Mutex<PathHistory>,
    source: &'static str,
    sid: &str,
    total: Duration,
    outcome: TxOutcome,
    tx_path: Option<&str>,
) {
    if !cfg!(debug_assertions) {
        return;
    }

    let dt_label = match timing {
        Some(t) => {
            let now = Instant::now();
            let mut t = t.lock().expect("watcher timing lock");
            let dt = t
                .last_event_at
                .map(|prev| now.duration_since(prev))
                .unwrap_or(Duration::ZERO);
            t.last_event_at = Some(now);
            format!("dt={}ms", dt.as_millis())
        }
        None => "dt=n/a".to_string(),
    };

    let (path_change, repeat) = {
        let mut h = path_history.lock().expect("watcher path-history lock");
        let path_change = h.observe(tx_path);
        (path_change, h.same_path_repeat)
    };

    if let Some(old) = path_change {
        log::info!(
            "watcher.tx_path_change session={} from={} to={}",
            short_sid(sid),
            short_path(&old),
            tx_path.map(short_path).unwrap_or_else(|| "(none)".into()),
        );
    }

    let total_ms = total.as_millis();
    let tx_path_short = tx_path.map(short_path).unwrap_or_else(|| "(none)".into());
    if total_ms > 50 {
        log::warn!(
            "watcher.slow_event source={} session={} {} total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt_label,
            total_ms,
            outcome.label(),
            tx_path_short,
            repeat,
        );
    } else {
        log::info!(
            "watcher.event source={} session={} {} total={}ms tx_status={} tx_path={} repeat={}",
            source,
            short_sid(sid),
            dt_label,
            total_ms,
            outcome.label(),
            tx_path_short,
            repeat,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_history_first_observation_sets_path_and_repeat_1() {
        let mut h = PathHistory::default();
        let r = h.observe(Some("path-a"));
        assert!(
            r.is_none(),
            "first observation must not report a path change"
        );
        assert_eq!(h.last_tx_path.as_deref(), Some("path-a"));
        assert_eq!(h.same_path_repeat, 1);
    }

    #[test]
    fn path_history_repeat_increments_on_same_path() {
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(Some("path-a"));
        assert!(
            r.is_none(),
            "same-path observation must not report a path change"
        );
        assert_eq!(h.same_path_repeat, 3);
    }

    #[test]
    fn path_history_path_change_returns_old_and_resets_repeat() {
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(Some("path-b"));
        assert_eq!(
            r.as_deref(),
            Some("path-a"),
            "path change must return the previous value"
        );
        assert_eq!(h.last_tx_path.as_deref(), Some("path-b"));
        assert_eq!(
            h.same_path_repeat, 1,
            "streak counter resets to 1 on a fresh path"
        );
    }

    #[test]
    fn path_history_no_path_resets_streak_after_repeat() {
        let mut h = PathHistory::default();
        h.observe(Some("path-a"));
        h.observe(Some("path-a"));
        assert_eq!(h.same_path_repeat, 2);

        let r = h.observe(None);
        assert!(r.is_none());
        assert_eq!(h.last_tx_path, None, "no-path must clear the path cache");
        assert_eq!(h.same_path_repeat, 0, "no-path must reset the streak");

        let r = h.observe(Some("path-a"));
        assert!(
            r.is_none(),
            "the next path-bearing event after a no-path is treated as fresh"
        );
        assert_eq!(h.same_path_repeat, 1, "streak starts at 1, not 3");
    }

    #[test]
    fn path_history_no_path_when_already_no_path_is_idempotent() {
        let mut h = PathHistory::default();
        let r = h.observe(None);
        assert!(r.is_none());
        assert_eq!(h.last_tx_path, None);
        assert_eq!(h.same_path_repeat, 0);
    }

    #[test]
    fn short_sid_truncates_long_to_8_chars() {
        assert_eq!(short_sid("abcdefghijklmnop"), "abcdefgh");
    }

    #[test]
    fn short_sid_returns_input_unchanged_when_short() {
        assert_eq!(short_sid("abc"), "abc");
        assert_eq!(short_sid(""), "");
    }

    #[test]
    fn short_sid_handles_uuid_form() {
        assert_eq!(
            short_sid("ddb8d9f1-30b1-43dc-a1a2-405aaaf95e14"),
            "ddb8d9f1"
        );
    }

    #[test]
    fn short_path_extracts_basename_without_extension() {
        assert_eq!(
            short_path("/home/x/projects/abcdefghijklm.jsonl"),
            "abcdefgh"
        );
        assert_eq!(short_path("/x/y/short.jsonl"), "short");
    }

    #[test]
    fn short_path_handles_input_without_directory() {
        assert_eq!(short_path("nofileonly.jsonl"), "nofileon");
    }

    #[test]
    fn short_path_returns_question_mark_when_no_basename() {
        assert_eq!(short_path("/"), "?");
    }

    #[test]
    fn tx_outcome_label_covers_every_variant() {
        assert_eq!(TxOutcome::Started.label(), "started");
        assert_eq!(TxOutcome::Replaced.label(), "replaced");
        assert_eq!(TxOutcome::AlreadyRunning.label(), "already_running");
        assert_eq!(TxOutcome::Missing.label(), "missing");
        assert_eq!(TxOutcome::OutsidePath.label(), "outside_path");
        assert_eq!(TxOutcome::NotFile.label(), "not_file");
        assert_eq!(TxOutcome::StartFailed.label(), "start_failed");
        assert_eq!(TxOutcome::NoPath.label(), "no_path");
        assert_eq!(TxOutcome::ParseError.label(), "parse_error");
    }
}
