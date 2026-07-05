# Inline Agent Q&A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-way diff-review dispatch into a two-way thread — the agent replies with a structured JSON block, the app captures it and renders it under the comment that asked.

**Architecture:** Two sequenced PRs at the backend/frontend seam. PR-1 (VIM-283): the Codex per-line transcript decoder extracts a sentinel-wrapped reply block from `last_agent_message`, schema-validates it, and emits a typed `agent-reply` event. PR-2 (VIM-249): dispatch instructs the agent to emit the block (with a per-dispatch nonce), and the diff side correlates each `[#n]` to its comment and attaches the reply as an `author:'agent'` annotation (reusing VIM-256 rendering).

**Tech Stack:** Rust (serde, ts-rs bindings, `TranscriptDecoder` tail engine), React/TypeScript (Vitest, `window.vimeflow.listen`, the `useFeedbackBatch` store).

**Spec:** `docs/superpowers/specs/2026-07-04-inline-agent-qa-design.md` (codex-reviewed).

---

## PR-1 — VIM-283: backend reply capture (dormant-live)

Merges without a live effect: no agent emits the sentinel until PR-2 adds the dispatch instruction. Coverage is the Rust unit tests.

### Task 1: Reply event types (`types.rs`)

**Files:**

- Modify: `crates/backend/src/agent/types.rs` (add after `AgentTurnEvent`, ~line 313)

- [ ] **Step 1: Add the event types**

Mirror the existing agent-event attribute stack exactly (`pub` fields; test-gated ts-rs export):

```rust
/// A structured reply the agent emitted for an inline diff review (VIM-283).
/// `replies: None` is the malformed marker — the sentinel was present but the
/// JSON failed schema validation; `raw_text` still carries the full reply so the
/// frontend can degrade to a plain-text note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Consumed by the frontend (PR-2)
pub struct AgentReplyEvent {
    pub session_id: String,
    pub nonce: Option<String>,
    pub raw_text: String,
    pub replies: Option<Vec<AgentReply>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[allow(dead_code)]
pub struct AgentReply {
    pub id: u32,
    pub status: AgentReplyStatus,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum AgentReplyStatus {
    Answered,
    Changed,
    Skipped,
}
```

- [ ] **Step 2: Compile**

Run: `cargo build -p vimeflow-backend`
Expected: builds (types unused yet — `#[allow(dead_code)]` covers it).

- [ ] **Step 3: Commit**

```bash
git add crates/backend/src/agent/types.rs
git commit -m "feat(agent): add AgentReplyEvent types (VIM-283)"
```

### Task 2: The extraction + validation helper (`reply.rs`)

**Files:**

- Create: `crates/backend/src/agent/reply.rs`
- Modify: `crates/backend/src/agent/mod.rs` (add `mod reply;`)

- [ ] **Step 1: Write the failing tests**

Create `reply.rs` with the test module first:

