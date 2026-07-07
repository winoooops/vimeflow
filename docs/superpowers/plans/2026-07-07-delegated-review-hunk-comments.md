# Delegated review-agent feedback as hunk reviewer comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a delegated code reviewer's findings from the agent transcript and render them as first-class, threaded reviewer comments in the diff (VIM-304).

**Architecture:** Three sequenced PRs. **PR-1** (backend): an adapter-agnostic `extract_agent_review` + a typed `agent-review` event, wired into the Codex/Claude turn-end sites beside the shipped reply capture — merges dormant-live. **PR-2** (frontend): a "Request review" dispatch carrying a diff snapshot, an `agent-review` capture hook that places findings as `author:'reviewer'` annotations with a snapshot-based line→file→review-level fallback. **PR-3** (threads): the agent `outcome` axis (migrating the shipped `AgentReplyStatus`) + a reply-block `target` discriminator so the main agent posts into a finding's thread.

**Tech Stack:** Rust (serde, ts-rs, the `TranscriptDecoder` tail engine), React/TypeScript (Vitest, `useFeedbackBatch`, `window.vimeflow.listen`).

**Spec:** `docs/superpowers/specs/2026-07-07-delegated-review-hunk-comments-design.md` (codex-reviewed).

**Reference implementations (all merged, mirror them):** `crates/backend/src/agent/reply.rs` (`extract_agent_reply`), `events.rs::emit_agent_reply`, `types.rs::AgentReplyEvent`, the `emit_reply_if_present` helpers in `adapter/codex/transcript.rs` + `adapter/claude_code/transcript.rs`; frontend `hooks/useFeedbackBatch.ts`, `services/pendingReviews.ts`, `hooks/useAgentReply.ts`, `components/ReviewCommentRow.tsx`, `services/feedbackDispatch.ts`.

---

## PR-1 — Backend capture (VIM-304a)

Merges dormant-live: no agent emits the review block until PR-2 dispatches the instruction. Coverage is Rust unit tests. Mirrors VIM-283 (`reply.rs`) throughout.

### Task 1: Review event types (`types.rs`)

**Files:**
- Modify: `crates/backend/src/agent/types.rs` (add after `AgentReplyStatus`, ~line 355)

- [ ] **Step 1: Add the types**

Mirror the `AgentReplyEvent` attribute stack exactly (`pub` fields, test-gated ts-rs export, camelCase / lowercase renames):

```rust
/// A delegated reviewer's findings for the current diff (VIM-304).
/// `findings: None` is the malformed marker; `raw_text` carries the full block
/// so the frontend can degrade to a plain-text reviewer note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // consumed by the frontend (PR-2)
pub struct AgentReviewEvent {
    pub session_id: String,
    pub nonce: Option<String>,    // best-effort on malformed; None if unparseable
    pub reviewer: Option<String>, // best-effort on malformed; frontend falls back to a label
    pub raw_text: String,
    pub findings: Option<Vec<AgentReviewFinding>>, // None = malformed; empty = clean review
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AgentReviewFinding {
    pub scope: ReviewFindingScope,
    pub path: String,
    pub side: Option<ReviewFindingSide>, // present for line / range
    pub line: Option<u32>,               // line scope
    pub start_line: Option<u32>,         // range scope
    pub end_line: Option<u32>,           // range scope
    pub category: ReviewFindingCategory,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum ReviewFindingScope { Line, Range, File }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum ReviewFindingSide { Additions, Deletions }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum ReviewFindingCategory { Bug, Suggestion, Change, Question }
```

- [ ] **Step 2: Compile** — Run: `cargo build -p vimeflow` · Expected: builds (`#[allow(dead_code)]` covers unused).
- [ ] **Step 3: Commit** — `git commit -am "feat(agent): AgentReviewEvent types (VIM-304)"`

### Task 2: Extraction + validation helper (`review.rs`)

**Files:**
- Create: `crates/backend/src/agent/review.rs`
- Modify: `crates/backend/src/agent/mod.rs` (add `pub(crate) mod review;` beside `mod reply;`)

- [ ] **Step 1: Add `mod review;` to `mod.rs`** (so the test module below compiles).

