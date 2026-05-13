use std::sync::Arc;
use std::time::Duration;

use crate::agent::adapter::base::TranscriptState;
use crate::agent::adapter::claude_code::ClaudeCodeAdapter;
use crate::agent::adapter::AgentAdapter;
use crate::runtime::FakeEventSink;

#[test]
fn transcript_emits_turn_events_for_real_user_prompts_only() {
    let sink = Arc::new(FakeEventSink::new());

    let tmp = tempfile::tempdir().expect("temp transcript dir");
    let transcript_path = tmp.path().join("turns.jsonl");
    // Six-line fixture covers five message shapes:
    //   1. plain-string user prompt   -> emits turn 1
    //   2. assistant tool_use         -> no event
    //   3. user array of tool_result  -> no event (tool return, not a prompt)
    //   4. user array of text block   -> emits turn 2
    //   5. assistant tool_use         -> no event (seeds in_flight for #6)
    //   6. user array mixing tool_result + text (mixed content) -> emits turn 3
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

    assert!(
        sink.wait_for_count("agent-turn", 3, Duration::from_secs(5)),
        "expected one event per real user prompt",
    );
    state.stop("session-turns").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "agent-turn")
        .collect();
    assert_eq!(events.len(), 3, "expected one event per real user prompt");
    assert_eq!(events[0].1["numTurns"], 1);
    assert_eq!(events[1].1["numTurns"], 2);
    // Mixed-content block (tool_result + text) is still a real prompt: the
    // text portion has non-whitespace content so it should emit a turn.
    assert_eq!(events[2].1["numTurns"], 3);
}

#[test]
fn vitest_pass_fixture_emits_one_test_run() {
    let sink = Arc::new(FakeEventSink::new());

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_pass.jsonl");

    // Pass a valid cwd: process_tool_result skips test-run snapshots when cwd
    // is None to avoid resolving file groups against the wrong directory. The
    // fixture has no per-file rows so a temp cwd is fine.
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

    assert!(
        sink.wait_for_count("test-run", 1, Duration::from_secs(5)),
        "expected exactly one test-run event",
    );
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

#[test]
fn cargo_mixed_fixture_emits_test_run_with_groups() {
    let sink = Arc::new(FakeEventSink::new());

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_cargo_mixed.jsonl");

    // Pass a valid cwd: process_tool_result skips the snapshot entirely when
    // cwd is None. A temp dir is enough; cargo groups always have path: None,
    // so the rest of the assertions hold.
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

    assert!(
        sink.wait_for_count("test-run", 1, Duration::from_secs(5)),
        "expected exactly one test-run event",
    );
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

#[test]
fn replay_emits_only_latest_snapshot() {
    let sink = Arc::new(FakeEventSink::new());

    let state = TranscriptState::new();
    let adapter: Arc<dyn AgentAdapter> = Arc::new(ClaudeCodeAdapter);
    let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/transcript_vitest_replay.jsonl");

    // Pass a valid cwd: process_tool_result skips test-run snapshots when cwd
    // is None. Replay-batching behaviour is independent of cwd.
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

    assert!(
        sink.wait_for_count("test-run", 1, Duration::from_secs(5)),
        "expected exactly one test-run event",
    );
    state.stop("session-replay").ok();

    let events: Vec<_> = sink
        .recorded()
        .into_iter()
        .filter(|(event, _)| event == "test-run")
        .collect();
    // 3 historical runs in the fixture, but replay batching collapses to 1
    // emit containing the latest run (passed=3).
    assert_eq!(events.len(), 1, "expected exactly one emit after replay");
    assert_eq!(events[0].1["summary"]["passed"], 3);
}