```rust
//! Shared extraction + schema validation for the structured agent reply block
//! (VIM-283). Adapter-agnostic: each adapter passes the agent's completed reply
//! text; the sentinel scan, JSON parse, and schema live here once.

use crate::agent::types::{AgentReply, AgentReplyStatus};

const OPEN: &str = "<<<VIMEFLOW_REPLY";
const CLOSE: &str = "VIMEFLOW_REPLY>>>";

#[derive(Debug, PartialEq)]
pub(crate) enum AgentReplyOutcome {
    // `nonce` is best-effort: Some when the block is a parseable object with a
    // non-empty string nonce (even if other schema checks fail), None only when
    // the JSON is unparseable. The frontend nonce-gates on it, so a malformed
    // block whose nonce still matches the pending dispatch reaches the degrade
    // path; a truly unparseable one (None) is ignored — it can't be correlated.
    Malformed { raw: String, nonce: Option<String> },
    Structured { raw: String, nonce: String, replies: Vec<AgentReply> },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(json: &str) -> String {
        format!("prose before\n{OPEN}\n{json}\n{CLOSE}\nprose after")
    }

    #[test]
    fn no_sentinel_returns_none() {
        assert_eq!(extract_agent_reply("just a normal reply"), None);
    }

    #[test]
    fn valid_block_is_structured() {
        let text = block(r#"{"v":1,"nonce":"abc","replies":[{"id":1,"status":"answered","text":"hi"}]}"#);
        match extract_agent_reply(&text) {
            Some(AgentReplyOutcome::Structured { nonce, replies, .. }) => {
                assert_eq!(nonce, "abc");
                assert_eq!(replies.len(), 1);
                assert_eq!(replies[0].id, 1);
                assert_eq!(replies[0].status, AgentReplyStatus::Answered);
                assert_eq!(replies[0].text, "hi");
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }

    #[test]
    fn open_without_close_is_malformed() {
        let text = format!("{OPEN}\n{{\"v\":1}}");
        assert!(matches!(extract_agent_reply(&text), Some(AgentReplyOutcome::Malformed { .. })));
    }

    #[test]
    fn bad_json_is_malformed() {
        assert!(matches!(extract_agent_reply(&block("{not json")), Some(AgentReplyOutcome::Malformed { .. })));
    }

    #[test]
    fn schema_violations_are_malformed() {
        let cases = [
            r#"{"v":2,"nonce":"a","replies":[{"id":1,"status":"answered","text":"x"}]}"#, // bad version
            r#"{"v":1,"nonce":"","replies":[{"id":1,"status":"answered","text":"x"}]}"#,  // empty nonce
            r#"{"v":1,"nonce":"a","replies":[]}"#,                                          // empty replies
            r#"{"v":1,"nonce":"a","replies":[{"id":0,"status":"answered","text":"x"}]}"#,  // zero id (not positive)
            r#"{"v":1,"nonce":"a","replies":[{"id":-1,"status":"answered","text":"x"}]}"#, // negative id
            r#"{"v":1,"nonce":"a","replies":[{"id":1,"status":"bogus","text":"x"}]}"#,      // unknown status
            r#"{"v":1,"nonce":"a","replies":[{"id":1,"status":"answered","text":"x"},{"id":1,"status":"changed","text":"y"}]}"#, // dup id
        ];
        for case in cases {
            assert!(
                matches!(extract_agent_reply(&block(case)), Some(AgentReplyOutcome::Malformed { .. })),
                "expected Malformed for: {case}"
            );
        }
    }

    #[test]
    fn schema_invalid_but_parseable_block_keeps_the_nonce() {
        // Bad status, but the object + nonce parse → Malformed carries the nonce
        // so the frontend can still nonce-gate the degrade.
        let text = block(r#"{"v":1,"nonce":"keep","replies":[{"id":1,"status":"bogus","text":"x"}]}"#);
        assert!(matches!(
            extract_agent_reply(&text),
            Some(AgentReplyOutcome::Malformed { nonce: Some(n), .. }) if n == "keep"
        ));
    }

    #[test]
    fn unparseable_json_has_no_nonce() {
        assert!(matches!(
            extract_agent_reply(&block("{not json")),
            Some(AgentReplyOutcome::Malformed { nonce: None, .. })
        ));
    }

    #[test]
    fn multiline_text_round_trips() {
        let text = block(r#"{"v":1,"nonce":"a","replies":[{"id":2,"status":"changed","text":"line1\nline2"}]}"#);
        match extract_agent_reply(&text) {
            Some(AgentReplyOutcome::Structured { replies, .. }) => assert_eq!(replies[0].text, "line1\nline2"),
            other => panic!("expected Structured, got {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p vimeflow-backend agent::reply`
Expected: FAIL — `extract_agent_reply` not defined.

- [ ] **Step 3: Implement `extract_agent_reply`**

Add above the `#[cfg(test)]` module. Validate against a lenient serde DTO, then map to typed values so schema violations become `Malformed` rather than a parse panic:

```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct ReplyBlockDto {
    v: Option<i64>,
    nonce: Option<String>,
    replies: Option<Vec<ReplyDto>>,
}

#[derive(Deserialize)]
struct ReplyDto {
    id: Option<i64>,
    status: Option<String>,
    text: Option<String>,
}

/// None → no open sentinel (not a reply, caller emits nothing).
/// Some(Malformed) → sentinel present but truncated or schema-invalid.
/// Some(Structured) → schema-valid.
pub(crate) fn extract_agent_reply(reply_text: &str) -> Option<AgentReplyOutcome> {
    let open_at = reply_text.find(OPEN)?;
    let after_open = open_at + OPEN.len();
    let Some(close_rel) = reply_text[after_open..].find(CLOSE) else {
        // open sentinel, no close → truncated
        return Some(AgentReplyOutcome::Malformed { raw: reply_text[open_at..].to_string() });
    };
    let close_at = after_open + close_rel;
    let raw = reply_text[open_at..close_at + CLOSE.len()].to_string();
    let json = reply_text[after_open..close_at].trim();

    match validate(json) {
        Some((nonce, replies)) => Some(AgentReplyOutcome::Structured { raw, nonce, replies }),
        // Best-effort nonce so a schema-invalid-but-parseable block can still be
        // nonce-gated by the frontend degrade path.
        None => Some(AgentReplyOutcome::Malformed { raw, nonce: best_effort_nonce(json) }),
    }
}

/// A non-empty string `nonce` from an otherwise-invalid block; None if the JSON
/// is unparseable or has no usable nonce.
fn best_effort_nonce(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let nonce = value.get("nonce")?.as_str()?;
    (!nonce.is_empty()).then(|| nonce.to_string())
}

fn validate(json: &str) -> Option<(String, Vec<AgentReply>)> {
    let dto: ReplyBlockDto = serde_json::from_str(json).ok()?;
    if dto.v != Some(1) {
        return None;
    }
    let nonce = dto.nonce.filter(|n| !n.is_empty())?;
    let raw_replies = dto.replies.filter(|r| !r.is_empty())?;

    let mut seen = std::collections::HashSet::new();
    let mut replies = Vec::with_capacity(raw_replies.len());
    for entry in raw_replies {
        // positive u32 only: zero, negative, or oversized → None (malformed).
        let id = u32::try_from(entry.id?).ok().filter(|&n| n > 0)?;
        if !seen.insert(id) {
            return None; // duplicate id
        }
        let status = match entry.status.as_deref()? {
            "answered" => AgentReplyStatus::Answered,
            "changed" => AgentReplyStatus::Changed,
            "skipped" => AgentReplyStatus::Skipped,
            _ => return None,
        };
        replies.push(AgentReply { id, status, text: entry.text? });
    }
    Some((nonce, replies))
}
```

