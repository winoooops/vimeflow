# Codex Transcript Cwd Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port PR #239's `agent-cwd` extraction to the Codex transcript watcher so Codex panes get the same structured cwd channel Claude Code panes have, with the per-turn temporal contract documented in the spec.

**Architecture:** Add a private `extract_session_cwd` helper to `codex/transcript.rs`. Thread `last_cwd: Option<String>` through the `tail_loop` and `process_line`. Pre-match cwd extraction emits `AgentCwdEvent` on transitions only. Update doc-comments + regenerate ts-rs binding. Update two frontend JSDoc blocks.

**Tech Stack:** Rust (backend, `crates/backend`), `serde_json::Value`, `ts-rs` (binding regen), TypeScript (frontend doc-comments only).

**Reference spec:** [`docs/superpowers/specs/2026-05-22-codex-transcript-cwd-parser-design.md`](../specs/2026-05-22-codex-transcript-cwd-parser-design.md) (codex-reviewed, 4 review passes).

---

## File Structure

- **Modify** `crates/backend/src/agent/adapter/codex/transcript.rs` — add `extract_session_cwd` helper, `last_cwd` state in `tail_loop`, `last_cwd` parameter on `process_line`, pre-match emission, two new imports, 11 new tests (7 helper + 3 transition + 1 e2e).
- **Modify** `crates/backend/src/agent/types.rs` — update `AgentCwdEvent` doc comment (lines 157–164) to describe both adapters' real shapes; drop "pending follow-up" / "every transcript JSONL entry".
- **Regenerate** `src/bindings/AgentCwdEvent.ts` — via `npm run generate:bindings` (runs `cargo test ... export_bindings && prettier --write src/bindings/`). Not hand-edited.
- **Modify** `src/features/agent-status/types/index.ts` — JSDoc block above `cwd: string | null` field (lines 54–62) to drop "every transcript JSONL entry (Claude Code today; Codex follow-up)" and describe both adapters.
- **Modify** `src/features/workspace/WorkspaceView.tsx` — comment block above `agentStatus.cwd → updatePaneCwd` bridge (lines 315–321), same correction.

No new files. No new fixture files — tests use inline `json!()` values per the codebase convention in `codex/transcript.rs::start_tailing_replays_tool_calls_turns_and_test_runs` (around line 791).

---

## Task 1: Add `extract_session_cwd` helper with unit tests

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` — add helper near top (above `validate_transcript_path`, around line 47), add 7 unit tests inside existing `#[cfg(test)] mod tests` block (at end of file, around line 736+).

### Step 1: Write the failing tests

- [ ] **Step 1: Add 7 unit tests at the bottom of the existing `#[cfg(test)] mod tests` block in `crates/backend/src/agent/adapter/codex/transcript.rs`** (just before the closing `}` of the module).

```rust
    // ---- extract_session_cwd unit tests (added by codex-transcript-cwd PR) ----

    #[test]
    fn extract_session_cwd_session_meta_returns_cwd() {
        let v = json!({"type": "session_meta", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), Some("/workspace/A"));
    }

    #[test]
    fn extract_session_cwd_turn_context_returns_cwd() {
        let v = json!({"type": "turn_context", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), Some("/workspace/A"));
    }

    #[test]
    fn extract_session_cwd_event_msg_returns_none() {
        // Defensive: even if a future schema put `cwd` in event_msg.payload,
        // the type gate rejects it. Session cwd only lives on session_meta
        // + turn_context as of cli_version 0.132.0.
        let v = json!({"type": "event_msg", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_response_item_returns_none() {
        // function_call arguments.workdir is per-command scratch, NOT
        // session cwd. The type gate rejects response_item entirely.
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "arguments": "{\"workdir\":\"/workspace/A\"}"
            }
        });
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_missing_payload_returns_none() {
        let v = json!({"type": "turn_context"});
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_missing_cwd_returns_none() {
        let v = json!({"type": "turn_context", "payload": {}});
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_empty_string_returns_none() {
        let v = json!({"type": "turn_context", "payload": {"cwd": ""}});
        assert_eq!(extract_session_cwd(&v), None);
    }
```

> **Note:** `serde_json::json` is already imported in the test module's `use serde_json::json;` line (around line 740 in the file).

- [ ] **Step 2: Run the tests to verify they fail with a compile error**

Run: `cargo test -p vimeflow --lib extract_session_cwd`

