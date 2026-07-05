# Inline Agent Q&A — structured agent replies in the diff thread

**Issues:** VIM-249 (frontend Q&A thread) + VIM-283 (backend reply capture), epic VIM-284 (Inline Agent Q&A).

**Delivery:** one design, two sequenced PRs at the backend/frontend seam. Each section below is tagged with the PR that owns it.

- **PR-1 = VIM-283 (backend):** the Codex transcript decoder extracts the reply block, schema-validates it, and emits a typed `agent-reply` event (the typed replies **or** a malformed marker, plus the raw reply text). Unit-tested in Rust; dormant in the live app until PR-2 instructs the agent to emit the block.
- **PR-2 = VIM-249 (frontend):** the dispatch instruction plus the diff-side thread — listen, correlate `[#n]`→comment, attach, render, and own every fallback/degrade decision.

## Goal

Turn the one-way review dispatch into a two-way thread. A user comment is already dispatched to the agent's terminal as a `[#n · Category]` block (VIM-253) that tells the agent to **answer** (Question) or **change** (Change/Bug/Suggestion) and to reply per `[#n]`. This design adds the return path: the agent emits a **structured reply**, the app captures it, and renders it in the DiffView thread under the comment that asked.

**Scope this round:**

- **Codex adapter only.** The extraction seam is shared, so a Claude Code patch is small; Kimi and OpenCode are an explicit follow-up.
- **Diff-thread-only ingestion** — the reply renders in DiffView; it is not (this round) surfaced in the agent-status activity feed.

**Non-goal (from VIM-249):** do not build a second comment renderer. Reuse the existing inline annotation primitives — an `author: 'agent'` annotation already renders distinctly and read-only (VIM-256).

## Section 1 — The reply contract *(shared: PR-1 validates schema, PR-2 correlates + decides fallback)*

The dispatch footer (today: `> When done, reply referencing each [#n].`) is extended to instruct the agent to **end its reply with a sentinel-wrapped JSON block**:

```
<<<VIMEFLOW_REPLY
{"v":1,"replies":[{"id":1,"status":"answered","text":"The cap bounds tail latency; raising it risks pileups."}]}
VIMEFLOW_REPLY>>>
```

### Ownership — which PR decides what

Split so neither PR makes a decision it lacks context for:

- **PR-1 (backend) — schema only.** Detects the sentinel, extracts the block, validates it against the schema below. It has **no dispatch context** (it doesn't know which `[#n]` were sent), so it never correlates ids or decides fallback. It emits **one** `agent-reply` event carrying `sessionId`, the **raw reply text**, and either the **typed `replies[]`** (schema-valid) or a **malformed marker** (sentinel present, schema-invalid).
- **PR-2 (frontend) — correlation + fallback.** Matches each `reply.id` to a pending dispatched `[#n]` for that pane and owns every fallback decision (unmatched ids, malformed marker, no pending review).

### Fields

- **`v`** — schema version, integer, currently `1`.
- **`replies[]`** — a non-empty array; one entry per `[#n]` the agent addressed:
  - **`id`** — a positive integer within `u32` range, the `[#n]` handle.
  - **`status`** — exactly one of `"answered"`, `"changed"`, `"skipped"`.
  - **`text`** — string (may be multi-line); the agent's answer or change-summary.

### Schema validation (PR-1)

A block is **valid** only if all of these hold; any violation makes it **malformed** (→ degrade):

- the text between the sentinels parses as JSON and is an object;
- `v === 1` (any other value, or missing, is malformed — the field is reserved for future shapes);
- `replies` is a **non-empty** array;
- each entry has an `id` that is a positive integer within `u32` range (zero, negative, or over `u32::MAX` → malformed), a `status` that is exactly one of the three literals, and a string `text`;
- `id`s are **unique** within the block.

Empty `replies`, wrong types, unknown `status`, or duplicate `id`s all fail — the backend emits the **malformed marker** rather than a half-typed event, so both PRs share one failure path.

### Delimiters + the emit trigger

- Open `<<<VIMEFLOW_REPLY`, close `VIMEFLOW_REPLY>>>`, each on its own line. The backend scans the assistant text for the first open and the next close and parses the JSON between — surviving surrounding prose or a markdown fence the agent may add.
- **The open sentinel is the trigger.** The backend emits `agent-reply` **only** when the open sentinel appears in a completed assistant turn. Ordinary Codex turns (no sentinel) produce no event — nothing reaches the thread.
- An **open sentinel with no matching close** is a truncated block → treated as malformed, `raw` spanning the open sentinel to end of text (the user still sees the reply as a degrade note).

### Degrade + the pending-review gate (PR-2, never throws, never corrupts run state)

The frontend acts on an `agent-reply` event **only while it has a dispatched review awaiting a reply for that pane** (`event.sessionId === ptyId`). With no pending review, the event is ignored — a stray sentinel in unrelated agent output cannot mutate the thread. Given a pending review:

- **Valid + matched:** attach each reply whose `id` matches a pending `[#n]` as an `author: 'agent'` annotation on that comment. `id`s with no pending match are dropped (dev-logged). Comments with no reply keep waiting.
- **Valid but no `id` matches any pending `[#n]`:** treated as malformed (the agent answered the wrong handles).
- **Malformed marker:** degrade — attach the **raw reply text** as one plain-text `author: 'agent'` note on the review. No per-`[#n]` attach; no error; run/activity state untouched.

### Why sentinel + JSON (not markdown parsing or NL heuristics)

- Machine-delimited → extraction is a substring scan, not a fragile markdown/natural-language parse.
- JSON gives typed fields the ts-rs binding carries cleanly across the Rust→TS boundary.
- The `v` field lets the two PRs and future adapters evolve the shape without silent breakage.

## Section 2 — Backend capture *(PR-1 = VIM-283)*

In the Codex rollout JSONL, the completed agent prose arrives as an `event_msg` record with `payload.type == "task_complete"`, in the **`last_agent_message`** field. The decoder today routes `event_msg` lifecycle/user records and `response_item` tool records but drops that prose. PR-1 adds a return path from `last_agent_message`.

### Shared extraction + validation helper

New `crates/backend/src/agent/reply.rs`, adapter-agnostic so the other adapters become a one-line call later:

```rust
pub(crate) enum AgentReplyOutcome {
    Malformed { raw: String },
    Structured { raw: String, replies: Vec<AgentReply> },
}

/// None                       → no open sentinel (not a reply — emit nothing).
/// Some(Malformed { raw })     → open sentinel present but no close, or schema-invalid.
/// Some(Structured { .. })     → valid.
pub(crate) fn extract_agent_reply(reply_text: &str) -> Option<AgentReplyOutcome>;
```

The sentinel scan, JSON parse, and the Section-1 schema validation live here **once**. `raw` is the text between (and including) the sentinels — the frontend's degrade note. Each adapter passes the assistant text it already reads; no adapter re-implements the contract.

### Event type

New ts-rs types emitted as `agent-reply` over the existing `EventSink` → IPC path:

```rust
// `pub(crate)` so the Codex decoder can construct them; derives match the
// existing agent events (Serialize + ts_rs::TS) so the serialize_event + binding
// path works. Renames give camelCase fields + lowercase status literals — the
// shape the frontend contract expects.
#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentReplyEvent {
    session_id: String,   // → "sessionId"
    raw_text: String,     // → "rawText"
    replies: Option<Vec<AgentReply>>,
}

#[derive(Clone, Serialize, ts_rs::TS)]
pub(crate) struct AgentReply { id: u32, status: AgentReplyStatus, text: String }

#[derive(Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentReplyStatus { Answered, Changed, Skipped } // → "answered" | "changed" | "skipped"
```

- `replies: Some(..)` — the schema-valid typed replies.
- `replies: None` — **is** the malformed marker; `raw_text` carries the full reply for the frontend's degrade note.
- `raw_text` is always present (used for degrade, and available for diagnostics).

### Codex decoder wiring

When the decoder handles the `task_complete` `event_msg`, run `extract_agent_reply` on `payload.last_agent_message` (the completed reply for that turn — inherently end-of-turn, so no partial block fires early). If the `task_complete` DTO doesn't already carry `last_agent_message`, add the field. On `Some(outcome)`, map it to an `AgentReplyEvent` and `emit_agent_reply(...)` via the existing `events.rs` emitter pattern (mirrors `emit_agent_turn`). On `None`, do nothing. `session_id` is the PTY session id the rest of the event stream already carries.

Regenerate bindings (`AgentReplyEvent.ts`, `AgentReply.ts`, `AgentReplyStatus.ts`).

### Tests (the coverage while dormant-live)

Rust unit tests over `extract_agent_reply` + the emit path:

- valid block → `Structured` with the typed replies;
- sentinel present + malformed JSON → `Malformed`;
- sentinel + schema-invalid (empty `replies`, non-array `replies`, string `id`, unknown `status`, duplicate `id`) → `Malformed`;
- no sentinel → `None` (no event);
- block wrapped in a markdown fence with surrounding prose → still extracted;
- multi-line `text` round-trips.

### Dormant-live note

Until PR-2 adds the dispatch instruction, no agent emits the sentinel, so `agent-reply` never fires in normal use. The Rust unit tests are PR-1's coverage; the live round-trip is exercised in PR-2.

## Section 3 — Frontend correlation + ingestion *(PR-2 = VIM-249)*

### Dispatch instruction

Extend `feedbackDispatch`'s footer from `> When done, reply referencing each [#n].` to instruct the agent to end its reply with the Section-1 sentinel block (spell out the exact format + a one-line example in the prompt). This is the only change to the dispatched payload; the `[#n · Category]` item blocks are unchanged.

### Pending-review record — the gate + the `[#n]`↔comment map

At dispatch, record the correlation state — keyed by `ptyId`, but carrying the **feedback owner** so a reply lands on the *dispatched* review even if the user has since switched panes:

```ts
interface PendingReview {
  ptyId: string
  ownerKey: string     // the feedback owner (sessionId:paneId) at dispatch time
  dispatchedAt: number // generation stamp
  // [#n] → the comment it addressed, in the order buildFeedbackEntries numbered them.
  byHandle: Map<
    number,
    { cwd: string; filePath: string; staged: boolean; commentId: string; lineNumber: number; side: AnnotationSide }
  >
}
```

`byHandle` is built from the **same ordered iteration** `buildFeedbackEntries` uses to assign `[#n]`. Stored in a module store `pendingReviewsByPty` (keyed by `ptyId`), replaced on the next dispatch to that pty. It is correlation state, not persisted review data — the comments themselves persist via VIM-282.

### Capture hook

`useAgentReply` mirrors `useAgentStatus`'s subscription pattern — `listen('agent-reply', ...)` — and lives where **all** feedback owners are reachable (alongside `useFeedbackBatchStore` in WorkspaceView), so it can attach to a specific owner. For each event:

1. **Gate:** look up `pendingReviewsByPty[event.sessionId]`. None → ignore (a stray sentinel in unrelated agent output cannot touch the thread).
2. **`replies: Some`:** resolve each `reply.id` against `byHandle`.
   - If **no** id matches any pending handle → treat the whole event as malformed (degrade, below).
   - Otherwise, for each matched id: attach an `author: 'agent'` annotation carrying `reply.text` at that comment's `{ lineNumber, side, filePath, staged }` **on the record's `ownerKey`** — an owner-addressed `addAnnotation(ownerKey, …)`, so the reply lands on the dispatched review's batch, not the active pane's — then **remove the handle from `byHandle`** so a replayed event can't attach it twice. Ids with no match (in a mixed reply) are dropped, dev-logged.
3. **`replies: None` (malformed marker):** attach `event.rawText` as one `author: 'agent'` note on the record's `ownerKey`.
4. **Close the gate:** if `byHandle` is now empty, **delete the record**. The review is fully answered, so a duplicate/replayed or later unrelated `agent-reply` finds no pending handle and is ignored.

This needs one small store addition — an **owner-addressed** `addAnnotation(ownerKey, …)`, since today's `addAnnotation` binds to the active owner.

### Reuse VIM-256 rendering

The attached `author: 'agent'` annotation renders as **"Agent reply"** — distinct, read-only — at the question's line. The thread is the co-located dispatched user comment (its category chip) plus the agent reply. No new renderer (the VIM-249 non-goal).

### Lifecycle

An attached reply is an ordinary annotation — it persists like any comment (VIM-282). The `pendingReviewsByPty` record is **consumed as handles attach and deleted when empty**, so a duplicate/replayed `agent-reply` is a no-op. A new dispatch to the same pty replaces the record. A never-answered dispatch leaves a record until the next dispatch, fillable only by a reply whose `sessionId` matches — harmless. Owner-addressed attachment means switching panes before the reply arrives does not misroute it.

### Tests

- **correlation:** an `agent-reply` for a pending `ptyId` attaches replies to the right comments by `[#n]`;
- **gate:** an event whose `sessionId` has no pending record is ignored;
- **owner-routed:** a reply attaches to the *dispatching* owner's review even after the active pane changed;
- **degrade (all-unmatched):** a reply whose ids match no pending handle degrades the whole event to a `rawText` note;
- **unmatched (mixed):** a reply with some valid handles plus one unknown id attaches the valid ones and drops the unknown;
- **degrade (marker):** `replies: null` attaches `rawText` as one agent note;
- **partial:** a reply covering a subset of handles attaches those, leaves the rest waiting;
- **idempotent:** a replayed `agent-reply` after its handles are consumed is a no-op.

## Section 4 — Rollout, scope, and risks *(both PRs)*

### PR sequencing

- **PR-1 (VIM-283, backend):** `extract_agent_reply` + `AgentReplyEvent` (binding) + Codex `task_complete` wiring + Rust tests. Merges **dormant-live** (no dispatch instruction yet).
- **PR-2 (VIM-249, frontend):** the dispatch instruction + `pendingReviewsByPty` + `useAgentReply` + the owner-addressed `addAnnotation` + the thread render (VIM-256) + degrade. Depends on PR-1's generated binding. Merging PR-2 lights up the round-trip.

### Adapter scope + seam

`extract_agent_reply` is adapter-agnostic — the sentinel, JSON, and schema live in one place. **Codex** is wired this round (call it on `last_agent_message`). A **Claude Code** patch is a follow-up: call the same helper on the assistant text blocks its decoder already reads (`process_assistant_message`) and emit the same event — no contract change. **Kimi / OpenCode** follow the same one-call pattern later. Each adapter's wiring is small; the contract and the entire frontend are untouched per adapter.

### Preserving the one-way flow

The only change to the dispatched payload is the footer instruction to emit the block. The existing **finish-feedback send** and the **copy-to-clipboard escape hatch** (when no agent is running) are unchanged. If the agent doesn't emit a block, the review simply gets no thread reply — the user still sees the answer in the terminal. No regression to the one-way path.

### Security / trust boundary

`reply.text` and `rawText` are **agent-controlled** and render as **plain text** in an annotation (React escapes it — no HTML/markdown injection). The block is parsed defensively (any malformation → degrade, never throws). Correlation is bounded to the review's own pending `[#n]` on the dispatching owner — a reply can only annotate comments the user already dispatched. No path executes agent text.

### Risks / open questions

- **Prompt adherence** — Codex may not always emit the block. Graceful degrade covers it (no block → no thread reply); PR-2 should sanity-check Codex adherence with a real dispatch before wider rollout.
- **Sentinel collision** — an agent quoting the sentinel in prose. Low risk (unique literal); the parser takes the first open…close pair.
- **Superseded dispatch** — a second dispatch to the same pty replaces the record; a late reply for the old dispatch whose ids don't match is dropped/degraded. The `dispatchedAt` stamp is available to reject stale replies if this proves noisy.
