# Codex Transcript Cwd Parser Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision history.** v1 of this plan was based on a v1 spec that assumed `turn_context.cwd` updates mid-session. Codex implemented v1 faithfully but the feature did not work end-to-end. v1's implementation commits (`cab6b73` → `dd95857`) and v1's plan/spec codex-reviewed footers were reverted. v2 (this plan) is rooted in the v2 spec at `docs/superpowers/specs/2026-05-22-codex-transcript-cwd-parser-design.md` and implements extraction from `session_meta.cwd` + `exec_command.workdir` only; `turn_context.cwd` is intentionally NOT a source.

**Goal:** Port PR #239's `agent-cwd` extraction to the Codex transcript watcher with the v2-corrected source model. Codex panes should emit `agent-cwd` transitions whenever codex switches its command working directory (via `exec_command.arguments.workdir`), without false reverts from `turn_context.cwd` (pinned to session start).

**Architecture:** Three private helpers in `codex/transcript.rs`. `extract_session_cwd` matches `session_meta` ONLY. `extract_exec_workdir` matches `response_item.payload.type == "function_call"` AND `payload.name == "exec_command"`, parses the JSON-encoded `arguments` string, returns the `workdir` field. `extract_codex_cwd` dispatches between them. Pre-match cwd extraction in `process_line` emits `AgentCwdEvent` on transitions only. Update doc-comments + regenerate ts-rs binding. Update two frontend JSDoc blocks.

**Tech Stack:** Rust (backend, `crates/backend`), `serde_json::Value`, `ts-rs` (binding regen), TypeScript (frontend doc-comments only).

**Reference spec:** [`docs/superpowers/specs/2026-05-22-codex-transcript-cwd-parser-design.md`](../specs/2026-05-22-codex-transcript-cwd-parser-design.md) (v2, codex-reviewed).

---

## Important — exit-code handling for all `Run:` commands

Do NOT pipe `Run:` commands through `| tail` or `| head`. In bash a piped command's exit code is the exit code of the LAST stage; `tail`'s exit code masks a failing `cargo test` / `npm test` / `npm run type-check` and the executing agent will read the run as a pass. Run commands unfiltered. The expected-output blocks below show what the relevant summary line looks like — verify it actually appears in the unfiltered output before continuing.

---

## File Structure

- **Modify** `crates/backend/src/agent/adapter/codex/transcript.rs` — add 3 helpers (`extract_session_cwd`, `extract_exec_workdir`, `extract_codex_cwd`), `last_cwd` state in `tail_loop`, `last_cwd` parameter on `process_line`, pre-match emission, two new imports, 15 new tests (4 session_cwd + 6 exec_workdir + 4 transition + 1 e2e).
- **Modify** `crates/backend/src/agent/types.rs` — update `AgentCwdEvent` doc comment (lines 157–164) to describe the two-source Codex model (session_meta + exec_command.workdir) and the intentional `turn_context` skip.
- **Regenerate** `src/bindings/AgentCwdEvent.ts` — via `npm run generate:bindings`. Not hand-edited.
- **Modify** `src/features/agent-status/types/index.ts` — JSDoc block above `cwd: string | null` field (lines 54–62).
- **Modify** `src/features/workspace/WorkspaceView.tsx` — comment block above `agentStatus.cwd → updatePaneCwd` bridge (lines 315–321).

No new files. No fixture files — tests use inline `json!()` values per the codebase convention.

---

## Task 1: Add `extract_session_cwd` helper (session_meta only) with unit tests

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` — add helper near top (above `validate_transcript_path`, around line 47), add 4 unit tests inside existing `#[cfg(test)] mod tests` block.

- [ ] **Step 1: Add 4 unit tests at the bottom of the existing `#[cfg(test)] mod tests` block.**