- [ ] **Step 2: Write the failing tests** in `review.rs`:

```rust
//! Shared extraction + schema validation for the delegated-review block
//! (VIM-304). Adapter-agnostic sibling of reply.rs.
use serde::Deserialize;
use crate::agent::types::{
    AgentReviewFinding, ReviewFindingCategory, ReviewFindingScope, ReviewFindingSide,
};

const OPEN: &str = "<<<VIMEFLOW_REVIEW";
const CLOSE: &str = "VIMEFLOW_REVIEW>>>";

#[derive(Debug, PartialEq)]
pub(crate) enum AgentReviewOutcome {
    Malformed { raw: String, nonce: Option<String>, reviewer: Option<String> },
    Structured { raw: String, nonce: String, reviewer: String, findings: Vec<AgentReviewFinding> },
}

#[cfg(test)]
mod tests {
    use super::*;
    fn block(json: &str) -> String { format!("prose\n{OPEN}\n{json}\n{CLOSE}\nafter") }

    #[test]
    fn no_sentinel_is_none() {
        assert_eq!(extract_agent_review("nothing here"), None);
    }

    #[test]
    fn valid_line_finding_is_structured() {
        let t = block(r#"{"v":1,"nonce":"n","reviewer":"codex","findings":[{"scope":"line","path":"a.ts","side":"additions","line":42,"category":"bug","text":"x"}]}"#);
        match extract_agent_review(&t) {
            Some(AgentReviewOutcome::Structured { nonce, reviewer, findings, .. }) => {
                assert_eq!(nonce, "n");
                assert_eq!(reviewer, "codex");
                assert_eq!(findings.len(), 1);
                assert_eq!(findings[0].scope, ReviewFindingScope::Line);
                assert_eq!(findings[0].line, Some(42));
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }

    #[test]
    fn valid_range_finding_is_structured() {
        let t = block(r#"{"v":1,"nonce":"n","reviewer":"codex","findings":[{"scope":"range","path":"a.ts","side":"additions","startLine":88,"endLine":94,"category":"suggestion","text":"x"}]}"#);
        match extract_agent_review(&t) {
            Some(AgentReviewOutcome::Structured { findings, .. }) => {
                assert_eq!(findings[0].scope, ReviewFindingScope::Range);
                assert_eq!(findings[0].start_line, Some(88));
                assert_eq!(findings[0].end_line, Some(94));
            }
            other => panic!("expected Structured, got {other:?}"),
        }
    }

    #[test]
    fn empty_findings_is_clean_structured() {
        let t = block(r#"{"v":1,"nonce":"n","reviewer":"codex","findings":[]}"#);
        assert!(matches!(extract_agent_review(&t), Some(AgentReviewOutcome::Structured { ref findings, .. }) if findings.is_empty()));
    }

    #[test]
    fn schema_violations_are_malformed() {
        let cases = [
            r#"{"v":2,"nonce":"n","reviewer":"r","findings":[]}"#,                                                         // bad version
            r#"{"v":1,"nonce":"","reviewer":"r","findings":[]}"#,                                                          // empty nonce
            r#"{"v":1,"nonce":"n","reviewer":"","findings":[]}"#,                                                          // empty reviewer
            r#"{"v":1,"nonce":"n","reviewer":"r","findings":[{"scope":"line","path":"a","category":"bug","text":"x"}]}"#,  // line missing side/line
            r#"{"v":1,"nonce":"n","reviewer":"r","findings":[{"scope":"range","path":"a","side":"additions","startLine":9,"endLine":2,"category":"bug","text":"x"}]}"#, // start>end
            r#"{"v":1,"nonce":"n","reviewer":"r","findings":[{"scope":"file","path":"a","category":"nope","text":"x"}]}"#, // bad category
            r#"{"v":1,"nonce":"n","reviewer":"r","findings":[{"scope":"file","category":"bug","text":"x"}]}"#,             // file missing path
        ];
        for c in cases {
            assert!(matches!(extract_agent_review(&block(c)), Some(AgentReviewOutcome::Malformed { .. })), "expected Malformed for {c}");
        }
    }

    #[test]
    fn malformed_recovers_best_effort_nonce_and_reviewer() {
        let t = block(r#"{"v":1,"nonce":"keep","reviewer":"codex","findings":[{"scope":"file","category":"nope","text":"x"}]}"#);
        assert!(matches!(extract_agent_review(&t),
            Some(AgentReviewOutcome::Malformed { nonce: Some(n), reviewer: Some(r), .. }) if n == "keep" && r == "codex"));
    }

    #[test]
    fn open_without_close_is_malformed() {
        assert!(matches!(extract_agent_review(&format!("{OPEN}\n{{")), Some(AgentReviewOutcome::Malformed { .. })));
    }
}
```