**Before running the tests**, register the module — add `mod reply;` to `crates/backend/src/agent/mod.rs` in this step (Step 1), so the new `#[cfg(test)]` module compiles.

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p vimeflow-backend agent::reply`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/reply.rs crates/backend/src/agent/mod.rs
git commit -m "feat(agent): extract + validate structured reply block (VIM-283)"
```

### Task 3: The emitter (`events.rs`)

**Files:**

- Modify: `crates/backend/src/agent/events.rs` (add after `emit_agent_turn`, ~line 32)

- [ ] **Step 1: Add the emitter**

```rust
pub(crate) fn emit_agent_reply(
    events: &dyn EventSink,
    payload: &AgentReplyEvent,
) -> Result<(), String> {
    events.emit_json("agent-reply", serialize_event(payload)?)
}
```

Add `AgentReplyEvent` to the `use super::types::{…}` import at the top of the file.

- [ ] **Step 2: Compile**

Run: `cargo build -p vimeflow-backend`
Expected: builds (emitter unused yet).

- [ ] **Step 3: Commit**

```bash
git add crates/backend/src/agent/events.rs
git commit -m "feat(agent): add emit_agent_reply (VIM-283)"
```

### Task 4: Decode `last_agent_message` on `task_complete` (`transcript_dto.rs`)

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript_dto.rs` (`CodexPayloadDto`, ~line 94, beside `message`)

- [ ] **Step 1: Add the field**

```rust
    #[serde(default, deserialize_with = "lenient_string")]
    pub last_agent_message: Option<String>,
```

(Use the same `lenient_string` deserializer `message` uses so a wrong-typed value degrades to `None` instead of failing the whole line.)

- [ ] **Step 2: Compile**

Run: `cargo build -p vimeflow-backend`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript_dto.rs
git commit -m "feat(agent): decode last_agent_message on codex task_complete (VIM-283)"
```

### Task 5: Wire the Codex decoder to emit `agent-reply`

**Files:**

- Modify: `crates/backend/src/agent/adapter/codex/transcript.rs` (`process_event_msg` TaskComplete arm, ~line 461; test module below)

- [ ] **Step 1: Write the failing test**

In the `transcript.rs` test module (inline-JSON + `sink.recorded()` style, matching the existing `process_line_*` tests), add a test that drives a `task_complete` line whose `last_agent_message` carries a valid block and asserts an `agent-reply` event is recorded. Match the existing test harness for `process_line` (reuse its state-wiring helper if present):

```rust
#[test]
fn task_complete_with_reply_block_emits_agent_reply() {
    let sink = RecordingSink::new(); // whatever the file's existing helper is
    let line = r#"{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete","duration_ms":5,"last_agent_message":"done\n<<<VIMEFLOW_REPLY\n{\"v\":1,\"nonce\":\"abc\",\"replies\":[{\"id\":1,\"status\":\"answered\",\"text\":\"because latency\"}]}\nVIMEFLOW_REPLY>>>"}}"#;
    // ...drive process_line(line, "pty-1", None, &sink, ...state) as the sibling tests do...
    let replies: Vec<_> = sink.recorded().into_iter().filter(|(k, _)| k == "agent-reply").collect();
    assert_eq!(replies.len(), 1);
    // assert the payload carries sessionId "pty-1", nonce "abc", one reply id 1.
}

#[test]
fn task_complete_without_sentinel_emits_no_reply() {
    let sink = RecordingSink::new();
    let line = r#"{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete","duration_ms":5,"last_agent_message":"just done"}}"#;
    // ...drive process_line...
    assert!(sink.recorded().iter().all(|(k, _)| k != "agent-reply"));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p vimeflow-backend agent::adapter::codex::transcript::tests::task_complete_with_reply`
