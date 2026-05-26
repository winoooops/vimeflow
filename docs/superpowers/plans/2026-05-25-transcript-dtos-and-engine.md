# Transcript DTOs & Shared Tailer Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type the two transcript JSONL parsers with lenient DTOs (A-transcript, option B) and collapse their duplicated tail loops into one shared `TranscriptTailService` + injected `TranscriptDecoder` (C), gated by a test-hardening Phase 0.

**Architecture:** Three sequential PRs against `refactor/agent-adapter` — Phase 0 (characterization tests, no production change) → Phase 1 (A-transcript DTOs) → Phase 2 (C engine). Frozen constraints (F-EVENTS + the two-sided G3 carve-out, F-CONCURRENCY, F-ATTACH, F-BINDINGS) hold throughout. **The authoritative field/contract reference is the spec — `docs/superpowers/specs/2026-05-25-transcript-dtos-and-engine-design.md` (§ N citations below point into it).**

**Tech Stack:** Rust (`crates/backend`), `serde` / `serde_json`, `cargo test`. Frontend untouched (transcript DTOs are internal — no `#[derive(TS)]`).

**Conventions for every task:**
- Commit type `test:` for Phase 0, `feat:`/`refactor:` for Phase 1/2, per commitlint. End commit bodies with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- After any `cargo test`, if `git status` shows `src/bindings/` churn, `git restore src/bindings/` before committing (ts-rs regenerates raw files; F-BINDINGS).
- The crate's **package name is `vimeflow`** (`crates/backend/Cargo.toml`); `vimeflow-backend` is only the *binary target*. So all Cargo commands use `-p vimeflow` (never `-p vimeflow-backend`).
- Run a single Rust test with `cargo test -p vimeflow <test_name> -- --nocapture`. Cargo accepts only **one** filter before `--`; run multiple test names as separate commands.
- For any task that **creates** a new file, `git add <path>` before committing — `git commit -am` stages only already-tracked files.

---

## File Structure

**Phase 0 (tests only):**
- Modify: `crates/backend/src/agent/adapter/claude_code/transcript_fixture_tests.rs` — add Claude `T-replay`.
- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` (`#[cfg(test)] mod tests`) — add Codex `T-replay`.

**Phase 1 (A-transcript):**
- Modify: `crates/backend/src/agent/adapter/serde_helpers.rs` — add `lenient_bool`, `lenient_i64` (+ tests).
- Create: `crates/backend/src/agent/adapter/claude_code/transcript_dto.rs` — Claude line/message/block DTOs.
- Create: `crates/backend/src/agent/adapter/codex/transcript_dto.rs` — Codex envelope + per-`type` payload DTOs + inner arg/output DTOs.
- Modify: `claude_code/transcript.rs`, `codex/transcript.rs` — migrate `process_line` bodies to DTOs; retarget helpers; `use super::transcript_dto::…`.
- Modify: `claude_code/mod.rs`, `codex/mod.rs` — declare `mod transcript_dto;` here. **A sibling-module declaration must live in the parent `mod.rs`** (exactly like the existing `mod statusline;`); declaring `mod transcript_dto;` *inside* `transcript.rs` would resolve to `transcript/transcript_dto.rs` and fail to find the sibling file.

**Phase 2 (C engine):**
- Create: `crates/backend/src/agent/adapter/base/transcript_tail_service.rs` — `TranscriptDecoder` trait + `TranscriptTailService` + `POLL_INTERVAL`.
- Modify: `crates/backend/src/agent/adapter/base/mod.rs` — wire + re-export.
- Create/Modify: `claude_code/transcript.rs`, `codex/transcript.rs` — `<Provider>TranscriptDecoder` (move `process_line` + per-session state); thin `start_tailing`; delete `tail_loop`; add the deterministic + end-to-end buffering tests.

---

## Phase 0 — Characterization tests (PR 1, no production change)

> **Note — these are characterization tests, not classic TDD.** They pin *current* behavior, so they must **PASS against the current code**. "Expected: PASS" below means the existing behavior already satisfies the assertion; a FAIL means current behavior differs from the spec's assumption — stop and investigate, do not "fix" the test to be green. Harness: `FakeEventSink` (`runtime::FakeEventSink`) — `wait_for_count(event, count, timeout) -> bool`, `count(event) -> usize`, `recorded() -> Vec<(String, Value)>`. (Spec § 3.)

### Task 0.1: Claude `T-replay` (replay→live boundary via `test-run`)

**Files:**
- Test: `crates/backend/src/agent/adapter/claude_code/transcript_fixture_tests.rs`

- [ ] **Step 1: Read the existing harness + the replay fixture.**

Read `transcript_fixture_tests.rs` (the `transcript_emits_turn_events_for_real_user_prompts_only` test shows the `start_or_replace(adapter, sink, sid, path, cwd)` shape) and `crates/backend/tests/fixtures/transcript_vitest_replay.jsonl` (three vitest start/completion pairs; `replay_emits_only_latest_snapshot` already asserts the 3→1 collapse). Confirm the `agent-turn` / `test-run` event names via `crate::agent::events`.

- [ ] **Step 2: Write the `T-replay` test.**

