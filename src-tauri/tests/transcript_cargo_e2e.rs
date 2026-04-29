use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn cargo_mixed_fixture_emits_test_run_with_groups() {
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
        .join("tests/fixtures/transcript_cargo_mixed.jsonl");

    // Pass a valid cwd — process_tool_result skips the snapshot entirely
    // when cwd is None (so it doesn't resolve test files against the
    // wrong directory). A temp dir is enough; cargo groups always have
    // path: None regardless of cwd, so the rest of the assertions hold.
    let cwd = tempfile::tempdir().expect("temp cwd");

    state
        .start_or_replace(
            app_handle,
            "session-cargo".to_string(),
            fixture_path,
            Some(cwd.path().to_path_buf()),
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(2000));
    state.stop("session-cargo").ok();

    let events = received.lock().unwrap();
    assert_eq!(events.len(), 1);
    let payload = &events[0];
    assert!(payload.contains(r#""runner":"cargo""#));
    assert!(payload.contains(r#""passed":1"#));
    assert!(payload.contains(r#""failed":1"#));
    assert!(payload.contains(r#""skipped":1"#));
    assert!(payload.contains(r#""status":"fail""#));
    assert!(payload.contains(r#""kind":"module""#));
    assert!(payload.contains(r#""path":null"#));
}
