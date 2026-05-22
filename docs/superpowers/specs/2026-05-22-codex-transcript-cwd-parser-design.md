# 2026-05-22 — Codex transcript cwd parser design (v2)

> **Revision history.** v1 of this spec (commits `36c7bae` → `45da21c`)
> assumed Codex updates `turn_context.payload.cwd` per turn. Codex
> implemented v1 faithfully (commits `cab6b73` → `dd95857`) but the
> feature did not work end-to-end: in a real codex session the user
> verified, `turn_context.cwd` only ever carried the session's
> **starting** cwd, never the post-cd value. v1's implementation +
> codex-reviewed footers were reverted; v2 (this spec) replaces v1's
> extraction model with one rooted in the actual `cli_version 0.132.0`
> rollout schema.

## 1. Summary

PR #239 added a structured `agent-cwd` event channel for the Claude
Code transcript watcher
(`crates/backend/src/agent/adapter/claude_code/transcript.rs`). That
channel is the load-bearing path for keeping `pane.cwd` in sync when
an agent moves between worktrees via in-process tool calls that
intentionally don't mutate the interactive shell's `$PWD` (Claude's
built-in `EnterWorktree`, Superpowers' worktree skill, etc.). Without
it, OSC 7 and the text-pattern `agentCwdHint` paths are structurally
blind to those moves and the per-pane chip pins to the starting
checkout.

PR #239's "Follow-ups" list named the matching work for the Codex
adapter as the next small piece on top of that foundation. v1 of this
spec read that note as "look at `payload.cwd` on `session_meta` and
`turn_context`". Empirical verification against real `cli_version
0.132.0` rollouts on disk — including the session where the user told
codex to switch to `.claude/worktrees/codex-dummy-worktree` — proved
that reading wrong:

- **`session_meta.payload.cwd`** is set ONCE at session start and
  pinned. ✓ correct for "where did the session start".
- **`turn_context.payload.cwd`** is repeated on every turn but always
  equals the session-start cwd. It does NOT update when codex moves.
  v1 spec assumed it does; in practice it does not. **v2 intentionally
  IGNORES this field** — see "Why we skip `turn_context.cwd`" below.
- **`response_item.payload.arguments.workdir`** (for `exec_command`
  function calls) DOES update — every time codex runs a command in a
  different directory, the `workdir` field on that function-call
  reflects the new directory. This is codex's de facto mid-session
  cwd signal.

v2 therefore extracts cwd from **two sources**:

1. `session_meta.payload.cwd` — first transition at session start.
2. `response_item.payload.arguments.workdir` (parsed JSON, scoped to
   `payload.name == "exec_command"`) — the mid-session signal.

**Why we skip `turn_context.cwd`.** It carries no information beyond
`session_meta.cwd` (always equal). Worse: treating it as a live cwd
source creates a regression. Sequence: `session_meta(A)` →
`exec_command.workdir(B)` would correctly emit `agent-cwd=A` then
`agent-cwd=B`. But the NEXT turn's `turn_context(A)` (still pinned to
session start) would then emit `agent-cwd=A` again, falsely reverting
the pane chip to the starting checkout on every reasoning-only turn.
The codex review on this spec (HIGH finding 2026-05-22) caught this
hazardous ordering. Dropping `turn_context` from the source list
removes the bug at the design level. If future Codex versions
actually start updating `turn_context.cwd` mid-session, we'd add it
back behind a schema-version gate — but that's not a current
problem.

Transition semantics carry over from PR #239: track `last_cwd:
Option<String>` across calls; emit `AgentCwdEvent` only on changes;
empty strings filtered at the extraction site. Frontend wiring is
already agent-type-agnostic and picks up Codex transitions
automatically.

**Practical effect** of v2 vs v1: when codex tells the user "I'll use
this worktree for subsequent commands", every subsequent `exec_command`
carries the new workdir. The first such command emits an `agent-cwd`
transition, and the pane chip + git branch follow. v1 would have
emitted nothing (no `turn_context` update).

### 1.1 What v2 keeps from v1

- The frontend side stays untouched (`useAgentStatus`,
  `WorkspaceView`, pane state are already wired generically via PR
  #239 commit 5).
- The doc-comment correction on `AgentCwdEvent` in
  `crates/backend/src/agent/types.rs` (still needs to drop the
  "pending follow-up" / "every transcript JSONL entry" language).
- Two frontend JSDoc-comment corrections (same stale language).
- The transition-only emission contract and `last_cwd` dedup.

### 1.2 What v2 changes from v1

- Extraction logic is split into three helper functions (one per
  source plus a dispatcher).
- `extract_session_cwd` matches `session_meta` ONLY (not
  `turn_context` — see "Why we skip `turn_context.cwd`" above).
- New `extract_exec_workdir` helper for the mid-session signal.
- New `extract_codex_cwd` dispatcher.
- The doc comments and spec now correctly describe Codex's per-source
  semantics — "session start from `session_meta`, mid-session from
  `exec_command.workdir`" — rather than v1's "session_meta +
  turn_context per-turn".

## 2. Scope

### In scope

Behavior change in one implementation file; doc-comment and JSDoc
edits in three further files complete the work cleanly:

- **Behavior:** `crates/backend/src/agent/adapter/codex/transcript.rs`
  — the actual extraction + emission logic. Two sources:
  `session_meta.payload.cwd` (session-start anchor) and
  `response_item.payload.arguments.workdir` (mid-session signal, parsed
  JSON; scoped to function calls named `exec_command`).
  **`turn_context.cwd` is intentionally NOT a source** — it would
  cause false reverts. See 1.1.
- **Doc-comment fix** on `AgentCwdEvent` in
  `crates/backend/src/agent/types.rs` (currently says cwd is sourced
  from "the structured `cwd` field that Claude Code (and Codex,
  **pending follow-up**) writes on **every** transcript JSONL entry"
  — this PR _is_ that follow-up, and the "every entry" claim is
  wrong for both adapters now). The ts-rs binding at
  `src/bindings/AgentCwdEvent.ts` is regenerated from the Rust
  doc-comment via `npm run generate:bindings`.
- **Frontend comment fixes** (no behavior change):
  - `src/features/agent-status/types/index.ts` (around line 54–62,
    the `cwd: string | null` field on the agent-status state).
  - `src/features/workspace/WorkspaceView.tsx` (around line 315–321,
    the comment above the `agentStatus.cwd → updatePaneCwd` bridge).
- Add private helpers in `codex/transcript.rs`:
  - `extract_session_cwd(&Value) -> Option<&str>` — pulls
    `payload.cwd` when `type == "session_meta"` ONLY (not
    `turn_context`). Empty-string filtered out.
  - `extract_exec_workdir(&Value) -> Option<String>` — pulls
    `payload.arguments.workdir` when `type == "response_item"` AND
    `payload.type == "function_call"` AND `payload.name ==
"exec_command"`. Requires parsing the `arguments` string as
    JSON (it is a JSON-encoded string per Codex's schema).
  - `extract_codex_cwd(&Value) -> Option<String>` — dispatcher that
    tries `extract_session_cwd` first, falls back to
    `extract_exec_workdir`. Returns `Option<String>` because the
    workdir path requires owned strings (parsed JSON allocates).
- Add `last_cwd: Option<String>` state to the `tail_loop` and thread
  it through `process_line`.
- Emit `AgentCwdEvent` via the existing `emit_agent_cwd` helper on
  transitions only (first observed cwd always fires; repeated
  identical cwd values do not re-emit). Same contract as Claude.
- Imports: `crate::agent::events::emit_agent_cwd` and
  `crate::agent::types::AgentCwdEvent`.
- Unit-test coverage:
  - 4 tests for `extract_session_cwd` (session_meta positive;
    `turn_context` REJECTED — defensive against re-introduction;
    missing payload; empty string).
  - 6 tests for `extract_exec_workdir` (happy path; wrong event
    type; wrong function-call type; wrong tool name; malformed
    arguments JSON; missing workdir).
  - 4 transition-semantics tests covering first-emit, dedup across
    sources, multi-source transitions (session_meta → exec_command
    workdir), AND the regression case
    (`session_meta(A) → exec_command(B) → turn_context(A)` MUST NOT
    emit a third `agent-cwd=A` revert).
  - 1 end-to-end fixture-driven test in `start_tailing` that
    includes a `turn_context(A)` line after an `exec_command(B)` to
    guard against re-introduction of the bug at the integration
    layer.

### Out of scope (deferred, not lost)

- **Issue #234** — persisted-session-cache refactor that reshapes the
  flat PTY cache into a session→pane graph with per-pane cwd. The
  agent-cwd channel this spec lands is a prerequisite for #234's
  per-pane cwd persistence to work for Codex panes, but the schema
  change itself is a separate spec/PR.
- **Shell-pwd-doesn't-inherit-from-pane-1** — newly opened shell
  panes don't start in the active pane's cwd. Separate root-cause
  investigation needed in the terminal/PTY spawn path; not in this
  PR.
- **Pruning the now-redundant `agentCwdHint` text patterns in
  `Body.tsx`** — PR #239's other "Follow-ups" item; deferred until
  both Claude and Codex adapters' structured channels have been
  validated in production. OSC 7 and the Claude-startup-banner
  home-cwd resolution stay either way — they cover
  interactive-shell `cd` cases the JSONL channel doesn't see.
- **`codex/transcript.rs` is already 953 lines** (rules say ≤400
  typical, ≤800 max). This PR adds ~50 lines of behavior + ~250
  lines of tests, pushing it further over. Splitting is a separate
  refactor PR; calling it out so the debt is visible and not
  silently accumulating.
- **`codex/parser.rs` changes** — none needed. The status-snapshot
  path consumes `AgentStatusEvent`, which has no `cwd` field; adding
  one would require a frontend change with no current consumer.
- **`apply_patch` workdir** — `custom_tool_call` with
  `name == "apply_patch"` doesn't carry a `workdir` field (the
  `input` is the patch payload itself). Patches are applied relative
  to codex's current command context, which we track via
  `exec_command.workdir`, so no new source needed.
- **`local_shell_call` / future tool variants** — only
  `exec_command` is in scope. If Codex adds more cwd-bearing tool
  types, that's a follow-up. Conservative-by-design.

### PR scope discipline

One PR, one question: _Does the Codex transcript emit `agent-cwd`
events on real cwd transitions, including mid-session worktree
switches via codex's command-context navigation?_ No drive-by
refactors, no incidental file moves, no unrelated test cleanup.

## 3. Data flow & extraction shape

### 3.1 Codex rollout JSONL shape (verified against `cli_version 0.132.0`)

Each rollout JSONL line carries `timestamp`, `type`, and `payload`.
The cwd-carrying shapes are:

```jsonl
{"timestamp":"…","type":"session_meta","payload":{"id":"…","cwd":"/abs/path","cli_version":"0.132.0", …}}
{"timestamp":"…","type":"turn_context","payload":{"turn_id":"…","cwd":"/abs/path","model":"gpt-5.4", …}}
{"timestamp":"…","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\",\"workdir\":\"/abs/path\"}","call_id":"…"}}
```

Empirical findings from rollouts on disk:

- `session_meta.cwd` carries the **session's starting cwd** and is
  pinned for the life of the session.
- `turn_context.cwd` is repeated on every turn and equals
  `session_meta.cwd` in every rollout checked, even across long
  sessions where codex was instructed to switch worktrees.
  **v2 ignores this field** — it is information-free at best and a
  source of false-revert bugs at worst. See "Why we skip
  `turn_context.cwd`" in section 1.
- `exec_command.arguments` is a JSON-encoded **string**, not a
  nested object. Parsing it yields `{cmd, workdir, …}`. The
  `workdir` is codex's actual mid-session working directory and
  changes when codex switches its "command context".
- `event_msg` types (`task_started`, `task_complete`, `token_count`,
  `exec_command_end`, `patch_apply_end`, etc.) do NOT carry cwd
  signals.
- `response_item` with `function_call` and other tool names (e.g.
  `read_file`, `write_file` if Codex adds them) MAY carry their own
  per-call paths but those are tool inputs, not session cwd.
  v2 deliberately scopes `extract_exec_workdir` to
  `name == "exec_command"` only.

### 3.2 Extraction helpers

Three private helpers in `transcript.rs`. The dispatcher pattern
keeps each individual helper small and unit-testable.

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

/// Pull the mid-session workdir off a Codex `exec_command` function-call
/// rollout entry. This is codex's de facto session cwd after the start
/// (verified empirically — `turn_context.cwd` does not update on
/// codex-driven cwd changes; `exec_command.arguments.workdir` does).
///
/// `arguments` is a JSON-encoded string per Codex's rollout schema —
/// it must be parsed before reading `workdir`. Malformed JSON, missing
/// fields, or empty strings all short-circuit to `None`.
fn extract_exec_workdir(value: &Value) -> Option<String> {
    let payload = value.get("payload")?;
    if value.get("type").and_then(Value::as_str)? != "response_item" {
        return None;
    }
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

/// Dispatcher returning the observed cwd from whichever source carries
/// it. Tries the session_meta/turn_context path first (cheap, no JSON
/// re-parse), falls back to the exec_command workdir path. Returns
/// `Option<String>` because the workdir path must return owned strings.
fn extract_codex_cwd(value: &Value) -> Option<String> {
    if let Some(cwd) = extract_session_cwd(value) {
        return Some(cwd.to_string());
    }
    extract_exec_workdir(value)
}
```

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
        Some("response_item") => { /* unchanged */ }
        Some("event_msg")     => { /* unchanged */ }
        _ => {}
    }
}
```

Note: the cwd extraction runs BEFORE the existing match, so an
`exec_command` line emits its `agent-cwd` (when transitioning) AND
then flows into the normal `response_item` arm that records the tool
call. No double-processing — these are orthogonal concerns.

### 3.4 `tail_loop` state

Add `let mut last_cwd: Option<String> = None;` next to the existing
`num_turns` declaration. Thread it through to both `process_line`
call sites in the read loop (single-line + partial-line branches).

### 3.5 Transition semantics

- **First observed cwd always emits.** `last_cwd: None` →
  `map_or(true, …)` short-circuits true on the first hit. Matches
  Claude.
- **Repeated identical cwd suppresses.** Multiple `exec_command`s
  with the same workdir, or session_meta+turn_context both at
  session-start, emit only the first.
- **Empty strings filtered at extraction sites.** Both helpers
  `filter(|s| !s.is_empty())`.
- **Malformed JSON skipped silently.** `serde_json::from_str` early
  return at top of `process_line`; the nested
  `serde_json::from_str(arguments)` inside `extract_exec_workdir`
  returns `None` on parse error.
- **Missing payload / missing field / wrong type → silently `None`.**
  All `?` and `.and_then(…)` short-circuits.
- **Temporal granularity is per-exec_command, not per-line and not
  per-turn.** Codex emits cwd transitions whenever it runs a tool
  command in a new directory — typically the first exec_command
  after a "switch to worktree X" instruction. The pane chip catches
  up to the new cwd on that first exec_command, usually within ~1s
  of codex's "switching to" message.
- **Reasoning-only turns don't emit.** A turn that produces only
  text + thinking (no tool calls) won't emit a transition. This is
  correct — codex hasn't "moved" yet, it's just thinking. The next
  exec_command (or new session_meta on reattach) fires.
- **`turn_context` lines never emit.** Even though they carry a
  `payload.cwd` field, the extractor dispatcher does not look at
  them. This is the v2-codex-review fix: treating `turn_context.cwd`
  as a live cwd would cause a false revert after every
  reasoning-only turn that follows an `exec_command.workdir`
  transition.

## 4. Components & files

### 4.1 Files changed

| File                                                   | Change                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/backend/src/agent/adapter/codex/transcript.rs` | Add 3 helpers (`extract_session_cwd`, `extract_exec_workdir`, `extract_codex_cwd`), thread `last_cwd: Option<String>` through `tail_loop` + `process_line`, add cwd extraction + transition emission, expand imports, 15 new tests (4 session_cwd + 6 exec_workdir + 4 transition + 1 e2e). |
| `crates/backend/src/agent/types.rs`                    | Edit the doc comment above `AgentCwdEvent` (line ~157–164) to describe both adapters' real shapes (Claude per-line, Codex per-exec_command).                                                                                                                                                |
| `src/bindings/AgentCwdEvent.ts`                        | Regenerated by `npm run generate:bindings`. Not hand-edited.                                                                                                                                                                                                                                |
| `src/features/agent-status/types/index.ts`             | Doc-only — update the JSDoc block above `cwd: string \| null` (around lines 54–62) to match the corrected source description. No type change.                                                                                                                                               |
| `src/features/workspace/WorkspaceView.tsx`             | Doc-only — update the comment block above the `agentStatus.cwd → updatePaneCwd` bridge (around lines 315–321). No behavior change.                                                                                                                                                          |

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
  comment blocks change (see 4.1), and those changes are
  non-functional.

