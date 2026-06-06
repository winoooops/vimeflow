//! Live "running" cue for scratch (ephemeral) terminals (VIM-71).
//!
//! A scratch shell's pane-header button should light only when a *foreground
//! command* is actually executing — not merely because a shell exists. The
//! signal is the PTY's foreground process group
//! (`MasterPty::process_group_leader`) differing from the shell's own pid (see
//! `state::is_foreground_busy`). That transition emits no OS event, so a
//! periodic poll diffs the per-session state and emits `scratch-foreground`
//! only when it flips.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::runtime::EventSink;

use super::events::emit_scratch_foreground;
use super::state::PtyState;
use super::types::{ScratchForegroundEvent, SessionId};

/// How often the foreground poll samples each scratch PTY. Fast enough for a
/// responsive cue, slow enough to stay negligible (one syscall per scratch
/// shell, at most a handful per session).
const POLL_INTERVAL: Duration = Duration::from_millis(750);

/// Sessions whose running-state differs from `prev`, paired with the new value
/// — the transitions worth emitting. An id absent from `prev` reads as
/// not-running, so idle shells (the common case) stay quiet; only a real
/// flip emits.
pub(crate) fn foreground_changes(
    prev: &HashMap<SessionId, bool>,
    now: &[(SessionId, bool)],
) -> Vec<(SessionId, bool)> {
    now.iter()
        .filter(|(id, running)| prev.get(id).copied().unwrap_or(false) != *running)
        .map(|(id, running)| (id.clone(), *running))
        .collect()
}

/// One poll iteration: snapshot every scratch PTY's foreground state, emit a
/// `scratch-foreground` event for each session that changed since `prev`, and
/// return the fresh state map. The map is rebuilt from the live snapshot, so a
/// closed scratch's id drops out rather than lingering.
pub(crate) fn poll_foreground_once(
    pty: &PtyState,
    events: &dyn EventSink,
    prev: &HashMap<SessionId, bool>,
) -> HashMap<SessionId, bool> {
    let now = pty.ephemeral_foreground_snapshot();
    for (session_id, running) in foreground_changes(prev, &now) {
        let _ = emit_scratch_foreground(events, &ScratchForegroundEvent { session_id, running });
    }
    now.into_iter().collect()
}

/// Poll the scratch PTYs forever, emitting `scratch-foreground` on every
/// running-state transition. Spawned once at startup; runs until the runtime
/// shuts down.
pub(crate) async fn foreground_poll_loop(pty: PtyState, events: Arc<dyn EventSink>) {
    let mut prev: HashMap<SessionId, bool> = HashMap::new();
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    loop {
        interval.tick().await;
        prev = poll_foreground_once(&pty, events.as_ref(), &prev);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::FakeEventSink;

    fn map(entries: &[(&str, bool)]) -> HashMap<SessionId, bool> {
        entries
            .iter()
            .map(|(id, running)| ((*id).to_string(), *running))
            .collect()
    }

    #[test]
    fn foreground_changes_emits_a_newly_running_shell() {
        let prev = HashMap::new();
        let now = vec![("s1".to_string(), true)];

        assert_eq!(
            foreground_changes(&prev, &now),
            vec![("s1".to_string(), true)]
        );
    }

    #[test]
    fn foreground_changes_stays_quiet_for_an_idle_shell() {
        // Absent in prev == not-running, so an idle (false) shell is no change.
        let prev = HashMap::new();
        let now = vec![("s1".to_string(), false)];

        assert!(foreground_changes(&prev, &now).is_empty());
    }

    #[test]
    fn foreground_changes_emits_when_a_command_finishes() {
        let prev = map(&[("s1", true)]);
        let now = vec![("s1".to_string(), false)];

        assert_eq!(
            foreground_changes(&prev, &now),
            vec![("s1".to_string(), false)]
        );
    }

    #[test]
    fn foreground_changes_skips_an_unchanged_running_shell() {
        let prev = map(&[("s1", true)]);
        let now = vec![("s1".to_string(), true)];

        assert!(foreground_changes(&prev, &now).is_empty());
    }

    #[test]
    fn poll_foreground_once_on_empty_state_emits_nothing() {
        let pty = PtyState::new();
        let sink = FakeEventSink::new();

        let next = poll_foreground_once(&pty, &sink, &HashMap::new());

        assert!(next.is_empty());
        assert_eq!(sink.count("scratch-foreground"), 0);
    }

    #[test]
    fn emit_scratch_foreground_uses_the_scratch_foreground_channel() {
        let sink = FakeEventSink::new();

        emit_scratch_foreground(
            &sink,
            &ScratchForegroundEvent {
                session_id: "s1".into(),
                running: true,
            },
        )
        .expect("emit");

        let recorded = sink.recorded();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "scratch-foreground");
        assert_eq!(recorded[0].1["sessionId"], serde_json::json!("s1"));
        assert_eq!(recorded[0].1["running"], serde_json::json!(true));
    }
}