```rust
#[test]
fn transcript_replay_collapses_then_live_test_run_emits() {
    let sink = Arc::new(FakeEventSink::new());
    let tmp = tempfile::tempdir().expect("temp transcript dir");
    let cwd = tmp.path().to_path_buf(); // Some(cwd) REQUIRED — test-run is skipped when cwd is None (spec § 3)
    let transcript_path = tmp.path().join("replay.jsonl");

    // Copy the checked-in fixture (≥3 test-run pairs) into the temp file —
    // NEVER tail the checked-in fixture; steps below append to it.
    let fixture = include_str!("../../../../tests/fixtures/transcript_vitest_replay.jsonl");
    std::fs::write(&transcript_path, fixture).expect("seed replay fixture");

    let state = TranscriptState::new();
    let adapter: Arc<dyn TranscriptStreamer> = Arc::new(ClaudeCodeAdapter);
    state
        .start_or_replace(adapter, sink.clone(), "sess-replay".to_string(), transcript_path.clone(), Some(cwd))
        .expect("start watcher");

    // (a) Catch-up barrier: exactly one test-run after finish_replay (3→1 collapse).
    assert!(sink.wait_for_count("test-run", 1, Duration::from_secs(5)), "replay should emit one collapsed test-run");

    // (b) Append a NEW live test-run-producing pair (a tool_use start + its tool_result completion
    //     carrying vitest output) — reuse the shapes already in the fixture.
    append_lines(&transcript_path, &[/* live start line */, /* live completion line */]);

    // (c) Drain barrier: append a sentinel (real user prompt → agent-turn), baseline-relative.
    let n0 = sink.count("agent-turn");
    append_lines(&transcript_path, &[r#"{"type":"user","timestamp":"2026-05-25T10:00:00Z","message":{"content":"sentinel"}}"#]);
    assert!(sink.wait_for_count("agent-turn", n0 + 1, Duration::from_secs(5)), "sentinel agent-turn should drain past the live pair");

    state.stop("sess-replay").ok();

    // (d) Exactly two test-run events: 1 replay-collapsed + 1 live.
    assert_eq!(sink.count("test-run"), 2, "1 replay-collapsed + 1 live");
}
```

Add a small file-local `append_lines(path, lines)` helper that opens with `OpenOptions::new().append(true)` and writes each line + `\n`. Use real Claude tool_use/tool_result lines for the live pair, mirroring the fixture's vitest shapes (a `Bash`/test-runner `tool_use` then its `tool_result` with vitest summary output).

- [ ] **Step 3: Run it — expect PASS.**

Run: `cargo test -p vimeflow transcript_replay_collapses_then_live_test_run_emits -- --nocapture`
Expected: PASS (current Claude already collapses replay + tails live). If FAIL, investigate before proceeding.

- [ ] **Step 4: Commit.**

```bash
git add crates/backend/src/agent/adapter/claude_code/transcript_fixture_tests.rs
git commit -m "test(transcript): pin Claude replay-collapse then live test-run"
```

### Task 0.2: Codex `T-replay`

**Files:**
- Test: `crates/backend/src/agent/adapter/codex/transcript.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Read the existing Codex loop test.**

Read `start_tailing_replays_tool_calls_turns_and_test_runs` (around `codex/transcript.rs:878`) — it uses `write_rollout(&path, &[json!({...}), ...])` + `FakeEventSink` + `start_tailing(...)`. Note it has only **one** `exec_command` test-runner pair; you will author **two more** (≥3 total) so the collapse (3→1) is observable.

- [ ] **Step 2: Write the `T-replay` test.**

```rust
#[test]
fn rollout_replay_collapses_then_live_test_run_emits() {
    let sink = Arc::new(FakeEventSink::new());
    let tmp = tempfile::tempdir().expect("temp dir");
    let cwd = tmp.path().to_path_buf();           // Some(cwd) REQUIRED (spec § 3)
    let path = tmp.path().join("rollout.jsonl");

    // ≥3 exec_command (start + exec_command_end) test-runner pairs in the seed file,
    // mirroring the start_tailing_replays_… shapes (session_meta first for cwd, then the pairs).
    write_rollout(&path, &[ /* session_meta */, /* pair1 start */, /* pair1 end */, /* pair2 start */, /* pair2 end */, /* pair3 start */, /* pair3 end */ ]);

    let handle = start_tailing(sink.clone(), "sess".to_string(), path.clone(), Some(cwd)).expect("start_tailing");

    assert!(sink.wait_for_count("test-run", 1, Duration::from_secs(5)), "replay collapses to one test-run");

    append_rollout(&path, &[ /* live exec_command start */, /* live exec_command_end */ ]);

    let n0 = sink.count("agent-turn");
    append_rollout(&path, &[ json!({"timestamp":"…","type":"event_msg","payload":{"type":"user_message","message":"sentinel"}}) ]);
    assert!(sink.wait_for_count("agent-turn", n0 + 1, Duration::from_secs(5)), "sentinel drains past the live pair");

    handle.stop();
    assert_eq!(sink.count("test-run"), 2, "1 replay-collapsed + 1 live");
}
```

`append_rollout(path, &[Value])` mirrors `write_rollout` but appends (`OpenOptions::append`). Use the exact `exec_command` / `exec_command_end` JSON shapes from the existing replay test (cmd `cargo test`, an `aggregated_output` with a passing test summary, `exit_code: 0`, a `duration` object).

- [ ] **Step 3: Run it — expect PASS.**

Run: `cargo test -p vimeflow rollout_replay_collapses_then_live_test_run_emits -- --nocapture`
Expected: PASS. If FAIL, investigate.

- [ ] **Step 4: Commit.**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "test(transcript): pin Codex replay-collapse then live test-run"
```

### Task 0.3: Phase 0 gate

