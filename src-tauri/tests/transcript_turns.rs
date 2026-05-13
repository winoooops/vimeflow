use std::sync::Arc;

mod support;

use support::RecordingEventSink;
use vimeflow_lib::agent::adapter::base::TranscriptState;
use vimeflow_lib::agent::adapter::claude_code::ClaudeCodeAdapter;
use vimeflow_lib::agent::adapter::AgentAdapter;

#[test]
fn transcript_emits_turn_events_for_real_user_prompts_only() {
    let sink = RecordingEventSink::new();

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
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    state
        .start_or_replace(
            adapter,
            sink.clone(),
            "session-turns".to_string(),
            transcript_path,
            None,
        )
        .expect("start watcher");

    std::thread::sleep(std::time::Duration::from_millis(1500));
    state.stop("session-turns").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "agent-turn")
        .collect();
    assert_eq!(events.len(), 3, "expected one event per real user prompt");
    assert_eq!(events[0].1["numTurns"], 1);
    assert_eq!(events[1].1["numTurns"], 2);
    // Mixed-content block (tool_result + text) is still a real prompt — the
    // text portion has non-whitespace content so it should emit a turn.
    assert_eq!(events[2].1["numTurns"], 3);
}