> **Important — exit-code handling for all `Run:` commands in this plan:**
> Do NOT pipe these commands through `| tail` or `| head`. In bash a piped
> command's exit code is the exit code of the LAST stage; `tail`'s exit
> code masks a failing `cargo test` / `npm test` / `npm run type-check`
> and the executing agent will read the run as a pass. If output volume
> is a concern, use `2>&1 | tee /tmp/<name>.log` or check
> `${PIPESTATUS[0]}` explicitly. The expected-output blocks below show
> what the relevant summary line looks like — verify it actually appears
> in the unfiltered output before continuing.

Expected: `error[E0425]: cannot find function 'extract_session_cwd'` (red — the helper doesn't exist yet).

- [ ] **Step 3: Add the `extract_session_cwd` helper near the top of `crates/backend/src/agent/adapter/codex/transcript.rs`**

Insert this function immediately above the existing `pub(super) fn validate_transcript_path` (around line 47). Place it after the `type InFlightToolCalls = HashMap<…>;` declaration (around line 45).

```rust
/// Pull session-level cwd off a Codex rollout JSONL line.
///
/// Returns `Some(cwd)` only for the two event types that actually carry
/// session cwd in the rollout schema as of `cli_version 0.132.0`:
///   - `session_meta.payload.cwd` — fires once at session start.
///   - `turn_context.payload.cwd` — fires per turn.
///
/// Empty strings are filtered out at the extraction site, matching the
/// Claude Code transcript watcher's guard. Function-call
/// `arguments.workdir` is per-command scratch and deliberately not
/// considered session cwd.
fn extract_session_cwd(value: &Value) -> Option<&str> {
    let event_type = value.get("type").and_then(Value::as_str)?;
    if event_type != "session_meta" && event_type != "turn_context" {
        return None;
    }
    value
        .get("payload")?
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p vimeflow --lib extract_session_cwd`

Expected: `test result: ok. 7 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "$(cat <<'EOF'
test(agent): add extract_session_cwd helper for codex rollouts

Pure extraction helper scoped to session_meta + turn_context — the only
two event types in the Codex rollout JSONL schema (cli_version 0.132.0)
that carry session-level cwd. Seven unit tests cover the happy paths,
the type-gate rejections, and the missing-field / empty-string guards.

The helper is dead-code until Task 2 wires it into process_line; the
function is not marked #[allow(dead_code)] because the unit tests count
as uses for the dead-code lint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire emission into `tail_loop` + `process_line`, with transition tests + e2e

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs`
  - Add 2 new `use` lines at the top (around line 21–23).
  - Add `let mut last_cwd: Option<String> = None;` in `tail_loop` (around line 141).
  - Extend `process_line` signature with `last_cwd: &mut Option<String>` (around line 195).
  - Add cwd extraction + emission in `process_line` body (after the `match serde_json::from_str` early-return, before the existing `match value.get("type")...`).
  - Update both `process_line(...)` call sites in `tail_loop` (around lines 159 and 177) to pass `&mut last_cwd`.
  - Add 3 transition-semantics unit tests + 1 e2e test in the existing `mod tests` block.

### Step 1: Write the failing tests

- [ ] **Step 1: Add 3 transition tests + 1 e2e test at the bottom of `mod tests` in the same file, just after the 7 helper tests from Task 1.**

```rust
    // ---- process_line transition-semantics tests ----

    fn empty_in_flight() -> InFlightToolCalls {
        HashMap::new()
    }

    #[test]
    fn process_line_first_cwd_always_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let line = r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#;
        process_line(
            line,
            "sid-1",
            None,
            &events,
            &mut emitter,
            &mut in_flight,
            &mut num_turns,
            &mut last_cwd,
        );

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 1);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(last_cwd.as_deref(), Some("/workspace/A"));
    }

    #[test]
    fn process_line_repeated_cwd_suppresses() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"turn_context","payload":{"turn_id":"t2","cwd":"/workspace/A"}}"#,
        ];
        for line in lines {
            process_line(
                line,
                "sid-1",
                None,
                &events,
                &mut emitter,
                &mut in_flight,
                &mut num_turns,
                &mut last_cwd,
            );
        }

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 1);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
    }

    #[test]
    fn process_line_cwd_transition_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/B"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"turn_context","payload":{"turn_id":"t2","cwd":"/workspace/A"}}"#,
        ];
        for line in lines {
            process_line(
                line,
                "sid-1",
                None,
                &events,
                &mut emitter,
                &mut in_flight,
                &mut num_turns,
                &mut last_cwd,
            );
        }

        let cwd_events: Vec<_> = sink
            .recorded()
            .into_iter()
            .filter(|(name, _)| name == "agent-cwd")
            .collect();
        assert_eq!(cwd_events.len(), 3);
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1].1["cwd"], "/workspace/B");
        assert_eq!(cwd_events[2].1["cwd"], "/workspace/A");
        for (_name, payload) in &cwd_events {
            assert_eq!(payload["sessionId"], "sid-1");
        }
    }

    // ---- end-to-end watcher test ----

    #[test]
    fn start_tailing_emits_cwd_transitions_in_order() {
        let sink = Arc::new(FakeEventSink::new());

        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("rollout.jsonl");

        // 6 lines, 3 expected emissions:
        //   1. session_meta cwd=/workspace/A   (emit)
        //   2. turn_context cwd=/workspace/A   (suppressed)
        //   3. turn_context cwd=/workspace/B   (emit)
        //   4. event_msg noise                 (no cwd emit)
        //   5. response_item noise             (no cwd emit)
        //   6. turn_context cwd=/workspace/A   (emit)
        write_rollout(
            &transcript_path,
            &[
                json!({
                    "timestamp": "2026-05-22T10:00:00Z",
                    "type": "session_meta",
                    "payload": { "id": "sid-cwd", "cwd": "/workspace/A" }
                }),
                json!({
                    "timestamp": "2026-05-22T10:00:01Z",
                    "type": "turn_context",
                    "payload": { "turn_id": "t1", "cwd": "/workspace/A" }
                }),
                json!({
                    "timestamp": "2026-05-22T10:00:02Z",
                    "type": "turn_context",
                    "payload": { "turn_id": "t2", "cwd": "/workspace/B" }
                }),
                json!({
                    "timestamp": "2026-05-22T10:00:03Z",
                    "type": "event_msg",
                    "payload": { "type": "task_started" }
                }),
                json!({
                    "timestamp": "2026-05-22T10:00:04Z",
                    "type": "response_item",
                    "payload": { "type": "function_call", "call_id": "c1", "name": "noop", "arguments": "{}" }
                }),
                json!({
                    "timestamp": "2026-05-22T10:00:05Z",
                    "type": "turn_context",
                    "payload": { "turn_id": "t3", "cwd": "/workspace/A" }
                }),
            ],
        );

        let handle = start_tailing(
            sink.clone(),
            "sid-cwd".to_string(),
            transcript_path,
            None,
        )
        .expect("start tailing");

        std::thread::sleep(Duration::from_millis(750));
        handle.stop();
        std::thread::sleep(Duration::from_millis(100));

        let cwd_events: Vec<Value> = sink
            .recorded()
            .into_iter()
            .filter(|(event, _)| event == "agent-cwd")
            .map(|(_, payload)| payload)
            .collect();

        assert_eq!(cwd_events.len(), 3, "expected exactly 3 cwd transitions");
        assert_eq!(cwd_events[0]["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1]["cwd"], "/workspace/B");
        assert_eq!(cwd_events[2]["cwd"], "/workspace/A");
        for ev in &cwd_events {
            assert_eq!(ev["sessionId"], "sid-cwd");
        }
    }
```

> **Note:** `write_rollout`, `FakeEventSink`, `Arc`, `Duration`, `json!`, `Value`, and `tempfile` are all already imported / in-scope in this `mod tests` block — verify the `use` lines around line 738–740 include `use crate::runtime::FakeEventSink;` and `use serde_json::json;`. If any are missing, add them.

- [ ] **Step 2: Run the new tests to verify they fail with a compile error**

Run: `cargo test -p vimeflow --lib process_line_first_cwd_always_emits`

Expected: compile error — `process_line` only takes 7 args (no `last_cwd`), `extract_session_cwd` is dead-code, no emission code in `process_line`. **Red.**

### Step 2: Wire the implementation

- [ ] **Step 3: Add two new imports at the top of `crates/backend/src/agent/adapter/codex/transcript.rs`**

Find the existing import block (around lines 19–23):

```rust
use crate::agent::adapter::base::TranscriptHandle;
use crate::agent::adapter::claude_code::test_runners::build::{maybe_build_snapshot, BuildArgs};
use crate::agent::adapter::claude_code::test_runners::emitter::TestRunEmitter;
use crate::agent::adapter::claude_code::test_runners::matcher::{match_command, MatchedCommand};
use crate::agent::adapter::claude_code::test_runners::test_file_patterns::is_test_file;
use crate::agent::adapter::claude_code::test_runners::timestamps::compute_duration_ms;
use crate::agent::adapter::claude_code::test_runners::types::CapturedOutput;
use crate::agent::adapter::types::ValidateTranscriptError;
use crate::agent::events::{emit_agent_tool_call, emit_agent_turn};
use crate::agent::types::{AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
use crate::runtime::EventSink;
```

Modify the last two `use crate::agent::*` lines to add `emit_agent_cwd` and `AgentCwdEvent`:

```rust
use crate::agent::events::{emit_agent_cwd, emit_agent_tool_call, emit_agent_turn};
use crate::agent::types::{AgentCwdEvent, AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
```

- [ ] **Step 4: Add `last_cwd` state in `tail_loop`**

Find `fn tail_loop(…)` (around line 130). At the top of the function body, locate this block (around lines 138–141):

```rust
    let mut reader = BufReader::new(file);
    let mut line_buf = String::new();
    let mut partial_line = String::new();
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;
    let mut emitter = TestRunEmitter::new(events.clone());
```

Add `let mut last_cwd: Option<String> = None;` immediately after `let mut num_turns = 0_u32;`:

```rust
    let mut reader = BufReader::new(file);
    let mut line_buf = String::new();
    let mut partial_line = String::new();
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;
    let mut last_cwd: Option<String> = None;
    let mut emitter = TestRunEmitter::new(events.clone());
```

- [ ] **Step 5: Update the partial-line branch's `process_line` call (around lines 158–168)**

Find:

```rust
                if !partial_line.is_empty() {
                    partial_line.push_str(&line_buf);
                    process_line(
                        partial_line.trim_end_matches('\n'),
                        &session_id,
                        cwd.as_deref(),
                        &events,
                        &mut emitter,
                        &mut in_flight,
                        &mut num_turns,
                    );
                    partial_line.clear();
                    continue;
                }
```

Add `&mut last_cwd,` as the final argument:

```rust
                if !partial_line.is_empty() {
                    partial_line.push_str(&line_buf);
                    process_line(
                        partial_line.trim_end_matches('\n'),
                        &session_id,
                        cwd.as_deref(),
                        &events,
                        &mut emitter,
                        &mut in_flight,
                        &mut num_turns,
                        &mut last_cwd,
                    );
                    partial_line.clear();
                    continue;
                }
```

- [ ] **Step 6: Update the single-line branch's `process_line` call (around lines 176–185)**

Find:

```rust
                process_line(
                    line,
                    &session_id,
                    cwd.as_deref(),
                    &events,
                    &mut emitter,
                    &mut in_flight,
                    &mut num_turns,
                );
```

Add `&mut last_cwd,`:

```rust
                process_line(
                    line,
                    &session_id,
                    cwd.as_deref(),
                    &events,
                    &mut emitter,
                    &mut in_flight,
                    &mut num_turns,
                    &mut last_cwd,
                );
```

- [ ] **Step 7: Extend `process_line` signature (around line 195) and add emission body**

Find:

```rust
fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return,
    };

    match value.get("type").and_then(Value::as_str) {
        Some("response_item") => {
```

Replace with:

```rust
fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
    last_cwd: &mut Option<String>,
) {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return,
    };

    // Emit agent-cwd on transitions only. Codex's rollout schema carries
    // session cwd on `session_meta` (once) + `turn_context` (per turn);
    // mid-turn cwd changes are not visible until the next turn boundary
    // (see spec section 3.5).
    if let Some(observed) = extract_session_cwd(&value) {
        if last_cwd.as_deref().map_or(true, |seen| seen != observed) {
            let event = AgentCwdEvent {
                session_id: session_id.to_string(),
                cwd: observed.to_string(),
            };
            if let Err(e) = emit_agent_cwd(events.as_ref(), &event) {
                log::warn!("Failed to emit agent-cwd event: {}", e);
            }
            *last_cwd = Some(observed.to_string());
        }
    }

    match value.get("type").and_then(Value::as_str) {
        Some("response_item") => {
```

- [ ] **Step 8: Run all four new tests to verify they pass**

Run: `cargo test -p vimeflow --lib codex::transcript`

Expected: all 11 new tests in `codex::transcript::tests` pass (7 helper + 3 transition + 1 e2e), plus the existing tests in the module still pass. **Green.**

If `start_tailing_emits_cwd_transitions_in_order` is flaky (occasional `assert_eq!(cwd_events.len(), 3)` fails because the tailer hasn't flushed yet), bump the first `std::thread::sleep(Duration::from_millis(750))` to `1000`. The existing `start_tailing_replays_tool_calls_turns_and_test_runs` uses 750ms successfully, so 750 should suffice.

- [ ] **Step 9: Run the full codex transcript test module to catch regressions**

Run: `cargo test -p vimeflow --lib codex::transcript::tests`

Expected: `test result: ok. <N> passed; 0 failed`, where N is the pre-PR count plus 11.

- [ ] **Step 10: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "$(cat <<'EOF'
feat(agent): emit agent-cwd from codex transcript watcher

Wire extract_session_cwd into process_line and tail_loop. Track
last_cwd across the read loop; emit AgentCwdEvent on transitions
only, matching the Claude Code transcript watcher's contract (PR #239).

Per spec, the temporal granularity is per-turn (session_meta + turn_context)
rather than per-line — Codex does not stamp every JSONL entry with cwd.
Mid-turn worktree switches will lag by up to one turn until the next
turn_context line is written. The frontend `agent-cwd` listener is
agent-type-agnostic, so Codex panes pick up cwd tracking automatically.

Tests:
- 3 process_line transition-semantics tests (first-emit, dedup,
  back-and-forth).
- 1 end-to-end start_tailing test driving 6 lines through a
  FakeEventSink and asserting exactly 3 cwd events in order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update `AgentCwdEvent` doc comment + regenerate ts-rs binding

**Files:**

- Modify: `crates/backend/src/agent/types.rs` — doc comment block at lines 157–164.
- Regenerate: `src/bindings/AgentCwdEvent.ts` — via `npm run generate:bindings`.

- [ ] **Step 1: Replace the doc comment above `pub struct AgentCwdEvent` in `crates/backend/src/agent/types.rs`**

Find this block (lines 157–164):

```rust
/// Event emitted when the agent's tracked working directory changes.
///
/// Sourced from the structured `cwd` field that Claude Code (and Codex,
/// pending follow-up) writes on every transcript JSONL entry. This is the
/// authoritative signal for "where the agent currently is" — it picks up
/// tool-call-driven moves like `EnterWorktree` that intentionally do NOT
/// mutate the interactive shell's `$PWD`, so neither OSC 7 nor PTY text
/// patterns can catch them.
```

Replace with:

```rust
/// Event emitted when the agent's tracked working directory changes.
///
/// Sourced from each adapter's structured cwd channel in its transcript
/// JSONL:
/// - **Claude Code** writes a top-level `cwd` field on every transcript
///   entry; transitions fire as soon as the next line is parsed.
/// - **Codex** writes `payload.cwd` only on `session_meta` (once, at
///   session start) and `turn_context` (per turn) entries; transitions
///   therefore fire at session start and at each turn boundary, not
///   mid-turn.
///
/// In both cases this is the authoritative signal for "where the agent
/// currently is" — it picks up tool-call-driven moves like Claude's
/// `EnterWorktree` that intentionally do NOT mutate the interactive
/// shell's `$PWD`, so neither OSC 7 nor PTY text patterns can catch
/// them.
```

- [ ] **Step 2: Regenerate the ts-rs binding**

Run: `npm run generate:bindings`

Expected output ends with prettier formatting summary (e.g. `src/bindings/AgentCwdEvent.ts ...ms`). No errors.

- [ ] **Step 3: Verify the regenerated binding picked up the new doc comment**

Run: `git diff src/bindings/AgentCwdEvent.ts`

Expected: the `/**…*/` JSDoc block at the top of the file changed from the "every transcript JSONL entry / Codex follow-up" wording to the new per-adapter shape description. The TypeScript type body (`export type AgentCwdEvent = { sessionId: string; cwd: string }`) is unchanged.

If `git diff` shows extra changes outside the JSDoc, something else regenerated — investigate before continuing.

- [ ] **Step 4: Confirm formatters pass**

Run: `npm run format:check && npm run type-check`

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/types.rs src/bindings/AgentCwdEvent.ts
git commit -m "$(cat <<'EOF'
docs(agent): update AgentCwdEvent doc comment for codex shape

The doc previously claimed both adapters write cwd on "every transcript
JSONL entry (Codex follow-up)". This PR is that follow-up, and the
"every entry" claim is wrong for Codex — its rollout schema carries
session cwd only on session_meta + turn_context entries. Updated doc
describes both adapters' real field shapes (Claude per-line, Codex
per-turn).

The ts-rs binding at src/bindings/AgentCwdEvent.ts is regenerated to
mirror the new doc comment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update frontend JSDoc comments

**Files:**

- Modify: `src/features/agent-status/types/index.ts` — JSDoc block at lines 54–62.
- Modify: `src/features/workspace/WorkspaceView.tsx` — comment block at lines 315–321.

No behavior change. Strictly comment-only.

- [ ] **Step 1: Update `src/features/agent-status/types/index.ts`**

Find this block (lines 54–62):

```ts
/**
 * Agent-reported working directory, populated from the structured `cwd`
 * field on every transcript JSONL entry (Claude Code today; Codex
 * follow-up). `null` before the first transition or for agents that
 * don't expose a transcript. The workspace bridge mirrors this into
 * `pane.cwd` so the Header chip + git branch follow tool-call-driven
 * cwd changes (e.g. Claude's built-in `EnterWorktree`).
 */
cwd: string | null
```

Replace the comment (keep the `cwd: string | null` line unchanged):

```ts
/**
 * Agent-reported working directory, populated from each adapter's
 * structured cwd channel in its transcript JSONL:
 * - **Claude Code** writes a top-level `cwd` on every entry; transitions
 *   fire as soon as the next line is parsed.
 * - **Codex** writes `payload.cwd` only on `session_meta` (once) and
 *   `turn_context` (per turn) entries; transitions fire at session start
 *   and at each turn boundary, not mid-turn.
 *
 * `null` before the first transition or for agents that don't expose a
 * transcript. The workspace bridge mirrors this into `pane.cwd` so the
 * Header chip + git branch follow tool-call-driven cwd changes (e.g.
 * Claude's built-in `EnterWorktree`).
 */
cwd: string | null
```

- [ ] **Step 2: Update `src/features/workspace/WorkspaceView.tsx`**

Find this block (lines 315–321):

```tsx
// Mirror the agent's structured cwd into pane.cwd. The transcript JSONL
// (Claude Code today; Codex follow-up) stamps every entry with the
// agent's current cwd; the `agent-cwd` event surfaces transitions.
// Tool-call-driven moves like Claude's built-in `EnterWorktree` do NOT
// change the interactive shell's $PWD, so neither OSC 7 nor PTY text
// patterns catch them — this bridge is what makes the worktree chip +
// git branch follow agent-driven worktree switches.
```

Replace with:

```tsx
// Mirror the agent's structured cwd into pane.cwd. Both adapters expose
// an `agent-cwd` event on transitions; the sources differ:
//  - Claude Code stamps `cwd` on every transcript JSONL entry, so
//    transitions surface as soon as the next line is parsed.
//  - Codex carries `payload.cwd` only on `session_meta` + `turn_context`
//    entries, so transitions surface at turn boundaries (per-turn,
//    not mid-turn).
// Tool-call-driven moves like Claude's built-in `EnterWorktree` do NOT
// change the interactive shell's $PWD, so neither OSC 7 nor PTY text
// patterns catch them — this bridge is what makes the worktree chip +
// git branch follow agent-driven worktree switches.
```

- [ ] **Step 3: Confirm lints + types + tests pass**

Run: `npm run lint && npm run format:check && npm run type-check && npm test`

Expected: all four clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/agent-status/types/index.ts src/features/workspace/WorkspaceView.tsx
git commit -m "$(cat <<'EOF'
docs(workspace): clarify agent-cwd source per adapter

Mirrors the AgentCwdEvent doc comment update on the Rust side: drop
the "Codex follow-up" / "every transcript JSONL entry" wording and
describe each adapter's real cwd source (Claude per-line, Codex
per-turn via session_meta + turn_context).

