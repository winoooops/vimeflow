//! Replay batching: feed a fixture transcript with three historical
//! vitest runs through the parser and assert that the TestRunEmitter
//! collapses them to exactly ONE emit (the latest, with passed=3) at
//! first EOF. Locks the load-bearing invariant for session-restore UX.

use std::sync::Arc;

mod support;

use support::RecordingEventSink;
use vimeflow_lib::agent::adapter::base::TranscriptState;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;
use vimeflow_lib::agent::adapter::AgentAdapter;

#[test]
fn replay_emits_only_latest_snapshot() {
    let sink = RecordingEventSink::new();

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_replay.jsonl");

    // Pass a valid cwd — process_tool_result skips test-run snapshots
    // when cwd is None (avoids resolving file groups against the wrong
    // directory). Replay-batching behaviour is independent of cwd.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            adapter,
            sink.clone(),
            "session-replay".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-replay").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "test-run")
        .collect();
    // 3 historical runs in the fixture, but replay batching collapses to 1 emit
    // containing the LATEST run (passed=3).
    assert_eq!(events.len(), 1, "expected exactly one emit after replay");
    assert_eq!(events[0].1["summary"]["passed"], 3);
}