- [ ] **Step 3: Run to verify failure** — Run: `cargo test -p vimeflow agent::review` · Expected: FAIL (`extract_agent_review` undefined).

- [ ] **Step 4: Implement** `extract_agent_review` above the test module. Reuse the reply.rs shape — sentinel scan, `normalize_reply_json` (make it `pub(crate)` in `reply.rs` and import it, or copy the tiny helper), lenient DTO, best-effort recovery:

```rust
#[derive(Deserialize)]
struct BlockDto { v: Option<i64>, nonce: Option<String>, reviewer: Option<String>, findings: Option<Vec<FindingDto>> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")] // the wire sends startLine / endLine
struct FindingDto {
    scope: Option<String>, path: Option<String>, side: Option<String>,
    line: Option<i64>, start_line: Option<i64>, end_line: Option<i64>,
    category: Option<String>, text: Option<String>,
}

pub(crate) fn extract_agent_review(reply_text: &str) -> Option<AgentReviewOutcome> {
    let open = reply_text.find(OPEN)?;
    let after = open + OPEN.len();
    let Some(rel) = reply_text[after..].find(CLOSE) else {
        let json = crate::agent::reply::normalize_reply_json(reply_text[after..].trim());
        return Some(malformed(reply_text[open..].to_string(), &json));
    };
    let close = after + rel;
    let raw = reply_text[open..close + CLOSE.len()].to_string();
    let json = crate::agent::reply::normalize_reply_json(reply_text[after..close].trim());
    match validate(&json) {
        Some((nonce, reviewer, findings)) => Some(AgentReviewOutcome::Structured { raw, nonce, reviewer, findings }),
        None => Some(malformed(raw, &json)),
    }
}

fn malformed(raw: String, json: &str) -> AgentReviewOutcome {
    let v: Option<serde_json::Value> = serde_json::from_str(json).ok();
    let field = |k: &str| v.as_ref().and_then(|v| v.get(k)?.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
    AgentReviewOutcome::Malformed { raw, nonce: field("nonce"), reviewer: field("reviewer") }
}

fn validate(json: &str) -> Option<(String, String, Vec<AgentReviewFinding>)> {
    let dto: BlockDto = serde_json::from_str(json).ok()?;
    if dto.v != Some(1) { return None; }
    let nonce = dto.nonce.filter(|s| !s.is_empty())?;
    let reviewer = dto.reviewer.filter(|s| !s.is_empty())?;
    let raw_findings = dto.findings?; // may be empty
    let mut findings = Vec::with_capacity(raw_findings.len());
    for f in raw_findings {
        findings.push(validate_finding(f)?);
    }
    Some((nonce, reviewer, findings))
}

fn positive_u32(n: Option<i64>) -> Option<u32> { u32::try_from(n?).ok().filter(|&x| x > 0) }

fn validate_finding(f: FindingDto) -> Option<AgentReviewFinding> {
    let scope = match f.scope.as_deref()? {
        "line" => ReviewFindingScope::Line, "range" => ReviewFindingScope::Range,
        "file" => ReviewFindingScope::File, _ => return None,
    };
    let category = match f.category.as_deref()? {
        "bug" => ReviewFindingCategory::Bug, "suggestion" => ReviewFindingCategory::Suggestion,
        "change" => ReviewFindingCategory::Change, "question" => ReviewFindingCategory::Question, _ => return None,
    };
    let text = f.text.filter(|s| !s.is_empty())?;
    let path = f.path.filter(|s| !s.is_empty())?;
    let side = match f.side.as_deref() {
        Some("additions") => Some(ReviewFindingSide::Additions),
        Some("deletions") => Some(ReviewFindingSide::Deletions),
        Some(_) => return None, None => None,
    };
    let (line, start_line, end_line) = match scope {
        ReviewFindingScope::Line => { side.as_ref()?; (Some(positive_u32(f.line)?), None, None) }
        ReviewFindingScope::Range => {
            side.as_ref()?;
            let s = positive_u32(f.start_line)?; let e = positive_u32(f.end_line)?;
            if s > e { return None; } (None, Some(s), Some(e))
        }
        ReviewFindingScope::File => (None, None, None),
    };
    Some(AgentReviewFinding { scope, path, side, line, start_line, end_line, category, text })
}
```