No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final verification

**Files:** none modified.

- [ ] **Step 1: Run the full backend test suite**

Run: `cargo test -p vimeflow --lib`

Expected: all tests pass. Note the test count — should be the pre-PR count plus 11 (the new tests added in Tasks 1 + 2).

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run lint + format + type-check**

Run: `npm run lint && npm run format:check && npm run type-check`

Expected: all three clean.

- [ ] **Step 4: Verify commit history shape**

Run: `git log --oneline main..HEAD`

Expected: four behavior/doc commits from Tasks 1–4 layered on top of
the four `docs/` commits already produced by the `/lifeline:planner`
phase (1 plan + 3 spec). Reverse-chronological order:

```
<sha> docs(workspace): clarify agent-cwd source per adapter            ← Task 4
<sha> docs(agent): update AgentCwdEvent doc comment for codex shape    ← Task 3
<sha> feat(agent): emit agent-cwd from codex transcript watcher        ← Task 2
<sha> test(agent): add extract_session_cwd helper for codex rollouts   ← Task 1
<sha> docs(plan): codex-transcript-cwd-parser                          ← planner
<sha> docs(spec): mark spec codex-reviewed                             ← planner
<sha> docs(spec): apply codex feedback                                 ← planner
<sha> docs(spec): codex-transcript-cwd-parser                          ← planner
```

