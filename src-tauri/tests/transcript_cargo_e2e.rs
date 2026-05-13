use std::sync::Arc;

mod support;

use support::RecordingEventSink;
use vimeflow_lib::agent::adapter::base::TranscriptState;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;
use vimeflow_lib::agent::adapter::AgentAdapter;

#[test]
fn cargo_mixed_fixture_emits_test_run_with_groups() {
    let sink = RecordingEventSink::new();

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_cargo_mixed.jsonl");

    // Pass a valid cwd — process_tool_result skips the snapshot entirely
    // when cwd is None (so it doesn't resolve test files against the
    // wrong directory). A temp dir is enough; cargo groups always have
    // path: None regardless of cwd, so the rest of the assertions hold.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            adapter,
            sink.clone(),
            "session-cargo".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-cargo").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "test-run")
        .collect();
    assert_eq!(events.len(), 1);
    let payload = &events[0].1;
    assert_eq!(payload["runner"], "cargo");
    assert_eq!(payload["summary"]["passed"], 1);
    assert_eq!(payload["summary"]["failed"], 1);
    assert_eq!(payload["summary"]["skipped"], 1);
    assert_eq!(payload["status"], "fail");
    assert!(payload["summary"]["groups"]
        .to_string()
        .contains(r#""kind":"module""#));
    assert!(payload["summary"]["groups"]
        .to_string()
        .contains(r#""path":null"#));
}