### 4.3 Helper signatures (full code in 3.2)

Three private functions added near the top of `codex/transcript.rs`,
above `validate_transcript_path`:

```rust
fn extract_session_cwd(value: &Value) -> Option<&str>          // session_meta + turn_context
fn extract_exec_workdir(value: &Value) -> Option<String>       // response_item function_call exec_command
fn extract_codex_cwd(value: &Value) -> Option<String>          // dispatcher
```

### 4.4 `process_line` signature extension

Adds one parameter at the end (matching Claude's call shape so the
two adapters' `process_line` signatures stay structurally aligned):

```rust
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

Threaded into both `process_line(…)` call sites in the read loop
(the single-line branch and the partial-line branch).

### 4.6 Updated `AgentCwdEvent` doc comment

Replace the current text (`crates/backend/src/agent/types.rs:157–164`)
with:

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

The ts-rs regeneration is via `npm run generate:bindings` (see 5.5).

## 5. Testing strategy

### 5.1 Test inventory

Three layers, all co-located in `codex/transcript.rs` (per
rules/rust/testing.md: `#[cfg(test)] mod tests` at file bottom).
Test names omit the `test_` prefix to match the existing convention
in the file.

| Layer                         | Target                                         | Count |
| ----------------------------- | ---------------------------------------------- | ----- |
| Unit — `extract_session_cwd`  | session_meta + turn_context paths              | 4     |
| Unit — `extract_exec_workdir` | response_item function_call paths              | 6     |
| Unit — transition state       | `process_line`'s last_cwd dedup across sources | 3     |
| End-to-end — `start_tailing`  | Watcher → `FakeEventSink`                      | 1     |

### 5.2 `extract_session_cwd` unit tests (4)

| Test                                            | Input shape                                      | Expected                                                                  |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `extract_session_cwd_session_meta_returns_cwd`  | `{"type":"session_meta","payload":{"cwd":"/x"}}` | `Some("/x")`                                                              |
| `extract_session_cwd_turn_context_returns_none` | `{"type":"turn_context","payload":{"cwd":"/x"}}` | `None` _(turn_context is intentionally NOT a cwd source — see section 1)_ |
| `extract_session_cwd_other_type_returns_none`   | `{"type":"event_msg","payload":{"cwd":"/x"}}`    | `None`                                                                    |
| `extract_session_cwd_empty_string_returns_none` | `{"type":"session_meta","payload":{"cwd":""}}`   | `None`                                                                    |

### 5.3 `extract_exec_workdir` unit tests (6)

| Test                                                         | Input shape                                                                                     | Expected     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------ |
| `extract_exec_workdir_happy_path`                            | `response_item` / `function_call` / `exec_command` with `arguments={"cmd":"ls","workdir":"/x"}` | `Some("/x")` |
| `extract_exec_workdir_other_event_type_returns_none`         | `event_msg` carrying the same payload                                                           | `None`       |
| `extract_exec_workdir_non_function_call_returns_none`        | `response_item` with `payload.type == "custom_tool_call"`                                       | `None`       |
| `extract_exec_workdir_non_exec_command_returns_none`         | `response_item` `function_call` with `name == "read_file"`                                      | `None`       |
| `extract_exec_workdir_malformed_arguments_json_returns_none` | `arguments` is `"{not json"`                                                                    | `None`       |
| `extract_exec_workdir_missing_workdir_field_returns_none`    | `arguments={"cmd":"ls"}`                                                                        | `None`       |

### 5.4 Transition semantics tests (4)

Drive `process_line` through a sequence of lines on a
`FakeEventSink`. Each test sets up empty `last_cwd: None` + empty
`in_flight`, calls `process_line` N times, then asserts.

| Test                                                           | Sequence                                                                      | Expected `agent-cwd`                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `process_line_first_cwd_always_emits`                          | `session_meta(cwd=A)`                                                         | 1 (A)                                                  |
| `process_line_repeated_cwd_across_sources_suppresses`          | `session_meta(cwd=A)` → `exec_command(workdir=A)`                             | 1 (A)                                                  |
| `process_line_cwd_transition_across_sources_emits`             | `session_meta(cwd=A)` → `exec_command(workdir=B)` → `exec_command(workdir=A)` | 3 (A, B, A)                                            |
| `process_line_turn_context_after_exec_command_does_not_revert` | `session_meta(cwd=A)` → `exec_command(workdir=B)` → `turn_context(cwd=A)`     | 2 (A, B) _(turn_context MUST NOT cause a revert to A)_ |

The third test covers the v2 mid-session switch pattern. The fourth
test is the v2-critical regression guard: it locks in the codex
review (HIGH finding 2026-05-22) — if anyone re-adds `turn_context`
to the cwd source list, this test fires.

### 5.5 End-to-end watcher test (1)

`start_tailing_emits_cwd_transitions_in_order` — inline-JSON, mirrors
the existing `start_tailing_replays_tool_calls_turns_and_test_runs`
test (around line 791 in the file).

```rust
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
    //   5. exec_command workdir=/workspace/B         (suppressed — same)
    //   6. turn_context cwd=/workspace/A             (no emit — REGRESSION GUARD: must not revert to A)
    //   7. exec_command workdir=/workspace/A         (emit — transition back)
    write_rollout(
        &transcript_path,
        &[
            json!({"timestamp":"2026-05-22T10:00:00Z","type":"session_meta","payload":{"id":"sid","cwd":"/workspace/A"}}),
            json!({"timestamp":"2026-05-22T10:00:01Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/workspace/A"}}),
            json!({
                "timestamp":"2026-05-22T10:00:02Z",
                "type":"response_item",
                "payload":{
                    "type":"function_call",
                    "name":"exec_command",
                    "call_id":"c1",
                    "arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"
                }
            }),
            json!({"timestamp":"2026-05-22T10:00:03Z","type":"event_msg","payload":{"type":"task_started"}}),
            json!({
                "timestamp":"2026-05-22T10:00:04Z",
                "type":"response_item",
                "payload":{
                    "type":"function_call",
                    "name":"exec_command",
                    "call_id":"c2",
                    "arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/B\"}"
                }
            }),
            // Regression guard: turn_context pinned to A AFTER we moved
            // to B via exec_command must NOT cause a revert to A.
            json!({"timestamp":"2026-05-22T10:00:04.5Z","type":"turn_context","payload":{"turn_id":"t2","cwd":"/workspace/A"}}),
            json!({
                "timestamp":"2026-05-22T10:00:05Z",
                "type":"response_item",
                "payload":{
                    "type":"function_call",
                    "name":"exec_command",
                    "call_id":"c3",
                    "arguments":"{\"cmd\":\"ls\",\"workdir\":\"/workspace/A\"}"
                }
            }),
        ],
    );

    let handle = start_tailing(sink.clone(), "sid-cwd".to_string(), transcript_path, None)
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

### 5.6 ts-rs regeneration

Canonical path: `npm run generate:bindings` (expands to
`cargo test --manifest-path crates/backend/Cargo.toml export_bindings
&& prettier --write src/bindings/`). Skipping the prettier step can
leave un-formatted output that fails `npm run format:check`. The
binding regeneration is committed alongside the Rust change.

### 5.7 Commands

```bash
# Unit + integration tests for the backend crate
cargo test -p vimeflow --lib

# Specifically the new tests
cargo test -p vimeflow --lib codex::transcript::tests::extract_session_cwd
cargo test -p vimeflow --lib codex::transcript::tests::extract_exec_workdir
cargo test -p vimeflow --lib codex::transcript::tests::process_line
cargo test -p vimeflow --lib start_tailing_emits_cwd_transitions

# Regenerate the ts-rs binding (commit the result)
npm run generate:bindings

# Husky pre-push (vitest only) — the actual gate before push
npm test

# Local recommended gates (run before requesting review)
npm run lint
npm run format:check
npm run type-check
```

### 5.8 Coverage expectation

- **Extraction + transition behavior: 100% covered.** Every branch
  in `extract_session_cwd` and `extract_exec_workdir` has a
  dedicated unit test; transitions exercise first-cwd, dedup
  (including cross-source dedup), and back-and-forth paths; the
  e2e test covers the read-loop integration with all three sources
  (session_meta, turn_context, exec_command).
- **Not covered:** the `emit_agent_cwd` error branch (the
  `log::warn` on emission failure inside `process_line`). The
  branch is a defensive logging path identical to the existing
  `emit_agent_tool_call` / `emit_agent_turn` error branches in
  this file, which are also untested; covering it would require a
  `FailingEventSink` test double that doesn't exist today. Out of
  scope.
- File-level coverage stays ≥80% per rules/common/testing.md.

### 5.9 Deviation log

- **Test naming.** `rules/rust/testing.md` recommends a
  `test_<function>_<scenario>_<expected>` convention. The codebase
  uniformly omits the `test_` prefix (e.g.,
  `validate_transcript_path_accepts_file_under_codex_root`,
  `parse_tool_use_from_assistant_line`). New tests in this PR
  follow the codebase convention for local consistency.

## 6. Lessons learned from v1

This is the second iteration of the spec; the first was reverted
after codex's faithful implementation didn't actually work
end-to-end. The lesson is recorded here so future planner sessions
benefit:

- **Verify schema claims against real artifacts before specifying.**
  v1 of the spec said "Codex's `cwd` field lives only on
  `session_meta` and `turn_context`" based on a partial reading
  (those events DO carry cwd). A 30-second `grep` across
  `~/.codex/sessions/` would have shown that the value never
  changes mid-session — the actual signal lives in
  `function_call.arguments.workdir`. Codex review didn't catch
  this because the review prompt only reads the spec, not the
  domain.
- **"Field is in the same place" hints are not authoritative.** PR
  #239's follow-up text said the codex follow-up should look at
  the same field as Claude. In hindsight, that note was the right
  general direction but the WRONG specific field. Treat
  hand-written follow-up hints as starting points, not final
  schemas.
- **Test coverage at the function-helper layer doesn't catch
  schema mismatches.** All 11 v1 tests passed. The tests verified
  the helper did what the spec described, but the spec described
  the wrong thing. End-to-end verification in a running app caught
  this; unit tests alone wouldn't have.