Eight commits total. If you see fewer than eight, a task commit was
skipped or squashed — investigate before pushing.

- [ ] **Step 5: Note the new file size in `codex/transcript.rs`** (informational only — does NOT block)

Run: `wc -l crates/backend/src/agent/adapter/codex/transcript.rs`

The file was 953 lines pre-PR and grows by roughly:

- ~33 lines of behavior code (helper + signature + emission + state).
- ~225 lines of tests (7 helper + 3 transition + 1 e2e + a tiny
  `empty_in_flight` helper).

Expected post-PR size: roughly **1180–1230 lines**. The exact number
is brittle (formatter passes, comment density, etc.) — this step is
informational. If the count is wildly outside that range (e.g.
< 1100 or > 1300), check whether tests were dropped or duplicated
before pushing. Otherwise, accept the size and move on.

The file is now further over the rules' 800-line ceiling. This is
acknowledged debt per spec section 2 "Out of scope" — a separate
refactor PR splits it. **Do NOT split in this PR.**

- [ ] **Step 6: (No commit — verification only.)**

If any step above failed, fix the underlying issue and re-run. Do not push until every step is clean.

---

## Self-Review Checklist

Run this after the plan is written (already done during plan authoring — recorded here for the implementer):

**Spec coverage:**

- ✅ Section 2 "In scope: codex/transcript.rs extraction + emission" → Tasks 1 + 2
- ✅ Section 2 "In scope: AgentCwdEvent doc comment" → Task 3
- ✅ Section 2 "In scope: ts-rs binding regenerated" → Task 3 Step 2
- ✅ Section 2 "In scope: frontend JSDoc comments" → Task 4
- ✅ Section 5.2 "7 extract_session_cwd unit tests" → Task 1 Step 1
- ✅ Section 5.3 "3 transition tests" → Task 2 Step 1
- ✅ Section 5.4 "1 e2e watcher test" → Task 2 Step 1 (final test block)
- ✅ Section 5.5 "ts-rs regeneration verification via npm run generate:bindings" → Task 3 Step 2
- ✅ Section 5.6 commands match what tasks invoke

**Placeholder scan:** none — every code block is literal Rust / TS to paste; every command is exact.

**Type consistency:** `extract_session_cwd` signature `(&Value) -> Option<&str>` matches between Task 1 (helper) and Task 2 (call site). `last_cwd: &mut Option<String>` matches between Task 2 Step 5/6/7 (signature) and tests (Task 2 Step 1).

**Out-of-scope deferrals honored:**

- Issue #234 — not touched. ✅
- Shell-pwd-from-pane-1 bug — not touched. ✅
- agentCwdHint pruning — not touched. ✅
- codex/transcript.rs split — explicitly NOT split (Task 5 Step 5 calls it out). ✅
- codex/parser.rs — not touched. ✅

---

## Stop Condition

This plan stops after Task 5. The next action — execution — is the user's choice, **not** a chained skill call from this plan. Control returns to `/lifeline:planner` so codex can review the plan before any implementation begins.

<!-- codex-reviewed: 2026-05-22T12:42:45Z -->
