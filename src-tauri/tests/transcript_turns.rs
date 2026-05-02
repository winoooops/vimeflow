use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use vimeflow_lib::agent::transcript::TranscriptState;

#[test]
fn transcript_emits_turn_events_for_real_user_prompts_only() {
    use tauri::test::mock_builder;
    use tauri::Listener;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    // Channel signals when the expected event count (2) lands so the test
    // doesn't rely on a fixed sleep — flaky on loaded CI runners where the
    // watcher thread can miss a millisecond budget.
    let (tx, rx) = mpsc::channel::<()>();
    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    let tx_clone = tx.clone();
    app_handle.listen("agent-turn", move |event| {
        let mut events = recv_clone.lock().unwrap();
        events.push(event.payload().to_string());
        if events.len() >= 2 {
            let _ = tx_clone.send(());
        }
    });
    drop(tx);

    let tmp = tempfile::tempdir().expect("temp transcript dir");
    let transcript_path = tmp.path().join("turns.jsonl");
    std::fs::write(
        &transcript_path,
        concat!(
            r#"{"type":"user","timestamp":"2026-04-28T11:00:00.000Z","message":{"content":"first prompt"}}"#,
            "\n",
            r#"{"type":"assistant","timestamp":"2026-04-28T11:00:01.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"src/App.tsx"}}]}}"#,
            "\n",
            r#"{"type":"user","timestamp":"2026-04-28T11:00:02.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","is_error":false,"content":"ok"}]}}"#,
            "\n",
            r#"{"type":"user","timestamp":"2026-04-28T11:00:03.000Z","message":{"content":[{"type":"text","text":"second prompt"}]}}"#,
            "\n",
        ),
    )
    .expect("write transcript fixture");

    let state = TranscriptState::new();
    state
        .start_or_replace(
            app_handle,
            "session-turns".to_string(),
            transcript_path,
            None,
        )
        .expect("start watcher");

    rx.recv_timeout(std::time::Duration::from_secs(5))
        .expect("timed out waiting for turn events");
    state.stop("session-turns").ok();

    let events = received.lock().unwrap();
    assert_eq!(events.len(), 2, "expected one event per real user prompt");
    assert!(events[0].contains(r#""numTurns":1"#));
    assert!(events[1].contains(r#""numTurns":2"#));
}