- [ ] **Step 5: Run to verify pass** — Run: `cargo test -p vimeflow agent::review` · Expected: PASS (6 tests).
- [ ] **Step 6: Commit** — `git add crates/backend/src/agent/review.rs crates/backend/src/agent/mod.rs crates/backend/src/agent/reply.rs && git commit -m "feat(agent): extract + validate the review block (VIM-304)"`

### Task 3: Emitter (`events.rs`)

**Files:** Modify `crates/backend/src/agent/events.rs`

- [ ] **Step 1:** Add `AgentReviewEvent` to the `use super::types::{…}` import, then add after `emit_agent_reply`:

```rust
pub(crate) fn emit_agent_review(events: &dyn EventSink, payload: &AgentReviewEvent) -> Result<(), String> {
    events.emit_json("agent-review", serialize_event(payload)?)
}
```

- [ ] **Step 2: Compile** — `cargo build -p vimeflow` · Expected: builds.
- [ ] **Step 3: Commit** — `git commit -am "feat(agent): emit_agent_review (VIM-304)"`

### Task 4: Codex adapter wiring

**Files:** Modify `crates/backend/src/agent/adapter/codex/transcript.rs` (`emit_reply_if_present` call site ~line 555; helper ~563; test module ~1726)

- [ ] **Step 1: Write the failing test** (mirror the existing `process_line_task_complete_with_reply_block_emits_agent_reply`, swapping the sentinel + asserting `agent-review`):

```rust
#[test]
fn process_line_task_complete_with_review_block_emits_agent_review() {
    let sink = Arc::new(FakeEventSink::new());
    // drive process_line as the reply test does, with last_agent_message =
    // "done\n<<<VIMEFLOW_REVIEW\n{\"v\":1,\"nonce\":\"n\",\"reviewer\":\"codex\",\"findings\":[{\"scope\":\"line\",\"path\":\"a.ts\",\"side\":\"additions\",\"line\":5,\"category\":\"bug\",\"text\":\"x\"}]}\nVIMEFLOW_REVIEW>>>"
    let reviews: Vec<_> = sink.recorded().into_iter().filter(|(k, _)| k == "agent-review").collect();
    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0].1["reviewer"], "codex");
    assert_eq!(reviews[0].1["findings"][0]["scope"], "line");
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p vimeflow ...with_review_block` · Expected: FAIL.

- [ ] **Step 3: Wire it.** Add `emit_review_if_present` beside `emit_reply_if_present`, and call it from the SAME `TaskComplete` arm with the SAME args (including `replay_done`):

```rust
// in the TaskComplete arm, right after emit_reply_if_present(...):
emit_review_if_present(payload, session_id, events, replay_done);

fn emit_review_if_present(payload: &CodexPayloadDto, session_id: &str, events: &Arc<dyn EventSink>, replay_done: bool) {
    if !replay_done { return; } // same replay gate as emit_reply_if_present
    let Some(text) = payload.last_agent_message.as_deref() else { return; };
    let Some(outcome) = crate::agent::review::extract_agent_review(text) else { return; };
    let event = map_review_outcome(session_id, outcome);
    if let Err(e) = crate::agent::events::emit_agent_review(events.as_ref(), &event) {
        log::warn!("failed to emit agent-review: {e}");
    }
}
```

Add a shared `map_review_outcome(session_id, AgentReviewOutcome) -> AgentReviewEvent` (Structured → Some(findings); Malformed → None, carrying best-effort nonce/reviewer). Put it in `review.rs` as `pub(crate)` so both adapters reuse it. **Verify the exact `replay_done` gate against the current `emit_reply_if_present` body (line ~563) and mirror it precisely.**

