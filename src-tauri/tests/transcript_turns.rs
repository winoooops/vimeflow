use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use tauri::test::MockRuntime;
use vimeflow_lib::agent::adapter::AgentAdapter;
use vimeflow_lib::agent::adapter::base::TranscriptState;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;

#[test]
fn transcript_emits_turn_events_for_real_user_prompts_only() {
    use tauri::Listener;
    use tauri::test::mock_builder;

    let app = mock_builder().build(tauri::generate_context!()).unwrap();
    let app_handle = app.handle().clone();

    // Channel signals when the expected event count (3) lands so the test
    // doesn't rely on a fixed sleep — flaky on loaded CI runners where the
    // watcher thread can miss a millisecond budget.
    let (tx, rx) = mpsc::channel::<()>();
    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recv_clone = received.clone();
    let tx_clone = tx.clone();
    app_handle.listen("agent-turn", move |event| {
        let mut events = recv_clone.lock().unwrap();
        events.push(event.payload().to_string());
        if events.len() >= 3 {
            let _ = tx_clone.send(());
        }
    });
    drop(tx);

    let tmp = tempfile::tempdir().expect("temp transcript dir");
    let transcript_path = tmp.path().join("turns.jsonl");
    // Six-line fixture covers five message shapes:
    //   1. plain-string user prompt   → emits turn 1
    //   2. assistant tool_use         → no event
    //   3. user array of tool_result  → no event (tool return, not a prompt)
    //   4. user array of text block   → emits turn 2
    //   5. assistant tool_use         → no event (seeds in_flight for #6)
    //   6. user array mixing tool_result + text (mixed content) → emits turn 3
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
            r#"{"type":"assistant","timestamp":"2026-04-28T11:00:04.000Z","message":{"content":[{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"src/App.tsx"}}]}}"#,
            "\n",
            r#"{"type":"user","timestamp":"2026-04-28T11:00:05.000Z","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_2","is_error":false,"content":"ok"},{"type":"text","text":"follow-up"}]}}"#,
            "\n",
        ),
    )
    .expect("write transcript fixture");

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter<MockRuntime>> = Arc::new(ClaudeCodeAdapter);
    state
        .start_or_replace(
            adapter,
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
    assert_eq!(events.len(), 3, "expected one event per real user prompt");
    assert!(events[0].contains(r#""numTurns":1"#));
    assert!(events[1].contains(r#""numTurns":2"#));
    // Mixed-content block (tool_result + text) is still a real prompt — the
    // text portion has non-whitespace content so it should emit a turn.
    assert!(events[2].contains(r#""numTurns":3"#));
}
