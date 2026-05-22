# 2026-05-22 — Codex transcript cwd parser design

## 1. Summary

PR #239 added a structured `agent-cwd` event channel for the Claude Code
transcript watcher (`crates/backend/src/agent/adapter/claude_code/transcript.rs`).
That channel is the load-bearing path for keeping `pane.cwd` in sync when an
agent moves between worktrees via in-process tool calls that intentionally
don't mutate the interactive shell's `$PWD` (Claude's built-in
`EnterWorktree`, Superpowers' worktree skill, etc.). Without it, OSC 7 and
the text-pattern `agentCwdHint` paths are structurally blind to those moves
and the per-pane chip pins to the starting checkout.

PR #239's "Follow-ups" list named the matching work for the Codex adapter
as the next small piece on top of that foundation:

> Codex transcript cwd: same extraction in
> `crates/backend/src/agent/adapter/codex/parser.rs` for the Codex rollout
> JSONL. Field is in the same place; should be a small commit on top of
> this PR's foundation.

This spec covers that follow-up — port the `agent-cwd` extraction to the
Codex rollout JSONL watcher so Codex panes get a cwd channel sourced from
Codex's transcript JSONL. The temporal contract differs from Claude Code's
per-line `cwd` channel and the implementation has to make that explicit:
Codex's `cwd` field lives only on `session_meta` (once, at session start)
and `turn_context` (once per turn) entries, so cwd transitions fire at
session start and at each turn boundary — **not mid-turn**. A Codex-side
worktree switch invoked mid-turn (e.g. an `apply_patch` that does its own
`cd`, or an out-of-band `cd` inside an `exec_command` block) does not
surface a new `agent-cwd` event until the next `turn_context` line is
written, which typically happens when the agent next responds to the
user. This is a known semantic limitation of the Codex rollout schema as
of `cli_version 0.132.0` — not a shortcoming of the extraction logic.

Two caveats from PR #239's wording have to be corrected in the
implementation:

1. **Wrong file.** The live event channel lives in `transcript.rs`, not
   `parser.rs`. `codex/parser.rs` produces `AgentStatusEvent` snapshots
   (tokens, cost, rate limits) — that event type has no `cwd` field, and
   the frontend's `pane.cwd` is driven exclusively by `agent-cwd` events
   emitted by the transcript tailer. The change lands in
   `crates/backend/src/agent/adapter/codex/transcript.rs`.
2. **"Same place" is misleading.** Claude Code stamps a top-level `cwd`
   field on every JSONL line. Codex does not. In the Codex rollout JSONL
   (verified against real `cli_version 0.132.0` rollouts on disk), `cwd`
   appears only nested under two event types:
   - `session_meta.payload.cwd` — once at session start.
   - `turn_context.payload.cwd` — once per turn.

   `event_msg` and `response_item` lines do **not** carry session cwd. The
   per-`function_call` `arguments.workdir` is a per-command scratch path,
   not the session cwd, and is deliberately ignored.

   The extraction logic therefore can't be a structural copy-paste of
   Claude's "every line has cwd at top-level" shape. It needs a small
   helper scoped to the two event types that actually carry session cwd.

The frontend side is already wired generically: `useAgentStatus` listens
for `agent-cwd` regardless of agent type, and `WorkspaceView` bridges the
hook output to `updatePaneCwd` (both shipped in PR #239 commit 5). Codex
panes pick up cwd tracking the moment the backend starts emitting — no
frontend change needed.

## 2. Scope

### In scope

Behavior change in one implementation file; the rest are comment-only
or fixture additions that complete the work cleanly:

- **Behavior:** `crates/backend/src/agent/adapter/codex/transcript.rs` —
  the actual extraction + emission logic.
- **Doc-comment fix** on `AgentCwdEvent` in
  `crates/backend/src/agent/types.rs` (currently says cwd is sourced from
  "the structured `cwd` field that Claude Code (and Codex, **pending
  follow-up**) writes on **every** transcript JSONL entry" — this PR
  _is_ that follow-up, and the "every entry" claim is wrong for Codex).
  The ts-rs binding at `src/bindings/AgentCwdEvent.ts` is regenerated
  from the Rust doc-comment on test runs, so it updates automatically;
  the spec calls out both files for clarity, but the binding is not
  hand-edited.
- **Frontend comment fixes** (no behavior change) — two JSDoc-style
  block comments that repeat the same stale "every transcript JSONL
  entry" claim and explicitly say "Codex follow-up", which this PR
  resolves:
  - `src/features/agent-status/types/index.ts` (around line 54–62, the
    `cwd: string | null` field on the agent-status state).
  - `src/features/workspace/WorkspaceView.tsx` (around line 315–321,
    the comment above the `agentStatus.cwd → updatePaneCwd` bridge).
- Add `extract_session_cwd(&Value) -> Option<&str>` private helper that
  returns `payload.cwd` when `type` is `session_meta` or `turn_context`,
  empty-string filtered out.
- Add `last_cwd: Option<String>` state to the `tail_loop` and thread it
  through `process_line`.
- Emit `AgentCwdEvent` via the existing `emit_agent_cwd` helper on
  transitions only (first observed cwd always fires; repeated identical
  cwd values do not re-emit).
- Imports: `crate::agent::events::emit_agent_cwd` and
  `crate::agent::types::AgentCwdEvent`.
- Unit-test coverage for the extraction helper and the transition
  semantics (rules/rust/testing.md: `#[cfg(test)] mod tests` co-located).
- End-to-end fixture coverage in `start_tailing` mirroring the existing
  `start_tailing_replays_tool_calls_turns_and_test_runs` test — drive a
  rollout through the tailer and assert `agent-cwd` events arrive in the
  expected order on a `FakeEventSink`.

### Out of scope (deferred, not lost)

- **Issue #234** — persisted-session-cache refactor that reshapes the
  flat PTY cache into a session→pane graph with per-pane cwd. The
  agent-cwd channel this spec lands is a prerequisite for #234's
  per-pane cwd persistence to work for Codex panes, but the schema
  change itself is a separate spec/PR.
- **Shell-pwd-doesn't-inherit-from-pane-1** — newly opened shell panes
  don't start in the active pane's cwd. Separate root-cause investigation
  needed in the terminal/PTY spawn path; not in this PR.
- **Pruning the now-redundant `agentCwdHint` text patterns in
  `Body.tsx`** — PR #239's other "Follow-ups" item; deferred until both
  Claude and Codex adapters' structured channels have been validated in
  production. OSC 7 and the Claude-startup-banner home-cwd resolution
  stay either way — they cover interactive-shell `cd` cases the JSONL
  channel doesn't see.
- **`codex/transcript.rs` is already 953 lines** (rules say ≤400
  typical, ≤800 max). This PR adds ~25 lines, pushing it further over.
  Splitting is a separate refactor PR; calling it out here so the debt
  is visible and not silently accumulating.
- **`codex/parser.rs` changes** — none needed. The status-snapshot path
  consumes `AgentStatusEvent`, which has no `cwd` field; adding one
  would require a frontend change with no current consumer. If a future
  consumer needs the cwd in the status snapshot, that's its own spec.

### PR scope discipline

One PR, one question: _Does the Codex transcript emit `agent-cwd` events
with the same transition-only semantics as the Claude Code transcript?_
No drive-by refactors, no incidental file moves, no unrelated test
cleanup.

## 3. Data flow & extraction shape

### 3.1 Codex rollout JSONL shape (verified against `cli_version 0.132.0`)

```jsonl
{"timestamp":"…","type":"session_meta","payload":{"id":"…","cwd":"/abs/path","cli_version":"0.132.0", …}}
{"timestamp":"…","type":"turn_context","payload":{"turn_id":"…","cwd":"/abs/path","model":"gpt-5.4", …}}
{"timestamp":"…","type":"event_msg","payload":{"type":"task_started", …}}
{"timestamp":"…","type":"event_msg","payload":{"type":"token_count", …}}
{"timestamp":"…","type":"response_item","payload":{"type":"function_call","call_id":"…","arguments":"…"}}
```

Only `session_meta` and `turn_context` carry `payload.cwd`. Function-call
`arguments.workdir` is per-command scratch and intentionally not
considered session cwd.

### 3.2 Extraction helper

Private to `transcript.rs`:

```rust
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

Named `extract_session_cwd` (not `extract_cwd`) to make scope explicit —
we are not pulling the per-command `workdir`.

### 3.3 Integration into `process_line`

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
        Some("response_item") => { /* unchanged */ }
        Some("event_msg")     => { /* unchanged */ }
        _ => {}
    }
}
```

Pre-match placement mirrors the Claude Code structure so a side-by-side
diff between `claude_code/transcript.rs::process_line` and
`codex/transcript.rs::process_line` makes the parity obvious.

### 3.4 `tail_loop` state

Add `let mut last_cwd: Option<String> = None;` next to the existing
`num_turns` declaration. Thread it through to `process_line` (one new
parameter at the end of the signature, matching Claude's call shape).

### 3.5 Transition semantics

- **First observed cwd always emits.** `last_cwd: None` →
  `map_or(true, …)` short-circuits true on the first hit. Matches Claude.
- **Repeated identical cwd suppresses.** `turn_context` lines fire once
  per turn and frequently repeat the same cwd; only transitions emit.
- **Empty string filtered at the extraction site.** `filter(|s|
!s.is_empty())` inside `extract_session_cwd`. Matches Claude's
  `!observed.is_empty()` guard.
- **Malformed JSON skipped silently.** The existing `serde_json::from_str`
  arm returns early; extraction never runs on malformed input.
- **Missing `payload` or missing `cwd` field skipped silently.** Both
  `?` operators in `extract_session_cwd` short-circuit to `None`.
- **Temporal granularity is per-turn, not per-line.** This is the key
  divergence from Claude. Codex's rollout schema only carries `cwd` on
  `session_meta` (once) and `turn_context` (per turn). Mid-turn worktree
  switches won't surface a new `agent-cwd` event until the next
  `turn_context` line. In practice this means the pane chip may lag by
  up to one turn after a tool-driven `cd`; the next user prompt or
  agent turn closes the gap. This is a schema-imposed limit, not a
  bug — the only ways to close the gap further would be (a) ask the
  Codex team to add a mid-turn cwd event (out of scope), or (b) wire a
  parallel text-pattern heuristic similar to Claude's `agentCwdHint`
  for Codex output (deferred; the structured channel is the canonical
  source, mirroring PR #239's design decision).

## 4. Components & files

### 4.1 Files changed

| File                                                   | Change                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/backend/src/agent/adapter/codex/transcript.rs` | Add `extract_session_cwd` helper, thread `last_cwd: Option<String>` through `tail_loop` + `process_line`, add cwd extraction + transition emission, expand imports.                                                           |
| `crates/backend/src/agent/types.rs`                    | Edit the doc comment above `AgentCwdEvent` (line ~157–164) to drop "pending follow-up" / "every transcript JSONL entry" and describe both adapters' real field shapes.                                                        |
| `src/bindings/AgentCwdEvent.ts`                        | Regenerated by `ts-rs` on `cargo test` runs (the `#[cfg_attr(test, derive(ts_rs::TS))]` + `ts(export)` attributes on `AgentCwdEvent`). Not hand-edited. The new doc-comment text appears in the generated `/**…*/` block.     |
| `src/features/agent-status/types/index.ts`             | Doc-only — update the JSDoc block above `cwd: string \| null` (around lines 54–62) to drop "every transcript JSONL entry (Claude Code today; Codex follow-up)" and describe both adapters' real field shapes. No type change. |
| `src/features/workspace/WorkspaceView.tsx`             | Doc-only — update the comment block above the `agentStatus.cwd → updatePaneCwd` bridge (around lines 315–321) for the same reason. No behavior change.                                                                        |

### 4.2 Files NOT changed

- `crates/backend/src/agent/adapter/codex/parser.rs` — status snapshot path, no cwd.
- `crates/backend/src/agent/adapter/codex/mod.rs` — adapter trait impl; unchanged.
- `crates/backend/src/agent/adapter/codex/locator.rs`, `types.rs` — unrelated.
- `crates/backend/src/agent/events.rs` — `emit_agent_cwd` already exists (PR #239 commit 5).
- `crates/backend/src/agent/types.rs` `AgentCwdEvent` _struct_ — fields stay
  `(session_id, cwd)`. Only the doc comment changes.
- Frontend behavior: `useAgentStatus`, `WorkspaceView`, pane state — all
  already listen to `agent-cwd` regardless of agent type. The hook,
  bridge, and pane-state code are untouched. Only two JSDoc-style
  comment blocks change (see 4.1), and those changes are non-functional.

### 4.3 New helper

Added near the top of `codex/transcript.rs`, just above `validate_transcript_path`:

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

### 4.4 `process_line` signature extension

Adds one parameter at the end (matching Claude's call shape so the two
adapters' `process_line` signatures stay structurally aligned):

```rust
// Before (current):
fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
) { … }

// After:
fn process_line(
    line: &str,
    session_id: &str,
    cwd: Option<&Path>,
    events: &Arc<dyn EventSink>,
    emitter: &mut TestRunEmitter,
    in_flight: &mut InFlightToolCalls,
    num_turns: &mut u32,
    last_cwd: &mut Option<String>,  // new
) { … }
```

### 4.5 `tail_loop` state addition

In `fn tail_loop`, alongside `let mut num_turns = 0_u32;`:

```rust
let mut last_cwd: Option<String> = None;
```

Threaded into both `process_line(…)` call sites in the read loop (the
single-line branch and the partial-line branch — `codex/transcript.rs`
has two because of its chunk-spanning partial-line handler at lines
~152–185).

### 4.6 Updated `AgentCwdEvent` doc comment

Current text (`crates/backend/src/agent/types.rs:157–164`):

> Sourced from the structured `cwd` field that Claude Code (and Codex,
> pending follow-up) writes on every transcript JSONL entry. …

Proposed text:

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

The `#[cfg_attr(test, derive(ts_rs::TS))]` + `ts(export)` attributes on
`AgentCwdEvent` mean `cargo test` (under the existing project test
config) regenerates `src/bindings/AgentCwdEvent.ts` with the new comment
text. **The ts-rs binding itself is not hand-edited** — it's
regenerated and committed alongside the Rust change. The two frontend
JSDoc comments listed in 4.1 (`agent-status/types/index.ts` and
`workspace/WorkspaceView.tsx`) ARE hand-edited; they live outside ts-rs
and have to be updated manually.

## 5. Testing strategy

### 5.1 Test inventory

Three layers, all co-located in `codex/transcript.rs` (per
rules/rust/testing.md: `#[cfg(test)] mod tests` at file bottom). Test
function names match the codebase convention used throughout
`codex/transcript.rs` and `claude_code/transcript.rs` — descriptive
`<function>_<scenario>_<expected>` without a `test_` prefix.
rules/rust/testing.md mentions a `test_` prefix as the rule; we follow
the codebase here because all ~25 existing tests in
`codex/transcript.rs` already omit it and matching them keeps the file
internally consistent (see "deviation log" at the bottom of section 5).

| Layer                        | Target                          | Count |
| ---------------------------- | ------------------------------- | ----- |
| Unit — `extract_session_cwd` | Pure extraction logic           | 7     |
| Unit — transition state      | `process_line`'s last_cwd dedup | 3     |
| End-to-end — `start_tailing` | Watcher → `FakeEventSink`       | 1     |

### 5.2 `extract_session_cwd` unit tests (7)

Drives the helper directly with hand-built `serde_json::Value`s. No
filesystem, no threads.

| Test                                               | Input shape                                                               | Expected                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `extract_session_cwd_session_meta_returns_cwd`     | `{"type":"session_meta","payload":{"cwd":"/x"}}`                          | `Some("/x")`                                                                 |
| `extract_session_cwd_turn_context_returns_cwd`     | `{"type":"turn_context","payload":{"cwd":"/x"}}`                          | `Some("/x")`                                                                 |
| `extract_session_cwd_event_msg_returns_none`       | `{"type":"event_msg","payload":{"cwd":"/x"}}`                             | `None` _(defensive — even if payload carried cwd, the type gate rejects it)_ |
| `extract_session_cwd_response_item_returns_none`   | `{"type":"response_item","payload":{"arguments":"{\"workdir\":\"/x\"}"}}` | `None` _(workdir is per-command, not session cwd)_                           |
| `extract_session_cwd_missing_payload_returns_none` | `{"type":"turn_context"}`                                                 | `None`                                                                       |
| `extract_session_cwd_missing_cwd_returns_none`     | `{"type":"turn_context","payload":{}}`                                    | `None`                                                                       |
| `extract_session_cwd_empty_string_returns_none`    | `{"type":"turn_context","payload":{"cwd":""}}`                            | `None`                                                                       |

### 5.3 Transition semantics tests (3)

Drive `process_line` through a sequence of lines on a `FakeEventSink`
from `crate::runtime`. Each test sets up an empty `last_cwd: None`,
calls `process_line` N times, then asserts the recorded events.

| Test                                   | Sequence                                                              | Expected `agent-cwd` count |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `process_line_first_cwd_always_emits`  | `session_meta(cwd=A)`                                                 | 1 (cwd=A)                  |
| `process_line_repeated_cwd_suppresses` | `session_meta(cwd=A)` → `turn_context(cwd=A)` → `turn_context(cwd=A)` | 1 (cwd=A)                  |
| `process_line_cwd_transition_emits`    | `session_meta(cwd=A)` → `turn_context(cwd=B)` → `turn_context(cwd=A)` | 3 (A, B, A)                |

These intentionally bypass `start_tailing`'s thread/IO/poll machinery —
the same approach Claude's `claude_code/transcript.rs` tests use for
its parsing-shape unit tests.

### 5.4 End-to-end watcher test (1)

`start_tailing_emits_cwd_transitions_in_order` — inline-JSON, mirrors
the existing `start_tailing_replays_tool_calls_turns_and_test_runs`
test in the same file (around line 791), which uses the existing
`write_rollout(&Path, &[Value])` helper. No external fixture file —
matches the convention used by both `codex/transcript.rs`'s e2e test
and `claude_code/transcript_fixture_tests.rs`'s `std::fs::write` style
test setup.

```rust
#[test]
fn start_tailing_emits_cwd_transitions_in_order() {
    let sink = Arc::new(FakeEventSink::new());
    let tmp = tempfile::tempdir().expect("tempdir");
    let transcript_path = tmp.path().join("rollout.jsonl");

    // 6 lines, 3 expected emissions:
    //   1. session_meta cwd=/workspace/A   (emit)
    //   2. turn_context cwd=/workspace/A   (suppressed — same as last)
    //   3. turn_context cwd=/workspace/B   (emit)
    //   4. event_msg noise                 (no cwd emit; not a cwd carrier)
    //   5. response_item noise             (no cwd emit; not a cwd carrier)
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
        None,  // cwd not needed for this test
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

    assert_eq!(cwd_events.len(), 3);
    assert_eq!(cwd_events[0]["cwd"], "/workspace/A");
    assert_eq!(cwd_events[1]["cwd"], "/workspace/B");
    assert_eq!(cwd_events[2]["cwd"], "/workspace/A");
    for ev in &cwd_events {
        assert_eq!(ev["sessionId"], "sid-cwd");
    }
}
```

### 5.5 ts-rs regeneration verification

`AgentCwdEvent` already carries `#[cfg_attr(test, derive(ts_rs::TS))]` +
`ts(export)`. Running `cargo test --lib` regenerates
`src/bindings/AgentCwdEvent.ts` with the updated doc comment.
Verification:

- After running tests once locally, `git diff src/bindings/AgentCwdEvent.ts`
  should show the doc-comment block changing to mention both adapters'
  shapes (Claude per-line, Codex per-turn).
- This is committed alongside the Rust change so reviewers see the
  regenerated binding match the spec.

### 5.6 Commands

```bash
# Unit + integration tests for the backend crate
cargo test -p vimeflow --lib

# Specifically the new tests
cargo test -p vimeflow --lib codex::transcript::tests::extract_session_cwd
cargo test -p vimeflow --lib codex::transcript::tests::process_line
cargo test -p vimeflow --lib start_tailing_emits_cwd_transitions

# Husky pre-push (vitest only) — the actual gate before push
npm test

# Local recommended gates (run before requesting review)
npm run lint
npm run format:check
npm run type-check
```

### 5.7 Coverage expectation

- New code: 100% covered (every branch in `extract_session_cwd` has a
  dedicated unit test; transitions exercise both first-cwd and dedup
  paths; the e2e test covers the read-loop integration).
- File-level coverage stays ≥80% per rules/common/testing.md.

### 5.8 Deviation log

- **Test naming.** `rules/rust/testing.md` recommends a
  `test_<function>_<scenario>_<expected>` convention. The codebase
  uniformly omits the `test_` prefix (e.g., `validate_transcript_path_accepts_file_under_codex_root`,
  `parse_tool_use_from_assistant_line`). New tests in this PR follow
  the codebase convention for local consistency; updating the rule
  doc is out of scope here but is a one-line follow-up if the team
  wants the rule to match practice.