- [ ] **Step 4: Run to verify pass** — `cargo test -p vimeflow agent::adapter::codex` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(agent): emit agent-review from codex task_complete (VIM-304)"`

### Task 5: Claude Code adapter wiring

**Files:** Modify `crates/backend/src/agent/adapter/claude_code/transcript.rs` (`emit_reply_if_present` site; test module)

- [ ] **Step 1: Write the failing test** (mirror the Claude `emit_reply_if_present` test — an assistant `end_turn` whose concatenated `text` carries the review block emits `agent-review`; assert `reviewer`/`findings`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Wire it** — call `emit_review_if_present(&reply_text, session_id, events)` immediately after `emit_reply_if_present`, on the **same concatenated `text` blocks**, under the **same completion gate** (`stop_reason ∈ end_turn | stop_sequence | max_tokens`) and **same `replay_done`** the reply path uses. Reuse `map_review_outcome`.
- [ ] **Step 4: Run to verify pass** — `cargo test -p vimeflow agent::adapter::claude_code` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(agent): emit agent-review from Claude Code turns (VIM-304)"`

### Task 6: Bindings + full backend gate

- [ ] **Step 1:** `npm run generate:bindings` — new `AgentReviewEvent.ts` / `AgentReviewFinding.ts` / `ReviewFinding{Scope,Side,Category}.ts` appear. **These individual files are gitignored** (`/src/bindings/*.ts` except `index.ts`) — do **not** commit them; `generate:bindings:if-missing` (run by `lint` / `test` / CI, and always in CI) regenerates any file referenced by `index.ts` on a fresh checkout. Only `index.ts` is committed — the established pattern (see the shipped `AgentReply*` bindings).
- [ ] **Step 2:** Hand-add the exports to `src/bindings/index.ts` (it is hand-maintained — beside the `AgentReply*` exports). These import lines are what drives `if-missing` regeneration:

```ts
export type { AgentReviewEvent } from './AgentReviewEvent'
export type { AgentReviewFinding } from './AgentReviewFinding'
export type { ReviewFindingScope } from './ReviewFindingScope'
export type { ReviewFindingSide } from './ReviewFindingSide'
export type { ReviewFindingCategory } from './ReviewFindingCategory'
```

- [ ] **Step 3:** `cargo test -p vimeflow` (full backend) + `npm run type-check:generated` · Expected: green.
- [ ] **Step 4: Commit** — `git add src/bindings/index.ts && git commit -m "chore(bindings): export AgentReviewEvent (VIM-304)"`

**PR-1 done.** Open `feat(agent): capture delegated review findings from the transcript (VIM-304a)`, `Part of VIM-304`.

---

## PR-2 — Frontend review ingestion (VIM-304b)

Depends on PR-1's binding on `main`. Lights up review capture (reviewer findings appear in the diff). Threads (agent posting into a finding) are PR-3.

### Task 7: Extend `ReviewComment` + correct the pending predicate

**Files:** Modify `src/features/diff/hooks/useFeedbackBatch.ts` (`ReviewComment` ~39, `isPendingReviewAnnotation` ~148, the `author !== 'agent'` guards ~426/447); Test: `useFeedbackBatch.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
test('reviewer annotations are never pending (not counted, not dispatched)', () => {
  const reviewer = makeAnnotation('r1') // author:'reviewer'
  reviewer.metadata.author = 'reviewer'
  expect(isPendingReviewAnnotation(reviewer)).toBe(false)
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts` (fails: `'reviewer'` not assignable to `author`, and the predicate returns true).

- [ ] **Step 3: Implement:**

```ts
// ReviewComment
author: 'self' | 'agent' | 'reviewer'
reviewer?: string // the delegated reviewer's name (author === 'reviewer')

// isPendingReviewAnnotation — only the user's own undispatched comments are pending:
export const isPendingReviewAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): boolean =>
  annotation.metadata.author === 'self' &&
  annotation.metadata.dispatchedAt === undefined
```

Update the two `annotation.metadata.author !== 'agent'` guards (~426, ~447) to `annotation.metadata.author === 'self'` (only self counts toward the soft cap / dispatch).

- [ ] **Step 4: Run to verify pass** — Expected: PASS (existing agent-exclusion tests still green).
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): reviewer author + correct pending predicate (VIM-304)"`

