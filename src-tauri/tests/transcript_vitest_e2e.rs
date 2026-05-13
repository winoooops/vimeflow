//! End-to-end test: feed a fixture transcript through the parser
//! and assert exactly one test-run event is emitted with the expected
//! summary counts.

use std::sync::Arc;

mod support;

use support::RecordingEventSink;
use vimeflow_lib::agent::adapter::base::TranscriptState;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;
use vimeflow_lib::agent::adapter::AgentAdapter;

#[test]
fn vitest_pass_fixture_emits_one_test_run() {
    let sink = RecordingEventSink::new();

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_pass.jsonl");

    // Pass a valid cwd — process_tool_result skips test-run snapshots
    // when cwd is None to avoid resolving file groups against the wrong
    // directory. The fixture has no per-file rows so a temp cwd is fine.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            adapter,
            sink.clone(),
            "session-fixture".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    // Wait briefly for the tail loop to process the file.
    std::thread::sleep(std::time::Duration::from_millis(1500));
    state.stop("session-fixture").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "test-run")
        .collect();
    assert_eq!(events.len(), 1, "expected exactly one test-run event");
    let payload = &events[0].1;
    assert_eq!(payload["runner"], "vitest");
    assert_eq!(payload["summary"]["passed"], 3);
    assert_eq!(payload["summary"]["total"], 3);
    assert_eq!(payload["status"], "pass");
}