```rust
    // ---- extract_session_cwd unit tests (v2: session_meta ONLY) ----

    #[test]
    fn extract_session_cwd_session_meta_returns_cwd() {
        let v = json!({"type": "session_meta", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), Some("/workspace/A"));
    }

    #[test]
    fn extract_session_cwd_turn_context_returns_none() {
        // v2 spec section 1: turn_context is INTENTIONALLY NOT a cwd source.
        // Codex's turn_context.cwd is pinned to session-start and treating
        // it as live would cause false reverts after exec_command transitions.
        // This test is a defensive guard against re-introduction.
        let v = json!({"type": "turn_context", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_other_type_returns_none() {
        let v = json!({"type": "event_msg", "payload": {"cwd": "/workspace/A"}});
        assert_eq!(extract_session_cwd(&v), None);
    }

    #[test]
    fn extract_session_cwd_empty_string_returns_none() {
        let v = json!({"type": "session_meta", "payload": {"cwd": ""}});
        assert_eq!(extract_session_cwd(&v), None);
    }
```

> `serde_json::json` is already imported via `use serde_json::json;` in the test module.

- [ ] **Step 2: Run the tests to verify they fail with a compile error**

Run: `cargo test -p vimeflow --lib extract_session_cwd`

Expected: `error[E0425]: cannot find function 'extract_session_cwd'` (red — the helper doesn't exist yet).

- [ ] **Step 3: Add the `extract_session_cwd` helper near the top of `crates/backend/src/agent/adapter/codex/transcript.rs`**

Insert immediately above `pub(super) fn validate_transcript_path` (around line 47), after the `type InFlightToolCalls = HashMap<…>;` declaration:

```rust
/// Pull session-start cwd off a Codex rollout JSONL line.
///
/// Returns `Some(cwd)` ONLY for `session_meta` entries — the
/// session-start anchor. `turn_context.cwd` is intentionally NOT
/// matched here: empirically it just repeats `session_meta.cwd`
/// every turn (no information value), and treating it as a live cwd
/// would cause false reverts on reasoning-only turns after an
/// `exec_command.workdir` transition has already moved us to a new
/// directory. See spec section 1.
fn extract_session_cwd(value: &Value) -> Option<&str> {
    let event_type = value.get("type").and_then(Value::as_str)?;
    if event_type != "session_meta" {
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

Expected: `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "$(cat <<'EOF'
test(agent): add extract_session_cwd for codex session_meta cwd

v2 spec implementation, Task 1. Pure extraction helper scoped to
session_meta — the session-start anchor in Codex's rollout JSONL
schema (cli_version 0.132.0). Four unit tests cover the happy path,
the defensive turn_context-rejection (turn_context.cwd is pinned to
session-start and intentionally NOT a cwd source per v2 spec
section 1), other-event-type rejection, and empty-string guard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `extract_exec_workdir` helper (the mid-session signal)

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` — add helper immediately below `extract_session_cwd`, add 6 unit tests in the test module.

- [ ] **Step 1: Add 6 unit tests at the bottom of the test module, after the Task 1 tests.**

```rust
    // ---- extract_exec_workdir unit tests (the mid-session signal) ----

    #[test]
    fn extract_exec_workdir_happy_path() {
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "call_id": "c1",
                "arguments": "{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"
            }
        });
        assert_eq!(extract_exec_workdir(&v).as_deref(), Some("/workspace/B"));
    }

    #[test]
    fn extract_exec_workdir_other_event_type_returns_none() {
        // event_msg carrying a function_call-shaped payload should still
        // be rejected — the outer event type gate is response_item.
        let v = json!({
            "type": "event_msg",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": "{\"workdir\":\"/x\"}"
            }
        });
        assert_eq!(extract_exec_workdir(&v), None);
    }

    #[test]
    fn extract_exec_workdir_non_function_call_returns_none() {
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "custom_tool_call",
                "name": "exec_command",
                "input": "{\"workdir\":\"/x\"}"
            }
        });
        assert_eq!(extract_exec_workdir(&v), None);
    }

    #[test]
    fn extract_exec_workdir_non_exec_command_returns_none() {
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "read_file",
                "arguments": "{\"path\":\"/x\"}"
            }
        });
        assert_eq!(extract_exec_workdir(&v), None);
    }

    #[test]
    fn extract_exec_workdir_malformed_arguments_json_returns_none() {
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": "{not json"
            }
        });
        assert_eq!(extract_exec_workdir(&v), None);
    }

    #[test]
    fn extract_exec_workdir_missing_workdir_field_returns_none() {
        let v = json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "name": "exec_command",
                "arguments": "{\"cmd\":\"ls\"}"
            }
        });
        assert_eq!(extract_exec_workdir(&v), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail with a compile error**

Run: `cargo test -p vimeflow --lib extract_exec_workdir`

Expected: `error[E0425]: cannot find function 'extract_exec_workdir'`.

- [ ] **Step 3: Add the `extract_exec_workdir` helper immediately below `extract_session_cwd`**

```rust
/// Pull the mid-session workdir off a Codex `exec_command` function-call
/// rollout entry. This is codex's de facto session cwd after the start
/// (verified empirically — `turn_context.cwd` does not update on
/// codex-driven cwd changes; `exec_command.arguments.workdir` does).
///
/// `arguments` is a JSON-encoded string per Codex's rollout schema —
/// it must be parsed before reading `workdir`. Malformed JSON, missing
/// fields, or empty strings all short-circuit to `None`.
fn extract_exec_workdir(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str)? != "response_item" {
        return None;
    }
    let payload = value.get("payload")?;
    if payload.get("type").and_then(Value::as_str)? != "function_call" {
        return None;
    }
    if payload.get("name").and_then(Value::as_str)? != "exec_command" {
        return None;
    }
    let raw = payload.get("arguments").and_then(Value::as_str)?;
    let args: Value = serde_json::from_str(raw).ok()?;
    args.get("workdir")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p vimeflow --lib extract_exec_workdir`

Expected: `test result: ok. 6 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "$(cat <<'EOF'
test(agent): add extract_exec_workdir for codex mid-session cwd

v2 spec implementation, Task 2. Pulls the mid-session workdir off
exec_command function-call rollout entries. The arguments field is a
JSON-encoded string per Codex's schema; the helper parses it and
extracts the workdir field, returning None on malformed JSON, missing
fields, wrong tool names, or wrong event types.

Six unit tests cover happy path, wrong-event-type rejection, wrong-
function-call-type rejection, wrong-tool-name rejection, malformed-
JSON rejection, and missing-workdir guard.

Helper is dead-code until Task 3 wires it into process_line via the
dispatcher.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `extract_codex_cwd` dispatcher + emission, with transition tests + e2e

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs`
  - Add 2 new `use` lines at the top (around line 21–23).
  - Add `extract_codex_cwd` dispatcher immediately below `extract_exec_workdir`.
  - Add `let mut last_cwd: Option<String> = None;` in `tail_loop` (around line 141).
  - Extend `process_line` signature with `last_cwd: &mut Option<String>` (around line 195).
  - Add cwd extraction + emission in `process_line` body (after the `match serde_json::from_str` early-return, before the existing `match value.get("type")…`).
  - Update both `process_line(...)` call sites in `tail_loop` (around lines 159 and 177).
  - Add 4 transition-semantics tests + 1 e2e test in the test module.

- [ ] **Step 1: Add 4 transition tests + 1 e2e test at the bottom of the test module, after the Task 2 tests.**

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
    fn process_line_repeated_cwd_across_sources_suppresses() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}"#,
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
    fn process_line_cwd_transition_across_sources_emits() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c2","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}"#,
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
    }

    /// v2-critical regression guard. Codex review on the v2 spec (HIGH)
    /// flagged that including turn_context.cwd as a cwd source would
    /// cause a false revert: after session_meta(A) → exec_command(B),
    /// the next turn's turn_context(A) (pinned to session-start) would
    /// emit agent-cwd=A and bounce the pane chip back. This test locks
    /// in the v2 design decision to skip turn_context entirely.
    /// If anyone re-adds turn_context to extract_session_cwd, this
    /// test fires.
    #[test]
    fn process_line_turn_context_after_exec_command_does_not_revert() {
        let sink = Arc::new(FakeEventSink::new());
        let events: Arc<dyn EventSink> = sink.clone();
        let mut emitter = TestRunEmitter::new(events.clone());
        let mut in_flight = empty_in_flight();
        let mut num_turns = 0u32;
        let mut last_cwd: Option<String> = None;

        let lines = [
            r#"{"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}"#,
            r#"{"timestamp":"2026-05-22T10:00:02Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}"#,
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
        assert_eq!(
            cwd_events.len(),
            2,
            "turn_context.cwd MUST NOT emit a cwd event \
             (would cause false revert to session-start after exec_command transition)"
        );
        assert_eq!(cwd_events[0].1["cwd"], "/workspace/A");
        assert_eq!(cwd_events[1].1["cwd"], "/workspace/B");
        // Crucially, last_cwd should still be B — the worktree we're in.
        assert_eq!(last_cwd.as_deref(), Some("/workspace/B"));
    }

    // ---- end-to-end watcher test (with v2 regression guard inline) ----

    #[test]
    fn start_tailing_emits_cwd_transitions_in_order() {
        let sink = Arc::new(FakeEventSink::new());

        let tmp = tempfile::tempdir().expect("tempdir");
        let transcript_path = tmp.path().join("rollout.jsonl");

        // 7 lines, 3 expected emissions:
        //   1. session_meta cwd=/workspace/A             (emit)
        //   2. turn_context cwd=/workspace/A             (no emit — extractor rejects turn_context)
        //   3. exec_command workdir=/workspace/B         (emit — transition)
        //   4. event_msg task_started                    (no emit)
        //   5. exec_command workdir=/workspace/B         (suppressed — same as last_cwd)
        //   6. turn_context cwd=/workspace/A             (no emit — REGRESSION GUARD: must not revert)
        //   7. exec_command workdir=/workspace/A         (emit — transition back)
        write_rollout(
            &transcript_path,
            &[
                json!({"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:02Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}),
                json!({"timestamp":"2026-05-22T10:00:03Z","type":"event_msg","payload":{"type":"task_started"}}),
                json!({"timestamp":"2026-05-22T10:00:04Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c2","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"}}),
                json!({"timestamp":"2026-05-22T10:00:04.5Z","type":"turn_context","payload":{"turn_id":"t2","cwd":"/workspace/A"}}),
                json!({"timestamp":"2026-05-22T10:00:05Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c3","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"}}),
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

- [ ] **Step 2: Run the new tests to verify they fail with a compile error**

Run: `cargo test -p vimeflow --lib process_line_first_cwd_always_emits`

Expected: compile error — `process_line` only takes 7 args, `extract_codex_cwd` doesn't exist, no emission code. **Red.**

### Step 2: Wire the implementation

- [ ] **Step 3: Add two new imports at the top of `crates/backend/src/agent/adapter/codex/transcript.rs`**

Find the existing import block (around lines 19–23):

```rust
use crate::agent::events::{emit_agent_tool_call, emit_agent_turn};
use crate::agent::types::{AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
```

Modify to add `emit_agent_cwd` and `AgentCwdEvent`:

```rust
use crate::agent::events::{emit_agent_cwd, emit_agent_tool_call, emit_agent_turn};
use crate::agent::types::{AgentCwdEvent, AgentToolCallEvent, AgentTurnEvent, ToolCallStatus};
```

- [ ] **Step 4: Add the `extract_codex_cwd` dispatcher immediately below `extract_exec_workdir`**

```rust
/// Dispatcher returning the observed cwd from whichever source carries
/// it. Tries the session_meta path first (cheap, no JSON re-parse),
/// falls back to the exec_command workdir path. Returns
/// `Option<String>` because the workdir path must return owned strings
/// (parsed JSON allocates).
fn extract_codex_cwd(value: &Value) -> Option<String> {
    if let Some(cwd) = extract_session_cwd(value) {
        return Some(cwd.to_string());
    }
    extract_exec_workdir(value)
}
```

- [ ] **Step 5: Add `last_cwd` state in `tail_loop`**

Find `fn tail_loop(…)` (around line 130). Locate this block:

```rust
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;
    let mut emitter = TestRunEmitter::new(events.clone());
```

Add `let mut last_cwd: Option<String> = None;` after `num_turns`:

```rust
    let mut in_flight: InFlightToolCalls = HashMap::new();
    let mut num_turns = 0_u32;
    let mut last_cwd: Option<String> = None;
    let mut emitter = TestRunEmitter::new(events.clone());
```

- [ ] **Step 6: Update the partial-line branch's `process_line` call**

Find (around lines 158–168):

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

Add `&mut last_cwd,`:

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

- [ ] **Step 7: Update the single-line branch's `process_line` call**

Find (around lines 176–185):

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

- [ ] **Step 8: Extend `process_line` signature (around line 195) and add emission body**

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

    // Emit agent-cwd on transitions only. Codex's two cwd sources are
    // session_meta.payload.cwd (session start) and
    // response_item.payload.arguments.workdir for exec_command function
    // calls (mid-session). turn_context.cwd is intentionally NOT a
    // source — see spec section 1 and the regression test
    // `process_line_turn_context_after_exec_command_does_not_revert`.
    if let Some(observed) = extract_codex_cwd(&value) {
        if last_cwd.as_deref().map_or(true, |seen| seen != observed.as_str()) {
            let event = AgentCwdEvent {
                session_id: session_id.to_string(),
                cwd: observed.clone(),
            };
            if let Err(e) = emit_agent_cwd(events.as_ref(), &event) {
                log::warn!("Failed to emit agent-cwd event: {}", e);
            }
            *last_cwd = Some(observed);
        }
    }

    match value.get("type").and_then(Value::as_str) {
        Some("response_item") => {
```

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `cargo test -p vimeflow --lib codex::transcript`

Expected: all 15 new tests (4 session_cwd + 6 exec_workdir + 4 transition + 1 e2e) pass, plus the existing tests in the module still pass.

- [ ] **Step 10: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "$(cat <<'EOF'
feat(agent): emit agent-cwd from codex transcript watcher

v2 spec implementation, Task 3. Add extract_codex_cwd dispatcher that
tries session_meta first, falls back to exec_command workdir. Thread
last_cwd through tail_loop + process_line; emit AgentCwdEvent on
transitions only, matching the Claude Code transcript watcher contract
(PR #239).

Critical v2 design point: turn_context.cwd is intentionally NOT a
cwd source. It's pinned to session start in practice, and treating
it as live would cause false reverts after exec_command.workdir
transitions (codex review on the v2 spec caught this). Regression
tests in process_line_turn_context_after_exec_command_does_not_revert
and the e2e fixture lock in the v2 behavior.

Tests added:
- 4 process_line transition tests (first-emit, dedup across sources,
  back-and-forth, turn_context-no-revert regression guard).
- 1 end-to-end start_tailing test driving 7 lines through a
  FakeEventSink and asserting exactly 3 cwd events in correct order
  with no false revert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `AgentCwdEvent` doc comment + regenerate ts-rs binding

**Files:**

- Modify: `crates/backend/src/agent/types.rs` — doc comment block at lines 157–164.
- Regenerate: `src/bindings/AgentCwdEvent.ts` — via `npm run generate:bindings`.

- [ ] **Step 1: Replace the doc comment above `pub struct AgentCwdEvent`**

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
/// - **Codex** writes cwd in two places the watcher reads:
///   `session_meta.payload.cwd` (once, at session start) and
///   `response_item.payload.arguments.workdir` for `exec_command`
///   function calls (the mid-session signal — fires whenever codex
///   runs a tool command in a new directory). Codex also writes
///   `turn_context.payload.cwd` on every turn, but the watcher
///   intentionally ignores that field because it's pinned to the
///   session-start value and would cause false reverts after a
///   mid-session `exec_command.workdir` transition.
///
/// In both cases this is the authoritative signal for "where the agent
/// currently is" — it picks up tool-call-driven moves like Claude's
/// `EnterWorktree` and codex's "switch to worktree" navigation that
/// intentionally do NOT mutate the interactive shell's `$PWD`, so
/// neither OSC 7 nor PTY text patterns can catch them.
```

- [ ] **Step 2: Regenerate the ts-rs binding**

Run: `npm run generate:bindings`

Expected: prettier formatting summary; no errors.

- [ ] **Step 3: Verify the regenerated binding picked up the new doc comment**

Run: `git diff src/bindings/AgentCwdEvent.ts`

Expected: the `/**…*/` JSDoc block at the top of the file changed from the "every transcript JSONL entry / Codex follow-up" wording to the new per-adapter shape description. The type body unchanged.

- [ ] **Step 4: Confirm formatters pass**

Run: `npm run format:check && npm run type-check`

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/types.rs src/bindings/AgentCwdEvent.ts
git commit -m "$(cat <<'EOF'
docs(agent): update AgentCwdEvent doc comment for v2 codex shape

v2 spec implementation, Task 4. Update the AgentCwdEvent doc comment
to describe the two-source Codex cwd model accurately:

  - session_meta.payload.cwd (session start)
  - exec_command.arguments.workdir (mid-session)

Explicitly call out that turn_context.payload.cwd is intentionally
NOT a source — it's pinned to session-start in practice and including
it would cause false reverts.

The ts-rs binding at src/bindings/AgentCwdEvent.ts is regenerated
via npm run generate:bindings to mirror the new doc comment.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update frontend JSDoc comments

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
 * - **Codex** writes cwd in two read paths: `session_meta.payload.cwd`
 *   (session start) and `response_item.payload.arguments.workdir` for
 *   `exec_command` function calls (mid-session). `turn_context.cwd`
 *   is intentionally NOT a source — pinned to session-start and would
 *   cause false reverts.
 *
 * `null` before the first transition or for agents that don't expose a
 * transcript. The workspace bridge mirrors this into `pane.cwd` so the
 * Header chip + git branch follow tool-call-driven cwd changes.
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
//  - Codex stamps cwd in session_meta.payload.cwd (session start) and
//    response_item.payload.arguments.workdir for exec_command function
//    calls (mid-session). turn_context.cwd is intentionally ignored
//    by the backend — pinned to session-start and would cause false
//    reverts.
// Tool-call-driven moves like Claude's built-in `EnterWorktree` and
// codex's "switch to worktree" navigation do NOT change the interactive
// shell's $PWD, so neither OSC 7 nor PTY text patterns catch them —
// this bridge is what makes the worktree chip + git branch follow
// agent-driven worktree switches.
```

- [ ] **Step 3: Confirm lints + types + tests pass**

Run: `npm run lint && npm run format:check && npm run type-check && npm test`

Expected: all four clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/agent-status/types/index.ts src/features/workspace/WorkspaceView.tsx
git commit -m "$(cat <<'EOF'
docs(workspace): clarify v2 agent-cwd source per adapter

v2 spec implementation, Task 5. Mirror the AgentCwdEvent doc comment
update on the frontend side: drop the "Codex follow-up" / "every
transcript JSONL entry" wording and describe Codex's two-source model
explicitly (session_meta + exec_command.workdir, NOT turn_context).

No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification

**Files:** none modified.

- [ ] **Step 1: Run the full backend test suite (matches CI)**

Run: `cargo test -p vimeflow`

This runs BOTH the lib tests (where the new tests in Tasks 1–3 live)
AND the `crates/backend/tests/*` integration tests. Using `--lib`
here would skip integration tests and could let an implementation
pass the plan while failing CI's full backend gate.

Expected: all tests pass. New tests added in Tasks 1–3 = 15.

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run lint + format + type-check**

Run: `npm run lint && npm run format:check && npm run type-check`

Expected: all three clean.

- [ ] **Step 4: Verify commit history shape**

Run: `git log --oneline main..HEAD`

Expected: five behavior/doc commits from Tasks 1–5 layered on top of
the v2 planner artifacts:

```
<sha> docs(workspace): clarify v2 agent-cwd source per adapter            ← Task 5
<sha> docs(agent): update AgentCwdEvent doc comment for v2 codex shape   ← Task 4
<sha> feat(agent): emit agent-cwd from codex transcript watcher           ← Task 3
<sha> test(agent): add extract_exec_workdir for codex mid-session cwd     ← Task 2
<sha> test(agent): add extract_session_cwd for codex session_meta cwd     ← Task 1
<sha> docs(plan): mark v2 plan codex-reviewed                             ← planner
<sha> docs(plan): apply codex feedback (v2)                               ← planner (if any)
<sha> docs(plan): redesign for v2 spec                                    ← planner
<sha> docs(spec): mark v2 spec codex-reviewed
<sha> docs(spec): apply codex feedback (drop turn_context as cwd source)
<sha> docs(spec): redesign for correct codex schema (v2)
<sha> docs(plan): mark plan codex-reviewed                                ← v1 (still in history)
<sha> docs(plan): apply codex feedback                                    ← v1
<sha> docs(plan): codex-transcript-cwd-parser                             ← v1
<sha> docs(spec): mark spec codex-reviewed                                ← v1
<sha> docs(spec): apply codex feedback                                    ← v1
<sha> docs(spec): codex-transcript-cwd-parser                             ← v1
```

(The v1 planner commits stay in history; codex's v1 implementation commits were `git reset`-ed away.)

- [ ] **Step 5: Note the new file size in `codex/transcript.rs`** (informational only — does NOT block)

Run: `wc -l crates/backend/src/agent/adapter/codex/transcript.rs`

The file was 953 lines pre-PR and grows by roughly 50 behavior + 280 test lines = ~1280–1330 lines. The file is now further over the rules' 800-line ceiling. This is acknowledged debt per spec section 2 — a separate refactor PR splits it.

- [ ] **Step 6: (No commit — verification only.)**

If any step above failed, fix the underlying issue and re-run. Do not push until every step is clean.

---

## Self-Review Checklist

After writing the plan, the implementer should verify:

**Spec coverage:**

- ✅ Section 2 "In scope: codex/transcript.rs extraction + emission" → Tasks 1, 2, 3
- ✅ Section 2 "In scope: AgentCwdEvent doc comment" → Task 4
- ✅ Section 2 "In scope: ts-rs binding regenerated" → Task 4 Step 2
- ✅ Section 2 "In scope: frontend JSDoc comments" → Task 5
- ✅ Section 5.2 "4 extract_session_cwd unit tests (incl. turn_context-returns-None)" → Task 1
- ✅ Section 5.3 "6 extract_exec_workdir unit tests" → Task 2
- ✅ Section 5.4 "4 transition tests (incl. v2 regression guard)" → Task 3
- ✅ Section 5.5 "1 e2e watcher test (with regression guard inline)" → Task 3
- ✅ Section 5.6 "ts-rs regeneration via npm run generate:bindings" → Task 4 Step 2

**v2 design decisions honored:**

- ✅ `extract_session_cwd` matches `session_meta` ONLY (Task 1 Step 3).
- ✅ `turn_context.cwd` extraction is rejected by a defensive test (Task 1 Step 1, second test).
- ✅ The regression guard `process_line_turn_context_after_exec_command_does_not_revert` is present (Task 3 Step 1).
- ✅ The e2e fixture includes a `turn_context(A)` after an `exec_command(B)` to lock in v2 at the integration layer (Task 3 Step 1).

**Out-of-scope deferrals honored:**

- Issue #234 — not touched. ✅
- Shell-pwd-from-pane-1 bug — not touched. ✅
- agentCwdHint pruning — not touched. ✅
- codex/transcript.rs split — explicitly NOT split (Task 6 Step 5 calls it out). ✅
- codex/parser.rs — not touched. ✅

---

## Stop Condition

This plan stops after Task 6. The next action — execution — is the user's choice, **not** a chained skill call from this plan.