### Task 8: Pending-review-request store

**Files:** Create `src/features/diff/services/pendingReviewRequests.ts` + `.test.ts` (mirror `pendingReviews.ts`)

- [ ] **Step 1: Write the failing test** — set/get by nonce, replace, clear (as in `pendingReviews.test.ts`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement:**

```ts
import type { AnnotationSide } from '@pierre/diffs'

export interface HunkRange { start: number; end: number }
export interface ReviewedFile { path: string; additions: HunkRange[]; deletions: HunkRange[] }

export interface PendingReviewRequest {
  nonce: string
  ptyId: string
  ownerKey: string
  cwd: string
  staged: boolean
  diffSnapshot: ReviewedFile[]
  dispatchedAt: number
}

// ponytail: module-singleton keyed by nonce (forward-compatible with VIM-297).
const store = new Map<string, PendingReviewRequest>()
export const setPendingReviewRequest = (r: PendingReviewRequest): void => { store.set(r.nonce, r) }
export const getPendingReviewRequest = (nonce: string): PendingReviewRequest | undefined => store.get(nonce)
export const clearPendingReviewRequest = (nonce: string): void => { store.delete(nonce) }

// Unplaceable findings + malformed reviewer notes have no (path, staged) row;
// they live here, grouped by ownerKey, for the review-level surface (Task 11).
// Defined NOW so Task 10 (useAgentReview) has a write target before Task 11 renders it.
export interface ReviewLevelNote { commentId: string; reviewer: string; text: string; nonce: string }
const reviewLevelByOwner = new Map<string, ReviewLevelNote[]>()
export const addReviewLevelNote = (ownerKey: string, note: ReviewLevelNote): void => {
  reviewLevelByOwner.set(ownerKey, [...(reviewLevelByOwner.get(ownerKey) ?? []), note])
}
export const reviewLevelNotes = (ownerKey: string): ReviewLevelNote[] => reviewLevelByOwner.get(ownerKey) ?? []
export const clearReviewLevelNotes = (ownerKey: string): void => { reviewLevelByOwner.delete(ownerKey) }
```

- [ ] **Step 4:** Add a test that `addReviewLevelNote` / `reviewLevelNotes` round-trip per owner.
- [ ] **Step 5: Run to verify pass.**
- [ ] **Step 6: Commit** — `git commit -am "feat(diff): pending-review-request + review-level notes store (VIM-304)"`

### Task 9: Snapshot builder + Request-review dispatch

**Files:** Modify `src/features/diff/services/feedbackDispatch.ts` (add `formatReviewRequest` + `dispatchReviewRequest`); Modify `src/features/diff/Panel.tsx` (a "Request review" action, mirroring `handleSendFeedback`); Tests for both.

- [ ] **Step 1: Write the failing test** for `formatReviewRequest(files, staged, nonce)` — asserts the payload names the paths + mode, the coordinate convention, and instructs the `<<<VIMEFLOW_REVIEW` block echoing the nonce.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `formatReviewRequest` (bracketed-paste, like `formatFeedbackPayload`) + `dispatchReviewRequest(paneId, ptyId, files, staged, nonce, writePty)`. In `Panel.tsx`, add a "Request review" control that: builds the `diffSnapshot` from the loaded diff (`useFileDiff`/`GetGitDiffResponse` hunks → `ReviewedFile[]`), mints a nonce (`makeDispatchNonce`), dispatches, and `setPendingReviewRequest({ nonce, ptyId, ownerKey, cwd, staged, diffSnapshot, dispatchedAt })`.
- [ ] **Step 4: Run to verify pass** — `npx vitest run src/features/diff` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): Request review affordance + snapshot dispatch (VIM-304)"`

### Task 10: `useAgentReview` capture + placement

**Files:** Create `src/features/diff/hooks/useAgentReview.ts` + `.test.ts` (mirror `useAgentReply.ts`)