Expected: FAIL — no `agent-reply` recorded.

- [ ] **Step 3: Wire the emit**

In `process_event_msg`, extend the `TaskComplete` arm (keep the existing `flush_in_flight_tool_calls` call):

```rust
CodexPayloadType::TaskComplete => {
    flush_in_flight_tool_calls(session_id, events, in_flight, ToolCallStatus::Done, &timestamp);

    if let Some(reply) = payload
        .last_agent_message
        .as_deref()
        .and_then(crate::agent::reply::extract_agent_reply)
    {
        let (raw_text, nonce, replies) = match reply {
            crate::agent::reply::AgentReplyOutcome::Structured { raw, nonce, replies } => {
                (raw, Some(nonce), Some(replies))
            }
            // Malformed carries a best-effort nonce (Some when the block parsed as
            // an object) so the frontend can still nonce-gate the degrade.
            crate::agent::reply::AgentReplyOutcome::Malformed { raw, nonce } => (raw, nonce, None),
        };
        let payload = crate::agent::types::AgentReplyEvent {
            session_id: session_id.to_string(),
            nonce,
            raw_text,
            replies,
        };
        if let Err(err) = crate::agent::events::emit_agent_reply(events.as_ref(), &payload) {
            log::warn!("failed to emit agent-reply: {err}");
        }
    }
}
```

(`events` is `&Arc<dyn EventSink>`; `.as_ref()` yields `&dyn EventSink`. Confirm against the sibling `emit_*` calls in this file — match how they pass the sink.)

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p vimeflow-backend agent::adapter::codex::transcript`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/agent/adapter/codex/transcript.rs
git commit -m "feat(agent): emit agent-reply from codex task_complete (VIM-283)"
```

### Task 6: Regenerate bindings + full backend test

**Files:**

- Generated: `src/bindings/AgentReplyEvent.ts`, `src/bindings/AgentReply.ts`, `src/bindings/AgentReplyStatus.ts`, `src/bindings/index.ts`

- [ ] **Step 1: Generate bindings**

Run: `npm run generate:bindings`
Expected: new `AgentReply*.ts` files appear; `index.ts` re-exports them.

- [ ] **Step 2: Full backend test + lint**

