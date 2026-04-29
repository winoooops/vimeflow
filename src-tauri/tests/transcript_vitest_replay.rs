//! Replay batching: feed a fixture transcript with three historical
//! vitest runs through the parser and assert that the TestRunEmitter
//! collapses them to exactly ONE emit (the latest, with passed=3) at
//! first EOF. Locks the load-bearing invariant for session-restore UX.

use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn replay_emits_only_latest_snapshot() {
    use tauri::test::mock_builder;
    use tauri::Listener;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    app_handle.listen("test-run", move |event| {
        recv_clone.lock().unwrap().push(event.payload().to_string());
    });

    let state = TranscriptState::new();
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_replay.jsonl");

    // Pass a valid cwd — process_tool_result skips test-run snapshots
    // when cwd is None (avoids resolving file groups against the wrong
    // directory). Replay-batching behaviour is independent of cwd.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            app_handle,
            "session-replay".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-replay").ok();

    let events = received.lock().unwrap();
    // 3 historical runs in the fixture, but replay batching collapses to 1 emit
    // containing the LATEST run (passed=3).
    assert_eq!(events.len(), 1, "expected exactly one emit after replay");
    assert!(events[0].contains(r#""passed":3"#));
}