- [ ] **Step 1: Write the failing tests** — the Section-3 matrix: session+nonce gate; line/range/file placement as `author:'reviewer'` with reviewer+category; staged routing; line-OOR → file-level; path-not-in-snapshot → review-level; `findings:null` → one rawText note named `reviewer ?? 'Reviewer'`; empty findings → nothing placed + request cleared; idempotent replay.
- [ ] **Step 2: Run to verify failure** (module not found).
- [ ] **Step 3: Implement** — `listen('agent-review')`; gate on `getPendingReviewRequest(event.nonce)` + `event.sessionId === request.ptyId`; resolve each finding's anchor against `request.diffSnapshot` (path present? line/range inside a hunk range for that side?); place via `addAnnotationForOwner(request.ownerKey, request.cwd, path, request.staged, annotation)` — line→`{lineNumber, side, metadata}`, range→`target:{scope:'range',...}`, file→`target:{scope:'file'}`, OOR→file-level. **Off-snapshot** findings and the **`findings:null`** degrade note go to `addReviewLevelNote(request.ownerKey, { commentId, reviewer: event.reviewer ?? 'Reviewer', text, nonce })` (the Task-8 store). **Clear the request** after processing.
- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): useAgentReview — capture, place, degrade (VIM-304)"`

### Task 11: Reviewer row + review-level surface + mount

**Files:** Modify `src/features/diff/components/ReviewCommentRow.tsx` (reviewer variant); Create the review-level surface component; Modify `src/features/workspace/WorkspaceView.tsx` (mount `useAgentReview`); Tests.

- [ ] **Step 1: Write the failing test** — a `author:'reviewer'` comment renders the reviewer name + category chip, distinct from "Agent reply"; the review-level surface lists unplaceable findings.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — in `ReviewCommentRow`, add `const isReviewer = author === 'reviewer'`; render the `reviewer` name (or `'Reviewer'`) + category chip, read-only, visually distinct. Build the review-level surface (a collapsible "Review — N unplaceable" section) that renders `reviewLevelNotes(ownerKey)` from the Task-8 store. Mount `useAgentReview({ addAnnotationForOwner, nextCommentId })` in WorkspaceView beside `useAgentReply`.
- [ ] **Step 4: Run to verify pass** — `npx vitest run src/features/diff src/features/workspace` · Expected: green.
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): reviewer row + review-level surface + mount (VIM-304)"`

### Task 12: PR-2 gate

- [ ] `npm run lint && npm run format:check && npm run type-check && npx vitest run src/features/diff src/features/workspace` · Expected: all green. Commit any fixes.

**PR-2 done.** Open `feat(diff): render delegated reviewer findings in the hunk (VIM-304b)`, `Part of VIM-304`.

---

## PR-3 — Finding threads + outcome axis (VIM-304c)

Migrates the shipped `AgentReplyStatus` → the `outcome` axis and adds the reply-block `target` so the main agent posts into a finding's thread. **Touches merged VIM-249/283/292 — land the status migration atomically (backend enum + block schema + frontend consumer + binding).**

### Task 13: Migrate `AgentReplyStatus` → `outcome` (backend)

**Files:** Modify `types.rs` (`AgentReplyStatus` ~350), `reply.rs` (status parse), plus the codex/claude reply tests using the old literals.