Run: `cargo test -p vimeflow-backend` then `npm run type-check:generated`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/bindings
git commit -m "chore(bindings): regenerate for AgentReplyEvent (VIM-283)"
```

**PR-1 done.** Open as `feat(agent): capture structured agent replies from the codex transcript (VIM-283)`, `Closes VIM-283`, `Part of VIM-284`.

---

## PR-2 — VIM-249: frontend Q&A thread (lights up the round-trip)

Depends on PR-1's `AgentReplyEvent` binding being on `main`.

### Task 7: Dispatch nonce + reply instruction (`feedbackDispatch.ts`)

**Files:**

- Modify: `src/features/diff/services/feedbackDispatch.ts` (`formatFeedbackPayload` footer ~line 112; `dispatchFeedbackBatch` ~line 116)
- Test: `src/features/diff/services/feedbackDispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('the footer instructs the agent to emit the reply block with the nonce', () => {
  const payload = formatFeedbackPayload(
    [
      {
        filePath: 'src/a.ts',
        staged: false,
        annotations: [makeAnnotation(5, 'additions', 'Why?', 'question')],
      },
    ],
    'n0nc3'
  )
  expect(payload).toContain('<<<VIMEFLOW_REPLY')
  expect(payload).toContain('n0nc3')
  expect(payload).toContain('VIMEFLOW_REPLY>>>')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/services/feedbackDispatch.test.ts`
Expected: FAIL — `formatFeedbackPayload` takes one arg; no sentinel text.

- [ ] **Step 3: Implement**

Add a `nonce: string` parameter to `formatFeedbackPayload` and replace the footer line:

```ts
export const formatFeedbackPayload = (
  entries: DispatchEntry[],
  nonce: string
): string => {
  // ...existing header + blocks...
  return [
    header,
    '>',
    ...blocks,
    '> ―',
    '> When done, end your reply with this exact block, echoing the nonce verbatim.',
    '> status is one of: "answered" (a question), "changed" (you edited files), "skipped".',
    '> <<<VIMEFLOW_REPLY',
    `> {"v":1,"nonce":"${nonce}","replies":[{"id":1,"status":"answered","text":"..."}]}`,
    '> VIMEFLOW_REPLY>>>',
  ].join('\n')
}
```

The sample uses a single valid literal (`"answered"`); the line above enumerates the choices in prose, so an agent copying the block verbatim never produces the invalid `answered|changed|skipped`.

````

Thread the nonce through `dispatchFeedbackBatch`:

```ts
export const dispatchFeedbackBatch = async (
  _paneId: string,
  ptyId: string,
  entries: DispatchEntry[],
  nonce: string,
  writePty: (ptyId: string, data: string) => Promise<void>
): Promise<void> => {
  const formatted = formatFeedbackPayload(entries, nonce)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\r`
  await writePty(ptyId, payload)
}
````

- [ ] **Step 4: Update the callers in the SAME task (or the app won't compile)**

Both `formatFeedbackPayload` and `dispatchFeedbackBatch` now require `nonce`. Update their call sites in `Panel.tsx` now — do not defer to Task 10:

- **Send path** (`handleSendFeedback`, ~line 779): generate a nonce and pass it (Task 10 will reuse the same `nonce` for the pending record — for this task, a local `const nonce = Math.random().toString(36).slice(2, 8)` inline is enough):
  ```ts
  await dispatchFeedbackBatch(
    pane.paneId,
    pane.ptyId,
    entries,
    nonce,
    feedbackDispatch.writePty
  )
  ```
- **Copy path** (`handleCopyFeedback`, ~line 817): the clipboard copy has no agent to reply, so pass a fresh throwaway nonce purely to satisfy the signature:
  ```ts
  const text = formatFeedbackPayload(
    entries,
    Math.random().toString(36).slice(2, 8)
  )
  ```

Also update the existing `feedbackDispatch.test.ts` and any `Panel.test.tsx` dispatch assertions to the new arity.

- [ ] **Step 5: Run the diff suite**

Run: `npx vitest run src/features/diff && npm run type-check`
Expected: PASS — no caller left on the old arity.

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/services/feedbackDispatch.ts src/features/diff/services/feedbackDispatch.test.ts src/features/diff/Panel.tsx src/features/diff/Panel.test.tsx
git commit -m "feat(diff): dispatch reply-block instruction with a per-dispatch nonce (VIM-249)"
```

### Task 8: The pending-review store (`pendingReviews.ts`)

**Files:**

- Create: `src/features/diff/services/pendingReviews.ts`
- Test: `src/features/diff/services/pendingReviews.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import {
  setPendingReview,
  getPendingReview,
  clearPendingReview,
} from './pendingReviews'

const record = {
  ptyId: 'pty-1',
  ownerKey: 'sess:pane',
  nonce: 'abc',
  dispatchedAt: 1,
  byHandle: new Map([
    [
      1,
      {
        cwd: '/r',
        filePath: 'a.ts',
        staged: false,
        commentId: 'c1',
        lineNumber: 5,
        side: 'additions' as const,
      },
    ],
  ]),
}

describe('pendingReviews', () => {
  test('set then get by ptyId', () => {
    setPendingReview(record)
    expect(getPendingReview('pty-1')?.nonce).toBe('abc')
  })

  test('set replaces the prior record for the same pty', () => {
    setPendingReview(record)
    setPendingReview({ ...record, nonce: 'xyz' })
    expect(getPendingReview('pty-1')?.nonce).toBe('xyz')
  })

  test('clear removes the record', () => {
    setPendingReview(record)
    clearPendingReview('pty-1')
    expect(getPendingReview('pty-1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/services/pendingReviews.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { AnnotationSide } from '@pierre/diffs'

export interface PendingReviewHandle {
  cwd: string
  filePath: string
  staged: boolean
  commentId: string
  lineNumber: number
  side: AnnotationSide
}

export interface PendingReview {
  ptyId: string
  ownerKey: string
  nonce: string
  dispatchedAt: number
  byHandle: Map<number, PendingReviewHandle>
}

// ponytail: module-singleton keyed by ptyId — correlation state, not persisted
// review data (comments persist via the feedback store). One in-flight review
// per pty; a new dispatch replaces it.
const store = new Map<string, PendingReview>()

export const setPendingReview = (review: PendingReview): void => {
  store.set(review.ptyId, review)
}

export const getPendingReview = (ptyId: string): PendingReview | undefined =>
  store.get(ptyId)

export const clearPendingReview = (ptyId: string): void => {
  store.delete(ptyId)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/diff/services/pendingReviews.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/pendingReviews.ts src/features/diff/services/pendingReviews.test.ts
git commit -m "feat(diff): pending-review correlation store (VIM-249)"
```

### Task 9: Owner-addressed `addAnnotation` (`useFeedbackBatch.ts`)

**Files:**

- Modify: `src/features/diff/hooks/useFeedbackBatch.ts` (`useFeedbackBatchStore` — add an owner-addressed variant)
- Test: `src/features/diff/hooks/useFeedbackBatch.test.ts`

- [ ] **Step 1: Write the failing test**

An agent reply must attach to the **dispatching** owner even when a different owner is active. Add to the `useFeedbackBatchStore` describe:

```ts
test('addAnnotationForOwner targets a specific owner, not the active one', () => {
  const { result, rerender } = renderHook(
    ({ ownerKey, cwd }) => useFeedbackBatchStore(ownerKey, cwd),
    { initialProps: { ownerKey: 'sess:p0', cwd: '/repo' } }
  )
  act(() => {
    result.current.feedbackBatch.addAnnotationForOwner(
      'sess:p0',
      '/repo',
      'a.ts',
      false,
      makeAnnotation('reply-1')
    )
  })
  rerender({ ownerKey: 'sess:p1', cwd: '/repo' }) // switch active owner
  rerender({ ownerKey: 'sess:p0', cwd: '/repo' }) // back
  expect(
    result.current.feedbackBatch.annotationsForFile('/repo', 'a.ts', false)
  ).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts`
Expected: FAIL — `addAnnotationForOwner` is not a function.

- [ ] **Step 3: Implement**

Today's `addAnnotation` binds to the hook's active `ownerKey`. Extract the owner-parameterized core and expose it. In `useFeedbackBatchStore`, add:

```ts
const addAnnotationForOwner = useCallback(
  (
    ownerKeyArg: string,
    requestedCwd: string,
    filePath: string,
    staged: boolean,
    annotation: DiffLineAnnotation<ReviewComment>
  ): 'ok' | 'cap-reached' => {
    const key = makeBatchKey(requestedCwd, filePath, staged)
    setBatchesByOwner((prev) => {
      const currentBatch = prev.get(ownerKeyArg) ?? EMPTY_BATCH
      if (countAnnotationsInBatch(currentBatch) >= SOFT_CAP) {
        return prev
      }
      const nextBatch = addAnnotationToBatch(currentBatch, key, annotation)
      const next = new Map(prev).set(ownerKeyArg, nextBatch)
      optimisticBatchesRef.current = next
      return next
    })
    return 'ok'
  },
  []
)
```

Add `addAnnotationForOwner` to the `UseFeedbackBatchReturn` interface and the memoized return object (both dependency arrays). Have the existing `addAnnotation` delegate to it with `ownerKey` to keep one code path.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useFeedbackBatch.ts src/features/diff/hooks/useFeedbackBatch.test.ts
git commit -m "feat(diff): owner-addressed addAnnotation for agent replies (VIM-249)"
```

### Task 10: Record the pending review at dispatch (`Panel.tsx`)

**Files:**

- Modify: `src/features/diff/Panel.tsx` (`buildFeedbackEntries` ~732, `handleSendFeedback` ~768)
- Test: `src/features/diff/Panel.test.tsx`

- [ ] **Step 1: Write the failing test**

The send test (the running-candidate dispatch test) should assert a pending record is set with the dispatched handles. Extend it:

```ts
import { getPendingReview } from '../services/pendingReviews'
// after the Finish→send flow that dispatches one comment on src/foo.ts:
await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))
const pending = getPendingReview('pty-1')
expect(pending?.byHandle.get(1)?.filePath).toBe('src/foo.ts')
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/Panel.test.tsx -t "keeps the sent comment"`
Expected: FAIL — no pending record.

- [ ] **Step 3: Implement**

First, **add a `feedbackOwnerKey: string` prop to `Panel`** (thread it here, not in Task 12), passed from WorkspaceView's `activeFeedbackOwnerKey` (WorkspaceView.tsx:1833) — Task 10's test depends on it, so it can't wait for Task 12. Add it to `PanelProps` and the WorkspaceView `<Panel .../>` render.

`buildFeedbackEntries` numbers `[#n]` by its ordered iteration. Have it also emit the ordered handle list built from the **annotation's own** `(cwd, repo-relative filePath, staged)` — the batch key, not the resolved absolute path. Return `{ entries, handles }`. In `handleSendFeedback`, generate the nonce **once** (reusing the value passed to `dispatchFeedbackBatch` from Task 7, not a second one), build the `PendingReview`, `setPendingReview(...)`:

```ts
const nonce = Math.random().toString(36).slice(2, 8) // ponytail: 6-char correlation token, not a secret
const { entries, handles } = buildFeedbackEntries()
// ...
await dispatchFeedbackBatch(
  pane.paneId,
  pane.ptyId,
  entries,
  nonce,
  feedbackDispatch.writePty
)
feedback.markDispatched(Date.now())
setPendingReview({
  ptyId: pane.ptyId,
  ownerKey: feedbackOwnerKey, // the new prop
  nonce,
  dispatchedAt: Date.now(),
  byHandle: handles,
})
```

`handles` is a `Map<number, PendingReviewHandle>` where key N maps to the Nth dispatched pending comment (same order `buildFeedbackEntries` assigns `[#n]`), using each annotation's `metadata.id` as `commentId` and its own `lineNumber`/`side`/repo-relative path.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/diff/Panel.test.tsx`
Expected: PASS (update the copy-feedback path too if it shares `buildFeedbackEntries`).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/Panel.tsx src/features/diff/Panel.test.tsx
git commit -m "feat(diff): record the pending review at dispatch (VIM-249)"
```

### Task 11: The capture hook (`useAgentReply.ts`)

**Files:**

- Create: `src/features/diff/hooks/useAgentReply.ts`
- Test: `src/features/diff/hooks/useAgentReply.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover the spec's Section-3 matrix: correlation, session gate, nonce gate, all-unmatched degrade, marker degrade, idempotent replay. Mock `listen` and `getPendingReview`:

```ts
// Feed an AgentReplyEvent through a captured listen('agent-reply') callback and
// assert addAnnotationForOwner is called with the right ownerKey + handle target.
test('attaches a matched reply to the dispatching owner by [#n]', async () => {
  // setPendingReview({ ptyId:'pty-1', ownerKey:'o', nonce:'abc', byHandle: Map{1→{...commentId,file,line,side}} })
  // emit { sessionId:'pty-1', nonce:'abc', rawText:'...', replies:[{id:1,status:'answered',text:'A'}] }
  // expect addAnnotationForOwner('o', cwd, file, staged, author:'agent' text:'A')
})

test('ignores an event whose nonce does not match (superseded dispatch)', async () => {
  /* ... */
})
test('ignores an event with no pending record for the session', async () => {
  /* ... */
})
test('degrades a malformed marker (replies:null) to one rawText note and clears the record', async () => {
  /* ... */
})
test('degrades when no reply id matches, anchored to the lowest pending handle', async () => {
  /* ... */
})

// The two cases that prove byHandle is consumed without over-clearing:
test('mixed reply attaches valid handles and drops an unknown id', async () => {
  // byHandle has {1,2}; reply ids [1, 99] → attach #1, drop 99, record now has {2} (NOT cleared).
})
test('partial reply leaves the unanswered handles pending', async () => {
  // byHandle has {1,2}; reply ids [1] → attach #1, record still has {2}; a later reply for #2 attaches then clears.
})

test('a replayed event after handles are consumed is a no-op', async () => {
  /* ... */
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/hooks/useAgentReply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useEffect } from 'react'
import { listen } from '@/lib/backend'
import type { AgentReplyEvent } from '@/bindings'
import {
  getPendingReview,
  setPendingReview,
  clearPendingReview,
} from '../services/pendingReviews'

interface UseAgentReplyArgs {
  addAnnotationForOwner: (
    ownerKey: string,
    cwd: string,
    filePath: string,
    staged: boolean,
    annotation: {
      side: AnnotationSide
      lineNumber: number
      metadata: ReviewComment
    }
  ) => void
  nextCommentId: () => string
}

export const useAgentReply = ({
  addAnnotationForOwner,
  nextCommentId,
}: UseAgentReplyArgs): void => {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<AgentReplyEvent>('agent-reply', (event) => {
      const pending = getPendingReview(event.sessionId)
      if (!pending || event.nonce == null || event.nonce !== pending.nonce) {
        return // session + nonce gate
      }

      const attachAgentNote = (h: PendingReviewHandle, text: string): void =>
        addAnnotationForOwner(pending.ownerKey, h.cwd, h.filePath, h.staged, {
          side: h.side,
          lineNumber: h.lineNumber,
          metadata: {
            id: nextCommentId(),
            text,
            author: 'agent',
            createdAt: Date.now(),
          },
        })

      const matched = (event.replies ?? []).filter((r) =>
        pending.byHandle.has(r.id)
      )

      if (event.replies && matched.length > 0) {
        for (const reply of matched) {
          const h = pending.byHandle.get(reply.id)!
          attachAgentNote(h, reply.text)
          pending.byHandle.delete(reply.id)
        }
        if (pending.byHandle.size === 0) clearPendingReview(event.sessionId)
        else setPendingReview(pending)
        return
      }

      // malformed marker OR all-unmatched → one rawText note on the lowest pending handle, then clear
      const lowestId = Math.min(...pending.byHandle.keys())
      const anchor = pending.byHandle.get(lowestId)
      if (anchor) attachAgentNote(anchor, event.rawText)
      clearPendingReview(event.sessionId)
    }).then((fn) => {
      unlisten = fn
    })

    return () => unlisten?.()
  }, [addAnnotationForOwner, nextCommentId])
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/diff/hooks/useAgentReply.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useAgentReply.ts src/features/diff/hooks/useAgentReply.test.ts
git commit -m "feat(diff): useAgentReply — capture, correlate, degrade (VIM-249)"
```

### Task 12: Mount the hook (`WorkspaceView.tsx`)

The owner-key prop was already threaded in Task 10; this task only wires the capture hook into the one place the feedback store lives.

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx` (mount `useAgentReply` beside `useFeedbackBatchStore`, ~line 1862)

- [ ] **Step 1: Mount the hook**

In WorkspaceView, where `useFeedbackBatchStore` is instantiated, pass its `feedbackBatch.addAnnotationForOwner` and a comment-id generator into `useAgentReply({ addAnnotationForOwner, nextCommentId })`. This is the single subscription point — the hook mutates the shared store that every `Panel` reads from.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean.

- [ ] **Step 3: Full diff + workspace suites**

Run: `npx vitest run src/features/diff src/features/workspace`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/diff/Panel.tsx
git commit -m "feat(diff): mount useAgentReply and route replies to the dispatching owner (VIM-249)"
```

### Task 13: Verify the render (reuse VIM-256) + gate the full suite

No new render code — an `author:'agent'` annotation already renders "Agent reply" (distinct, read-only) via `ReviewCommentRow` (VIM-256). This task confirms it and closes the round-trip.

**Files:**

- Create: `src/features/diff/agentReplyThread.integration.test.tsx`

- [ ] **Step 1: Write the integration test at the store layer**

`useAgentReply` subscribes in WorkspaceView and mutates the shared feedback store — `Panel` alone never subscribes, so the test must mount both against **one** store instance. Use a small harness component that instantiates `useFeedbackBatchStore`, wires `useAgentReply` to its `addAnnotationForOwner`, and renders `Panel` bound to the same `feedbackBatch` (Panel already accepts `feedbackBatch`/`feedbackDraft` props — see the existing Panel tests):

```tsx
const Harness = (): ReactElement => {
  const store = useFeedbackBatchStore('sess:p0', '/repo')
  useAgentReply({
    addAnnotationForOwner: store.feedbackBatch.addAnnotationForOwner,
    nextCommentId: () => `agent-${Date.now()}`,
  })
  return (
    <Panel
      cwd="/repo"
      feedbackBatch={store.feedbackBatch}
      feedbackDraft={store.feedbackDraft} /* + selectedFile on src/foo.ts */
    />
  )
}

test('an agent reply renders in the thread under the dispatched comment', async () => {
  // 1. seed a pending review: setPendingReview({ ptyId:'pty-1', ownerKey:'sess:p0', nonce:'abc',
  //    byHandle: Map{1 → { cwd:'/repo', filePath:'src/foo.ts', staged:false, commentId:'c1', lineNumber:5, side:'additions' }} })
  //    (and a committed user comment 'c1' on that line via the store, so the thread has the question)
  // 2. render <Harness/>
  // 3. fire the captured listen('agent-reply') callback with
  //    { sessionId:'pty-1', nonce:'abc', rawText:'...', replies:[{id:1,status:'answered',text:'Because latency.'}] }
  // 4. await: expect the 'Agent reply' chip AND 'Because latency.' to be in the document.
})
```

Mock `listen` so the test can capture and invoke the `'agent-reply'` callback (mirror how `useAgentStatus` tests drive events).

- [ ] **Step 2: Run to verify pass** (all implementation is already in place by now)

Run: `npx vitest run src/features/diff/agentReplyThread.integration.test.tsx`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `npm run lint && npm run format:check && npm run type-check && npx vitest run src/features/diff src/features/workspace`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/features/diff/Panel.test.tsx
git commit -m "test(diff): agent reply renders in the thread end-to-end (VIM-249)"
```

**PR-2 done.** Open as `feat(diff): inline agent Q&A thread (VIM-249)`, `Closes VIM-249`, `Part of VIM-284`. Merging PR-2 lights up the round-trip.

---

## Follow-ups (not this plan)

- **Claude Code adapter:** call `extract_agent_reply` on the assistant text blocks its decoder already reads (`process_assistant_message`) and `emit_agent_reply` — no contract change.
- **Kimi / OpenCode:** same one-call pattern.
- **Activity feed:** surface replies in the agent-status feed (a `reply` activity kind).

<!-- codex-reviewed: 2026-07-05T04:32:33Z -->
