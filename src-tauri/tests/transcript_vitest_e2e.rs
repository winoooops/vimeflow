//! End-to-end test: feed a fixture transcript through the parser
//! and assert exactly one test-run event is emitted with the expected
//! summary counts.

use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn vitest_pass_fixture_emits_one_test_run() {
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
        .join("tests/fixtures/transcript_vitest_pass.jsonl");

    // Pass a valid cwd — process_tool_result skips test-run snapshots
    // when cwd is None to avoid resolving file groups against the wrong
    // directory. The fixture has no per-file rows so a temp cwd is fine.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            app_handle,
            "session-fixture".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    // Wait briefly for the tail loop to process the file.
    std::thread::sleep(std::time::Duration::from_millis(1500));
    state.stop("session-fixture").ok();

    let events = received.lock().unwrap();
    assert_eq!(events.len(), 1, "expected exactly one test-run event");
    let payload = &events[0];
    assert!(payload.contains(r#""runner":"vitest""#));
    assert!(payload.contains(r#""passed":3"#));
    assert!(payload.contains(r#""total":3"#));
    assert!(payload.contains(r#""status":"pass""#));
}