- [ ] **Step 1: Write/adjust the failing test** — `extract_agent_reply` accepts the new literals (`reply`/`clarify`/`resolved`/`deferred`/`rejected`) AND maps the three legacy literals canonically (`answered→reply`, `changed→resolved`, `skipped→rejected`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — rename `AgentReplyStatus` variants to `Reply | Clarify | Resolved | Deferred | Rejected` (serde `rename_all = "lowercase"`); in `reply.rs`'s status parse, accept the five new literals and the three legacy ones via the fixed map. Update existing reply tests to the new literals.
- [ ] **Step 4: Run to verify pass** — `cargo test -p vimeflow agent::` · Expected: green.
- [ ] **Step 5: Commit** — `git commit -am "feat(agent): migrate reply status to the outcome axis (VIM-304)"`

### Task 14: Reply-block `target` discriminator (backend)

**Files:** Modify `types.rs` (`AgentReply` gains `target`), `reply.rs` (parse `target`, default `"comment"`); tests.

- [ ] **Step 1: Write the failing test** — a `{"target":"finding","id":1,"status":"resolved","text":"…"}` reply parses with `target = Finding`; an entry with no `target` defaults to `Comment` (regression).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — add `pub target: AgentReplyTarget` (enum `Comment | Finding`, serde lowercase, `#[serde(default)]` → `Comment`) to `AgentReply`; parse in `reply.rs`. Regenerate + hand-export `AgentReplyTarget` in `index.ts` (individual file gitignored, per Task 6).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(agent): reply target discriminator (VIM-304)"`

### Task 15: Finding-thread record (frontend)

**Files:** Modify `src/features/diff/services/pendingReviewRequests.ts` (add the finding-thread record + transition); Test.

- [ ] **Step 1: Write the failing test** — after `useAgentReview` places findings, a finding-thread record keyed `(ptyId, nonce)` maps ordinal→target (`{kind:'anchored', ownerKey, cwd, path, staged, commentId}` or `{kind:'reviewLevel', ownerKey, commentId}`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — on ingestion (Task 10), instead of clearing the request, **transition** it into a `findingThreadRecords` store keyed by `${ptyId}\0${nonce}`, recording each finding's ordinal → target record (with the `commentId` used when placing).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): finding-thread record (VIM-304)"`

### Task 16: `useAgentReply` union resolution + outcome (frontend)

**Files:** Modify `src/features/diff/hooks/useAgentReply.ts` (resolve `target:'finding'` against the finding-thread record; attach `outcome`); update `ReviewComment` to carry `outcome?`; Tests.

- [ ] **Step 1: Write the failing tests** — a `target:'finding'` reply (gated by `sessionId===ptyId` + nonce) attaches an `author:'agent'` annotation carrying `outcome` at the addressed finding; a `target:'comment'`/absent reply preserves the existing `[#n]` path (regression); a `clarify` marks awaiting-user.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — add `outcome?: 'reply'|'clarify'|'resolved'|'deferred'|'rejected'` to `ReviewComment`; in `useAgentReply`, branch on `reply.target`: `'comment'`→existing `pendingReviews` `[#n]` path; `'finding'`→resolve `(sessionId, nonce, ordinal)` against `findingThreadRecords`, attach at the target (anchored or review-level) carrying `outcome`. **Also update `feedbackDispatch.ts`'s reply-block instruction** — the `"status":"answered"` example and any `answered`/`changed`/`skipped` wording — to the new outcome vocabulary (`reply`/`clarify`/`resolved`/`deferred`/`rejected`), so the agent-facing prompt matches the migrated parser (Task 13). Without this the migration is only half-executed.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): useAgentReply finding-thread routing + outcome (VIM-304)"`

### Task 17: Outcome chip rendering + PR-3 gate

**Files:** Modify `ReviewCommentRow.tsx` (outcome chip for `author:'agent'`); Test; then full gate.

- [ ] **Step 1: Write the failing test** — an `author:'agent'` comment with `outcome:'clarify'` renders an "awaiting you" chip; `resolved`/`deferred`/`rejected`/`reply` render their chips.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the outcome chip (reuse the category-chip styling; a small state chip keyed on `outcome`).
- [ ] **Step 4: Full gate** — `npm run lint && npm run format:check && npm run type-check && npx vitest run src/features/diff src/features/workspace && cargo test -p vimeflow agent::` · Expected: all green.
- [ ] **Step 5: Commit** — `git commit -am "feat(diff): outcome chips (VIM-304)"`

**PR-3 done.** Open `feat(diff): finding threads + agent outcome axis (VIM-304c)`, `Part of VIM-304`. The full multi-turn thread render + the user's outbound reply land with VIM-298 / VIM-297.

---

## Follow-ups (not this plan)

- **Kimi / OpenCode** review capture (streaming adapters — same deferral as VIM-293).
- **VIM-298 / VIM-297** — the multi-turn thread UI + the user's single-turn reply dispatch (this plan places the turns; those render + send them).
- **Dispatch-time snapshot precision** — per-finding staged side; content-drift detection.