- [ ] **Step 1:** Run the full backend suite: `cargo test -p vimeflow`. Expected: all green.
- [ ] **Step 2:** `git diff refactor/agent-adapter --stat` — confirm only test files changed (no production change). Open PR 1 → `refactor/agent-adapter`; local `codex exec` to zero findings before push (per the #246 cadence). **Do not start Phase 1 until PR 1 is green + merged.**

---

## Phase 1 — A-transcript: typed lenient DTOs (PR 2)

### Task 1.1: Add `lenient_bool` + `lenient_i64` helpers

**Files:**
- Modify: `crates/backend/src/agent/adapter/serde_helpers.rs`

- [ ] **Step 1: Write the failing helper tests** (mirror `lenient_string_accepts_strings_rejects_others`).

```rust
#[test]
fn lenient_bool_accepts_bools_rejects_others() {
    #[derive(Deserialize)]
    struct T { #[serde(default, deserialize_with = "lenient_bool")] v: Option<bool> }
    assert_eq!(serde_json::from_str::<T>(r#"{"v":true}"#).unwrap().v, Some(true));
    assert_eq!(serde_json::from_str::<T>(r#"{"v":"true"}"#).unwrap().v, None); // wrong type → None
    assert_eq!(serde_json::from_str::<T>(r#"{"v":null}"#).unwrap().v, None);
    assert_eq!(serde_json::from_str::<T>(r#"{}"#).unwrap().v, None);           // absent → None
}

#[test]
fn lenient_i64_accepts_ints_rejects_others() {
    #[derive(Deserialize)]
    struct T { #[serde(default, deserialize_with = "lenient_i64")] v: Option<i64> }
    assert_eq!(serde_json::from_str::<T>(r#"{"v":-3}"#).unwrap().v, Some(-3));
    assert_eq!(serde_json::from_str::<T>(r#"{"v":"3"}"#).unwrap().v, None);
    assert_eq!(serde_json::from_str::<T>(r#"{"v":1.5}"#).unwrap().v, None);     // non-integer → None (matches Value::as_i64)
    assert_eq!(serde_json::from_str::<T>(r#"{}"#).unwrap().v, None);
}
```

- [ ] **Step 2: Run — expect FAIL** (`lenient_bool` / `lenient_i64` not defined).

Run (Cargo takes only one filter before `--`, so run separately):
`cargo test -p vimeflow lenient_bool_accepts_bools_rejects_others`
then `cargo test -p vimeflow lenient_i64_accepts_ints_rejects_others`
Expected: FAIL (test binary won't compile — unresolved `lenient_bool` / `lenient_i64`).

- [ ] **Step 3: Implement the two helpers** (mirror `lenient_u64`'s exact one-liner style).

```rust
/// Deserialize an `Option<bool>` with wrong-type tolerance.
/// Mirrors `value.get(key).and_then(Value::as_bool)`.
pub(super) fn lenient_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?.as_bool())
}

/// Deserialize an `Option<i64>` with wrong-type tolerance.
/// Mirrors `value.get(key).and_then(Value::as_i64)`.
pub(super) fn lenient_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Value::deserialize(deserializer)?.as_i64())
}
```

- [ ] **Step 4: Run — expect PASS.** `cargo test -p vimeflow lenient_bool_accepts_bools_rejects_others` and `cargo test -p vimeflow lenient_i64_accepts_ints_rejects_others` (separately) → PASS.

- [ ] **Step 5: Commit.**

```bash
git add crates/backend/src/agent/adapter/serde_helpers.rs
git commit -m "feat(transcript): add lenient_bool and lenient_i64 deserializers"
```

### Task 1.2: Claude transcript DTOs (`transcript_dto.rs`)

**Files:**
- Create: `crates/backend/src/agent/adapter/claude_code/transcript_dto.rs`
- Modify: `claude_code/mod.rs` (add `mod transcript_dto;` — sibling decl lives in the parent `mod.rs`, like `mod statusline;`)
- Modify: `claude_code/transcript.rs` (`use super::transcript_dto::…`)

**Reference:** spec § 4 "Claude shapes" — typed scalars via lenient fields; `content` raw; `tool_use.input` via `#[serde(flatten)] rest` (presence-sensitive); `tool_result.content` raw + `extract_tool_result_content` retargeted to take the `content` value. Top-level envelope must carry `cwd` and the top-level `tool_result` shape (`claude:301`, `:326`).

- [ ] **Step 1: Create `transcript_dto.rs` with the failing tests AND wire the module** — write the `#[cfg(test)] mod tests` below into the new file, declare `mod transcript_dto;` in `claude_code/mod.rs`, and `use super::transcript_dto::…` in `transcript.rs`. (The module **must** be declared now: Rust ignores undeclared sibling files, so without the `mod` decl the red run finds zero tests and false-passes. With it declared, the tests reference not-yet-defined DTO types → the crate fails to compile = the real red.)

```rust
#[test]
fn claude_line_dto_parses_envelope_and_top_level_cwd() {
    let dto: ClaudeTranscriptLineDto =
        serde_json::from_str(r#"{"type":"assistant","cwd":"/ws","timestamp":"t","message":{"content":[]}}"#).unwrap();
    assert_eq!(dto.line_type.as_deref(), Some("assistant"));
    assert_eq!(dto.cwd.as_deref(), Some("/ws"));
}

#[test]
fn claude_tool_result_dto_is_error_is_lenient() {
    let dto: ClaudeToolResultDto = serde_json::from_str(r#"{"tool_use_id":"x","is_error":"oops","content":"c"}"#).unwrap();
    assert_eq!(dto.is_error, None); // wrong-typed is_error degrades, not errors
}

#[test]
fn claude_tool_use_dto_distinguishes_absent_vs_null_input() {
    let absent: ClaudeToolUseDto = serde_json::from_str(r#"{"id":"i","name":"Read"}"#).unwrap();
    assert!(absent.rest.get("input").is_none());                 // absent
    let nulled: ClaudeToolUseDto = serde_json::from_str(r#"{"id":"i","name":"Read","input":null}"#).unwrap();
    assert_eq!(nulled.rest.get("input"), Some(&Value::Null));    // present-null preserved
}
```

- [ ] **Step 2: Run — expect FAIL** (DTOs undefined). `cargo test -p vimeflow claude_code::transcript_dto` (module-path filter — guaranteed to match the new module's tests; a bare `transcript_dto` would also match the Codex module) → FAIL (won't compile).

- [ ] **Step 3: Define the DTOs** (the module + imports were wired in Step 1):

```rust
use serde::Deserialize;
use serde_json::{Map, Value};
use crate::agent::adapter::serde_helpers::{lenient_bool, lenient_object, lenient_string};
// Every `Option<NestedDto>` field uses `lenient_object` (spec §4) so a
// wrong-shaped nested object (e.g. `"message": 42`) degrades to `None`
// instead of failing the whole line parse.

#[derive(Deserialize, Default)]
pub(super) struct ClaudeTranscriptLineDto {
    #[serde(rename = "type", default, deserialize_with = "lenient_string")]
    pub line_type: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    pub cwd: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    pub timestamp: Option<String>,
    #[serde(default, deserialize_with = "lenient_object")]
    pub message: Option<ClaudeMessageDto>,
    // Top-level tool_result lines carry these at the top level (claude:326):
    #[serde(default, deserialize_with = "lenient_string")]
    pub tool_use_id: Option<String>,
    #[serde(default, deserialize_with = "lenient_bool")]
    pub is_error: Option<bool>,
    #[serde(default)]
    pub content: Value, // raw — extract_tool_result_content consumes it
}

#[derive(Deserialize, Default)]
pub(super) struct ClaudeMessageDto {
    #[serde(default)]
    pub content: Value, // string | array | other — classified by ported predicates, NOT a typed enum
}

#[derive(Deserialize, Default)]
pub(super) struct ClaudeToolUseDto {
    #[serde(default, deserialize_with = "lenient_string")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lenient_string")]
    pub name: Option<String>,
    // input is presence-sensitive (absent → "" vs present-null → "null"); capture via flatten:
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Deserialize, Default)]
pub(super) struct ClaudeToolResultDto {
    #[serde(default, deserialize_with = "lenient_string")]
    pub tool_use_id: Option<String>,
    #[serde(default, deserialize_with = "lenient_bool")]
    pub is_error: Option<bool>,
    #[serde(default)]
    pub content: Value, // raw
}
```

- [ ] **Step 4: Run — expect PASS.** `cargo test -p vimeflow claude_code::transcript_dto` → PASS; **confirm the summary reports the 3 new tests ran (not `0 passed`)** — a no-op filter is a false green. Fix field/visibility issues until green.

- [ ] **Step 5: Commit.**

```bash
git add crates/backend/src/agent/adapter/claude_code/transcript_dto.rs \
        crates/backend/src/agent/adapter/claude_code/mod.rs \
        crates/backend/src/agent/adapter/claude_code/transcript.rs
git commit -m "feat(transcript): add Claude transcript DTOs"
```

### Task 1.3: Retarget `extract_tool_result_content` to take the content value (Claude)

**Files:**
- Modify: `claude_code/transcript.rs`

This is a **pure refactor done *before* the DTO migration** — it still operates on raw `Value`, so it compiles and stays green standalone (Task 1.4 later feeds it `&dto.content`). `summarize_input` already takes the input *value* and the three `input` consumers (`bash_command`/`tool_file_path`/`summarize_input`, `claude:378`) keep their current args here — only `extract_tool_result_content` is retargeted.

- [ ] **Step 1: Change the signature** to `fn extract_tool_result_content(content: &Value) -> String`, deleting its internal `value.get("content")` lookup (the former `raw` becomes the `content` arg, `claude:686`).
- [ ] **Step 2: Update *all* call sites** to pass the content value: (a) the production `process_tool_result` (still on the raw block) → `extract_tool_result_content(block.get("content").unwrap_or(&Value::Null))`; (b) the **existing `extract_tool_result_content_*` tests** (F15/F1), which currently build an enclosing `serde_json::json!({ "content": … })` and pass the whole object → change them to pass the content value directly (`&value["content"]`). Both are behavior-neutral (absent and `null` both yield `""`). Missing (b) is the trap: the helper would otherwise receive `{"content": …}` and see no `content` field.
- [ ] **Step 3: Run — expect PASS.** `cargo test -p vimeflow extract_tool_result_content` (matches the F15/F1 test fns by name) → PASS; **confirm the summary reports those tests ran (not `0 passed`)**.
- [ ] **Step 4: Commit.** `git commit -am "refactor(transcript): extract_tool_result_content takes the content value"`

### Task 1.4: Migrate Claude `process_line` to DTOs + regression tests

**Files:**
- Modify: `claude_code/transcript.rs`

- [ ] **Step 1: Write the DTO/event regression tests** (drive `process_line` / `tail` and assert events survive wrong-typed + presence-sensitive inputs).

```rust
#[test]
fn process_line_emits_with_wrong_typed_is_error() {
    // A tool_result line with is_error:"oops" must still emit the tool-call event (degrade, not drop).
    // Drive via the existing in-module harness; assert agent-tool-call still fires.
}
#[test]
fn summarize_input_preserves_absent_vs_null() {
    assert_eq!(summarize_input(None), "");                 // absent
    assert_eq!(summarize_input(Some(&Value::Null)), "null"); // present-null (current behavior)
}
```

- [ ] **Step 2: Run the baseline — expect PASS.** `cargo test -p vimeflow summarize_input_preserves_absent_vs_null` and `cargo test -p vimeflow process_line_emits_with_wrong_typed_is_error` (separately) → both PASS against the *current* code (the current `.and_then(as_bool).unwrap_or(false)` / `summarize_input` already degrade gracefully). They are the regression net: the Step 3 migration must keep them green. **Confirm each reports 1 test ran (not `0`).**
- [ ] **Step 3: Migrate the `process_line` body**, shape-by-shape (spec § 4 enumerates every field + its consumer). Parse each line once via `serde_json::from_str::<ClaudeTranscriptLineDto>(line)`. **Invariant — no line ever deserialize-fails:** every `ClaudeTranscriptLineDto` field is `#[serde(default)]`/lenient, so a non-`tool_result` line simply gets `content = Value::Null`, `tool_use_id`/`is_error = None`, and a wrong-shaped `message` degrades to `None` via `lenient_object`; the DTO is therefore safe to apply to *all* line types, not just `tool_result`. Then read typed fields; classify `message.content` items with the existing ported predicates (`is_user_prompt`, `is_non_empty_user_block`, `line_type`); feed `summarize_input` / `bash_command` / `tool_file_path` the preserved raw `input`. Keep the emitted events byte-for-byte for deterministic fields.
- [ ] **Step 4: Run the full Claude transcript tests + Phase 0 `T-replay`** — `cargo test -p vimeflow claude_code` (the module-root filter covers `transcript`, `transcript_dto`, **and** the Phase 0 `transcript_fixture_tests`) → all green. Restore `src/bindings/` if perturbed.
- [ ] **Step 5: Commit.** `git commit -am "refactor(transcript): migrate Claude process_line to typed DTOs"`

### Task 1.5: Codex transcript DTOs (`transcript_dto.rs`)

**Files:**
- Create: `crates/backend/src/agent/adapter/codex/transcript_dto.rs`
- Modify: `codex/mod.rs` (declare `mod transcript_dto;` — sibling decl lives in the parent `mod.rs`, like `mod statusline;`/`mod parser;`)
- Modify: `codex/transcript.rs` (`use super::transcript_dto::…`)

**Reference:** spec § 4 "Codex shapes" — `{timestamp, type, payload}` envelope; **two-level dispatch** (top-level `type`: `session_meta`/`response_item`/`event_msg`; inner `payload.type` for BOTH `response_item` *and* `event_msg`, `codex:347`). Each dispatch is a **manual classifier over `Option<String>`** (read the tag with `lenient_string`, `match tag.as_deref()` with an `Other` default) — **not** a `#[serde(tag="type")]` + `#[serde(other)]` enum, which *errors* on a missing or non-string tag rather than falling through. Payload scalars typed lenient (`call_id`/`name`/`status`/`message`/`aggregated_output` via `lenient_string`; `success` via `lenient_bool`; `exit_code` via `lenient_i64`, `codex:571`/`:595`). Raw carve-outs: `arguments`/`output`/custom-tool `input` as `Option<String>` (`lenient_string`) re-parsed by ported helpers; `duration` via `#[serde(flatten)] rest` presence (`codex:765`). Two cwd sources preserved in order (`session_meta.cwd` then `exec_command.arguments.workdir`, `codex:100`); `turn_context.cwd` NOT a source.

- [ ] **Step 1: Create `transcript_dto.rs` with the failing tests AND wire the module** — write the tests below into the new file, declare `mod transcript_dto;` in `codex/mod.rs`, and `use super::transcript_dto::…` in `transcript.rs`. (Declare the module now — an undeclared sibling file is ignored, so the red run would find zero tests; with it declared, the tests reference not-yet-defined DTOs → compile FAIL = the real red.) Tests: top-level + inner dispatch fall-through (incl. missing/non-string `type`), `exit_code`/`success` lenient, `duration` presence (absent vs null vs object), inner `arguments` re-parse.

```rust
#[test]
fn codex_record_type_falls_through_on_unknown_missing_or_non_string() {
    // record_type() is a MANUAL classifier over Option<String>; a strict
    // #[serde(tag="type")] enum would ERROR on a missing/non-string tag.
    let unknown: CodexLineDto = serde_json::from_str(r#"{"type":"brand_new_kind","payload":{}}"#).unwrap();
    assert!(matches!(unknown.record_type(), CodexRecordType::Other));
    let missing: CodexLineDto = serde_json::from_str(r#"{"payload":{}}"#).unwrap();         // typeless
    assert!(matches!(missing.record_type(), CodexRecordType::Other));
    let nonstring: CodexLineDto = serde_json::from_str(r#"{"type":42,"payload":{}}"#).unwrap(); // non-string
    assert!(matches!(nonstring.record_type(), CodexRecordType::Other));
}
#[test]
fn codex_exec_end_exit_code_is_lenient_and_duration_presence_preserved() {
    let p: CodexExecEndPayload = serde_json::from_str(r#"{"exit_code":"bad","aggregated_output":"o"}"#).unwrap();
    assert_eq!(p.exit_code, None);                 // wrong-typed → None
    assert!(p.rest.get("duration").is_none());     // absent
    let p2: CodexExecEndPayload = serde_json::from_str(r#"{"duration":null}"#).unwrap();
    assert_eq!(p2.rest.get("duration"), Some(&Value::Null)); // present-null preserved (≠ absent)
}
```

- [ ] **Step 2: Run — expect FAIL.** `cargo test -p vimeflow codex_record_type` and `cargo test -p vimeflow codex_exec_end` → FAIL (won't compile).
- [ ] **Step 3: Define the DTOs** (module + imports wired in Step 1): (a) the envelope `CodexLineDto { #[serde(rename = "type", default, deserialize_with = "lenient_string")] type_tag: Option<String>, #[serde(default, deserialize_with = "lenient_string")] timestamp: Option<String>, #[serde(default)] payload: Value }` — `timestamp` MUST be `lenient_string` (a non-string timestamp degrades to `None` → the conversion's `unwrap_or_else(now_iso8601)` fallback fires, matching `extract_timestamp`; a plain `Option<String>` would error and drop the event) — with a manual `record_type(&self) -> CodexRecordType` matching `type_tag.as_deref()` (default `Other`); (b) the inner payload-type classifier the same way (over the payload's `type`, for both `response_item` and `event_msg`); (c) the per-`type` payload DTOs (scalars lenient; `#[serde(flatten)] rest: Map<String,Value>` on payloads that need `duration`; `arguments`/`output`/`input` as `Option<String>` via `lenient_string`; inner `CodexExecArgsDto`/`CodexCustomToolOutputDto` for the re-parsed JSON strings, `metadata.exit_code` via `lenient_i64`). Wrong-shaped payloads degrade via the `Other`/classifier path, not a hard parse error. Follow the exact field set in spec § 4.
- [ ] **Step 4: Run — expect PASS.** `cargo test -p vimeflow codex_record_type` and `cargo test -p vimeflow codex_exec_end` → PASS.
- [ ] **Step 5: Commit.** `git add crates/backend/src/agent/adapter/codex/transcript_dto.rs crates/backend/src/agent/adapter/codex/mod.rs crates/backend/src/agent/adapter/codex/transcript.rs && git commit -m "feat(transcript): add Codex transcript DTOs"`

### Task 1.6: Migrate Codex `process_line` / `process_event_msg` / `process_response_item` to DTOs

**Files:**
- Modify: `codex/transcript.rs`

- [ ] **Step 1: Write a Codex regression test** — a record with wrong-typed `exit_code` / `success` still emits the correct completion event; a `duration:null` exec_command_end still yields the `Some(0)` duration (per `exec_command_duration_ms`); a **non-string `timestamp`** still emits (falls back to `now_iso8601`, not dropped); `session_meta` AND mid-session `exec_command.arguments.workdir` both emit `agent-cwd` in order.
- [ ] **Step 2: Run — establish current behavior (PASS).** `cargo test -p vimeflow codex` (module-root filter; the regression test + existing Codex tests run green against the pre-migration code — this is the baseline).
- [ ] **Step 3: Migrate** the top-level dispatch + `process_event_msg` (inner dispatch) + `process_response_item` to the DTO enums; read scalars off the typed payloads; feed the ported helpers (`exec_command_duration_ms`, `summarize_function_call_args`, `custom_tool_output_failed`, `summarize_custom_tool_input`, `custom_tool_is_test_file`) the raw values (`rest.get("duration")`, the `Option<String>` arguments/output/input). Preserve both cwd sources + order.
- [ ] **Step 4: Run full Codex transcript tests + Phase 0 `T-replay`** — green. Restore `src/bindings/` if perturbed.
- [ ] **Step 5: Commit.** `git commit -am "refactor(transcript): migrate Codex process_line to typed DTOs"`

### Task 1.7: Phase 1 gate

- [ ] **Step 1:** `cargo test -p vimeflow` — all green (existing parse tests, Phase 0 `T-replay`, new lenient + DTO/event + presence-sensitive regression tests).
- [ ] **Step 2:** `git restore src/bindings/` if needed; confirm `git diff` scope matches spec § 4 acceptance (parse paths + DTO files + 2 helpers + retargets + tests). Open PR 2 → `refactor/agent-adapter`; local codex to zero findings; merge before Phase 2.

---

## Phase 2 — C: shared `TranscriptTailService` (PR 3)

### Task 2.1: Define the engine + wire the module

**Files:**
- Create: `crates/backend/src/agent/adapter/base/transcript_tail_service.rs`
- Modify: `crates/backend/src/agent/adapter/base/mod.rs`

- [ ] **Step 1: Define the trait + service** (spec § 5 interface).

```rust
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(500); // moved here from the per-provider modules

pub(crate) trait TranscriptDecoder: Send {
    fn decode_line(&mut self, line: &str);
    fn on_caught_up(&mut self);
}

pub(crate) struct TranscriptTailService {
    decoder: Box<dyn TranscriptDecoder>,
    provider_label: &'static str,
    poll_interval: Duration,
}

impl TranscriptTailService {
    pub(crate) fn new(decoder: Box<dyn TranscriptDecoder>, provider_label: &'static str) -> Self {
        Self { decoder, provider_label, poll_interval: POLL_INTERVAL }
    }

    #[cfg(test)]
    pub(crate) fn with_poll_interval(mut self, d: Duration) -> Self {
        self.poll_interval = d;
        self
    }

    pub(crate) fn run<R: BufRead>(mut self, mut reader: R, stop: Arc<AtomicBool>) {
        let mut line_buf = String::new();
        let mut partial = String::new();
        while !stop.load(Ordering::Acquire) {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => { self.decoder.on_caught_up(); std::thread::sleep(self.poll_interval); }
                Ok(_) => {
                    if !line_buf.ends_with('\n') { partial.push_str(&line_buf); continue; }
                    let full = if partial.is_empty() { line_buf.as_str() }
                               else { partial.push_str(&line_buf); partial.as_str() };
                    let trimmed = full.trim_end_matches(['\r', '\n']); // char-array Pattern; already used at runtime/ipc.rs:275, so it compiles on this repo's toolchain (use `&['\r','\n'][..]` only if MSRV ever regresses)
                    if !trimmed.trim().is_empty() { self.decoder.decode_line(trimmed); }
                    partial.clear();
                }
                Err(e) => { log::warn!("Error reading {} line: {}", self.provider_label, e); std::thread::sleep(self.poll_interval); }
            }
        }
    }
}
```

- [ ] **Step 2: Wire `base/mod.rs`** — add `mod transcript_tail_service;` and `pub(crate) use transcript_tail_service::{TranscriptDecoder, TranscriptTailService};` (mirroring the `transcript_state` re-export). **Do not** add the `#[cfg(test)]` test-helper re-export yet — those items don't exist until Task 2.2, so referencing them now would leave a committed state where `cargo test` fails to compile. (Task 2.2 adds both the helpers and their re-export together.)
- [ ] **Step 3: Build.** `cargo build -p vimeflow` → compiles (unused warnings OK until wired).
- [ ] **Step 4: Commit.** `git add crates/backend/src/agent/adapter/base/transcript_tail_service.rs crates/backend/src/agent/adapter/base/mod.rs && git commit -m "feat(transcript): add TranscriptTailService + TranscriptDecoder skeleton"`

### Task 2.2: Deterministic engine buffering tests (`ScriptedBufRead` + recording decoder)

**Files:**
- Modify: `base/transcript_tail_service.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Add cross-module test support** — define `ScriptedBufRead`, `Step`, and `RecordingDecoder` as **`#[cfg(test)] pub(crate)`** items at **module level** in `transcript_tail_service.rs` (NOT inside a private `mod tests`), **and add the re-export to `base/mod.rs`** in this same task: `#[cfg(test)] pub(crate) use transcript_tail_service::{ScriptedBufRead, Step, RecordingDecoder};`. (Both land here together so no intermediate commit references missing items.) Task 2.3's `claude_code` test then imports `crate::agent::adapter::base::{ScriptedBufRead, Step, RecordingDecoder}` through the re-export — the private module path is not reachable from a sibling.

```rust
#[cfg(test)]
pub(crate) enum Step { Chunk(&'static str), Eof, EofStop, Err } // Eof = non-terminal Ok(0); EofStop also flips `stop`; Err = one read failure

#[cfg(test)]
pub(crate) struct ScriptedBufRead { pub steps: std::vec::IntoIter<Step>, pub stop: Arc<AtomicBool> }

#[cfg(test)]
impl std::io::Read for ScriptedBufRead {
    fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { unreachable!("run only calls read_line") }
}
#[cfg(test)]
impl std::io::BufRead for ScriptedBufRead {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> { unreachable!() }
    fn consume(&mut self, _: usize) {}
    fn read_line(&mut self, buf: &mut String) -> std::io::Result<usize> {
        match self.steps.next() {
            Some(Step::Chunk(s)) => { buf.push_str(s); Ok(s.len()) }
            Some(Step::Err) => Err(std::io::Error::new(std::io::ErrorKind::Other, "scripted read error")), // service warn→sleep→continue
            Some(Step::Eof) => Ok(0),                                       // service EOF arm; loop continues
            Some(Step::EofStop) | None => { self.stop.store(true, Ordering::Release); Ok(0) } // EOF arm, then loop exits
        }
    }
}

// Shared Arc state: `run` MOVES the decoder, so the test keeps clones to inspect afterward.
#[cfg(test)]
#[derive(Clone, Default)]
pub(crate) struct RecordingDecoder {
    pub lines: Arc<std::sync::Mutex<Vec<String>>>,
    pub caught_up: Arc<std::sync::atomic::AtomicUsize>,
}
#[cfg(test)]
impl TranscriptDecoder for RecordingDecoder {
    fn decode_line(&mut self, line: &str) { self.lines.lock().unwrap().push(line.to_string()); }
    fn on_caught_up(&mut self) { self.caught_up.fetch_add(1, Ordering::Release); }
}
```

- [ ] **Step 2: Write the five cases** as named `#[test] fn`s in `#[cfg(test)] mod tests`, each driving `TranscriptTailService::new(Box::new(dec), "t").with_poll_interval(Duration::ZERO).run(ScriptedBufRead { steps, stop }, stop_clone)`, keeping `let lines = dec.lines.clone(); let caught = dec.caught_up.clone();` before the move:
  - `engine_partial_survives_eof_then_completes`: `[Chunk("{\"a\":1"), Eof, Chunk("23}\n"), EofStop]` → assert `*lines.lock().unwrap() == ["{\"a\":123}"]` (partial survived the non-terminal `Eof`).
  - `engine_truncated_partial_never_emits`: `[Chunk("{\"a\":1"), EofStop]` → assert `lines` empty AND `caught.load(Ordering::Acquire) == 1` (the partial-EOF arm ran once).
  - `engine_strips_crlf`: `[Chunk("{\"a\":1}\r\n"), EofStop]` → assert `lines == ["{\"a\":1}"]` (no trailing `\r`).
  - `engine_skips_blank_line`: `[Chunk("   \n"), EofStop]` → assert `lines` empty.
  - `engine_read_error_warns_and_continues`: `[Chunk("{\"a\":1}\n"), Err, Chunk("{\"b\":2}\n"), EofStop]` → assert `lines == ["{\"a\":1}", "{\"b\":2}"]` — the loop warns + sleeps + **continues** past the read error (pinning the frozen `error→warn→sleep` contract that Task 2.5 requires; `poll_interval` is `ZERO` so the sleep is a no-op).

- [ ] **Step 3: Run — expect PASS** — `cargo test -p vimeflow base::transcript_tail_service` (module-path filter); **confirm all five named tests ran** (not `0 passed`). Fix `run` if any fail.
- [ ] **Step 4: Commit.** `git commit -am "test(transcript): deterministic engine buffering + EOF/normalization"` (the new structs live in the already-tracked `transcript_tail_service.rs`, so `-am` is fine here).

### Task 2.3: `ClaudeTranscriptDecoder` + thin `start_tailing` (Claude)

**Files:**
- Modify: `claude_code/transcript.rs`

- [ ] **Step 1: Define `ClaudeTranscriptDecoder`** owning `events: Arc<dyn EventSink>`, `session_id: String`, `cwd: Option<PathBuf>`, `in_flight`, `num_turns`, `last_cwd`, `emitter: TestRunEmitter`. `new(events, session_id, cwd)` constructs it. Move the (Phase-1-typed) `process_line` body into `decode_line(&mut self, line: &str)`; `on_caught_up(&mut self)` calls `self.emitter.finish_replay()`.
- [ ] **Step 2: Rewrite `start_tailing`** to: open the (already-validated) file, build `ClaudeTranscriptDecoder::new(...)`, `TranscriptTailService::new(decoder, "transcript")`, spawn `move || svc.run(BufReader::new(file), stop_clone)`, return `TranscriptHandle::new(stop, join)`. Delete the old `tail_loop`. (`tail()` in `mod.rs` is unchanged — it already delegates here.)
- [ ] **Step 3: Run all Claude transcript tests + Phase 0 `T-replay`** — `cargo test -p vimeflow claude_code` → green.
- [ ] **Step 4: Add the end-to-end G3-fix test** (spec § 5) in this module's `mod tests`, importing the shared harness via the `base` re-export: `use crate::agent::adapter::base::{ScriptedBufRead, Step};`. Build the real `ClaudeTranscriptDecoder::new(events, sid, cwd)` (with a `FakeEventSink`), wrap in `TranscriptTailService::new(Box::new(dec), "transcript").with_poll_interval(Duration::ZERO)`, and `run(ScriptedBufRead { steps: vec![Step::Chunk(<first half>), Step::Eof, Step::Chunk(<second half + "\n">), Step::EofStop].into_iter(), stop: stop.clone() }, stop)` — splitting a real Claude `tool_use` line where neither half is valid JSON. Assert `FakeEventSink` records `agent-tool-call`. Run that test (`cargo test -p vimeflow claude_code`, which includes it) — expect PASS (the fix works; pre-C this event was dropped).
- [ ] **Step 5: Commit.** `git commit -am "refactor(transcript): Claude tail via TranscriptTailService + decoder"`

### Task 2.4: `CodexTranscriptDecoder` + thin `start_tailing` (Codex)

**Files:**
- Modify: `codex/transcript.rs`

- [ ] **Step 1:** Define `CodexTranscriptDecoder` (same shape; `in_flight` carries `CompletionMode`); move the typed `process_line` body into `decode_line`; `on_caught_up` → `finish_replay`.
- [ ] **Step 2:** Rewrite `start_tailing` to build the decoder + `TranscriptTailService::new(decoder, "Codex rollout transcript")` + spawn `run`. Delete the old `tail_loop`. Delete the now-unused per-provider `POLL_INTERVAL` const (use the `base` one).
- [ ] **Step 3: Run all Codex transcript tests + Phase 0 `T-replay`** — `cargo test -p vimeflow codex` (module-root filter covers `transcript` + `transcript_dto`; the Codex Phase 0 `T-replay` lives in `codex::transcript`) → green.
- [ ] **Step 4: Commit.** `git commit -am "refactor(transcript): Codex tail via TranscriptTailService + decoder"`

### Task 2.5: Phase 2 gate

- [ ] **Step 1:** `cargo test -p vimeflow` — all green (engine buffering tests, Phase 0 `T-replay` unchanged, end-to-end G3 test, all parse tests). Confirm both `tail_loop`s are gone (`grep -rn "fn tail_loop" crates/backend/src` → no matches).
- [ ] **Step 2:** `git restore src/bindings/` if needed. Verify frozen constraints hold: events shape/deterministic-field equivalent (+ the two-sided G3 carve-out); `Ordering::Acquire` stop, `POLL_INTERVAL`, first-EOF `on_caught_up`, and `error→warn→sleep` (pinned by `engine_read_error_warns_and_continues`, Task 2.2) preserved. Open PR 3 → `refactor/agent-adapter`; local codex to zero findings; merge.
- [ ] **Step 3:** Update #246: tick **A-transcript** + **C**; add **Step F** (spec § 6) as a deferred-capstone line.

---

## Self-Review notes (for the author before execution)

- **Spec coverage:** Phase 0 (§ 3) → Tasks 0.1–0.3; Phase 1 (§ 4) → 1.1–1.7 (lenient helpers, both DTO files, retargets, both migrations, presence-sensitive + wrong-typed regression tests); Phase 2 (§ 5) → 2.1–2.5 (engine, deterministic tests, both decoders, thin `start_tailing`, end-to-end G3, `tail_loop` deletion); Step F (§ 6) is deferred (no task — only the #246 note in 2.5). Frozen constraints (§ 2) are gate checks in 0.3 / 1.7 / 2.5.
- **Known under-specification (intentional):** the per-site `process_line` migrations (Tasks 1.4 / 1.6) give the transformation *pattern* + the typed DTOs + the regression test net rather than enumerating all ~46/~55 sites verbatim — the spec § 4 is the exhaustive field reference, and the existing parse tests + new regression tests catch any missed site. The `ScriptedBufRead` script representation (Task 2.2) is sketched as a `Vec<Step>` enum; the author finalizes the exact enum.
- **Type consistency:** decoder API is `decode_line(&mut self, line: &str)` / `on_caught_up(&mut self)` everywhere; service is `TranscriptTailService::new(decoder, label)` + `run<R: BufRead>(mut self, reader, stop)`; provider labels `"transcript"` (Claude) / `"Codex rollout transcript"` (Codex) feed `"Error reading {label} line: {e}"`.
