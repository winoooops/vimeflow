# Delegated review-agent feedback as hunk reviewer comments — VIM-304

**Issue:** VIM-304 (epic VIM-284 — Inline Agent Q&A).

**Delivery:** one design, 2–3 sequenced PRs at the backend/frontend seam. VIM-304 owns the review contract, backend capture, findings-as-thread-roots, and the main-agent-reply-into-finding capability. Multi-turn thread **rendering** and the user's **reply dispatch** compose with **VIM-298** (thread continuation) + **VIM-297** (single-comment dispatch).

**Builds on (all merged):** the agent-reply capture — `crates/backend/src/agent/reply.rs::extract_agent_reply` (sentinel `<<<VIMEFLOW_REPLY … VIMEFLOW_REPLY>>>`), `emit_agent_reply`, `AgentReplyEvent`; frontend `useFeedbackBatch` (`ReviewComment { id, text, author: 'self' | 'agent', category?, createdAt, dispatchedAt?, target? }`), `addAnnotationForOwner`, `pendingReviews`, `useAgentReply`, and `ReviewCommentRow` (renders `author: 'agent'` distinctly).

## Goal

Turn a delegated code review into first-class, threaded reviewer feedback in the diff. When the user asks the primary agent to delegate a review, the delegated reviewer's findings are captured from the completed turn, placed as anchored reviewer annotations (with the reviewer's self-reported name + a category), and each finding becomes a **thread root** the main agent and user continue on.

**Distinct from VIM-249/283:** those correlate an agent *reply* to a *pending user comment* (nonce + `[#n]` handles). Delegated findings are *unsolicited* and *self-anchoring* — they carry their own `path`/`line`/`side`/`scope`, with no user comment to correlate against. Same extraction plumbing, a parallel contract.

## Section 1 — The review contract *(shared: PR-1 validates schema, PR-2+ dispatch / place / thread)*

A diff-side **"Request review"** affordance dispatches (bracketed-paste, like the existing feedback dispatch) an instruction telling the primary agent to delegate a code review and **end its reply with a sentinel-wrapped JSON block**:

```
<<<VIMEFLOW_REVIEW
{"v":1,"nonce":"r7k2m9","reviewer":"codex","findings":[
  {"path":"src/auth.ts","scope":"line","side":"additions","line":42,"category":"bug","text":"Token compared with == ; use ==="},
  {"path":"src/auth.ts","scope":"range","side":"additions","startLine":88,"endLine":94,"category":"suggestion","text":"Unreachable when the cache is warm."},
  {"path":"src/db.ts","scope":"file","category":"bug","text":"No connection pooling; a socket per query."}
]}
VIMEFLOW_REVIEW>>>
```

### Dispatch instruction (the "Request review" payload)

The affordance mints a per-dispatch `nonce` and sends an instruction telling the agent to: **(a)** delegate a code review of a **specific diff scope** — the instruction names the repo-relative paths and the **staged / unstaged mode** being reviewed (the view the affordance was invoked on), so the reviewer inspects the same hunks the app will place against (e.g. "review the *unstaged* diff of these files: …"); **(b)** anchor each finding with **diff-side line coordinates** — `side: "additions"` uses **new-file** line numbers, `side: "deletions"` uses **old-file** line numbers (the convention the diff annotations already use); **(c)** end its reply with the block above, **echoing the nonce verbatim** and self-reporting the reviewer's name; **(d)** additionally give a **short prose overview** in its normal reply (not inside the block) — useful context, especially on low-finding reviews. The `[#n]`-style per-comment item blocks of the feedback dispatch are not used here (findings self-anchor).

### Fields

- **`v`** — schema version, integer, currently `1`.
- **`nonce`** — non-empty string; the echoed dispatch token. PR-1 validates only that it is a non-empty string (it has no dispatch context); the frontend checks it equals the pending request's nonce.
- **`reviewer`** — non-empty string; the delegated reviewer's self-reported name (`"codex"`, `"gemini"`, …), rendered as the annotation's identity.
- **`findings[]`** — an array of anchored findings; **may be empty** (a clean review with nothing to place is valid — the narrative lives in the prose overview, and the empty block still echoes the nonce to acknowledge the request). One entry per finding:
  - **`scope`** — exactly one of `"line"` | `"range"` | `"file"`.
  - **`path`** — repo-relative file path. Required for all three scopes.
  - **`side`** — `"additions"` | `"deletions"`. Required for `line` / `range`.
  - **`line`** (line scope) or **`startLine`/`endLine`** (range scope) — positive integers within `u32` range; `startLine ≤ endLine`. **Coordinate space:** new-file line numbers for `side: "additions"`, old-file line numbers for `side: "deletions"` (matching `side`).
  - **`category`** — exactly one of `"bug"` | `"suggestion"` | `"change"` | `"question"` (the existing `ReviewCommentCategory`).
  - **`text`** — non-empty string; the finding body (may be multi-line).

### Schema validity (PR-1)

A block is **valid** only if all hold: the text between the sentinels parses as JSON and is an object; `v === 1`; `nonce` is a non-empty string; `reviewer` is a non-empty string; `findings` is an array (**possibly empty**); and **every** finding present has a valid `scope` literal, a valid `category` literal, a non-empty `text`, and the anchor fields its scope requires — line → `path` + `side` + a positive `line`; range → `path` + `side` + positive `startLine ≤ endLine`; file → `path`. Any violation makes the **whole block malformed** → degrade to one plain-text reviewer note carrying the raw block (the same failure philosophy as agent-reply).

**Best-effort nonce on malformed (mirrors `extract_agent_reply`).** When the block fails schema validation, the parser still extracts a **best-effort nonce** — leniently, even from an object that otherwise fails — so the malformed reviewer note can be nonce-gated and routed like any other. A block so broken that no nonce can be recovered cannot be gated or routed and is **ignored** (a stray sentinel in unrelated output must not mutate the diff). This is exactly the pattern `reply.rs` ships today (`Malformed { raw, nonce: Option<String> }`).

### File identity: the staged/unstaged axis

The app keys a diff file by **`(path, staged)`** and can show **two rows for one path** (a partially-staged file — see `ChangedFile.staged` and the `ChangedFilesList` key). Findings anchor by `path` + `side` + line/range; the **`staged` axis is inherited from the Request-review's diff context** — the view the affordance was invoked on, recorded in the pending request — so `(path, staged)` is unambiguous at placement. A finding is **not** expected to report staged/unstaged (the delegated reviewer sees file content, not the git index). **Known v1 limitation:** for a path present on *both* sides, findings land on the invoked view's side; per-finding staged precision is a future add, not part of this contract.

### Anchored-only; the overview is prose

No `session` scope — the block carries only anchored findings. The review's **overview** is prose the agent returns in its normal reply (not a structured finding, not a hunk annotation). The dispatch asks for it so the main agent has context to act on, especially on clean / low-finding reviews.

### Placement fallback (never silently dropped)

**Malformed is reserved for schema violations.** A schema-valid finding whose **anchor can't be resolved at placement time** degrades rather than dropping, in two cases:

- **`path` is in the reviewed diff, but the line/range isn't** (e.g. `line` outside that file's hunks) → attach as a **file-level** note on `(path, staged)` — there is a file row to render under.
- **`path` is not in the reviewed diff at all** (the reviewer referenced an out-of-scope file) → there is **no** `(path, staged)` row to anchor under, so attach it to a **review-level fallback** surfaced with the request (kept visible, grouped as an "unplaceable finding"), never dropped.

Resolution is against the request's **diff snapshot**, captured at dispatch (Section 3 pins the record + the exact semantics); the contract only fixes that **nothing is discarded** — every schema-valid finding lands somewhere visible.

### Why a separate block from `agent-reply`

Replies answer a pending user comment and correlate by `[#n]` to that comment's line; review findings are agent-authored and **self-anchor** to arbitrary lines / files. Overloading one block would force every reply consumer to branch on two shapes. A parallel block + event (`agent-review`) keeps each contract single-purpose and reuses only the sentinel-extraction plumbing.

## Section 2 — Backend capture *(PR-1)*

The same completed-turn text the adapters already scan for the reply block (`last_agent_message` on a Codex `task_complete`; the assistant `text` blocks on a completed Claude Code turn — `end_turn` / `stop_sequence` / `max_tokens`) is scanned for the **review** block too. PR-1 adds an adapter-agnostic extractor + a typed `agent-review` event, mirroring the VIM-283 reply capture. It merges **dormant-live** — no agent emits the review block until the frontend (PR-2) adds the Request-review dispatch, so `agent-review` never fires in normal use; the Rust unit tests are PR-1's coverage.

### Shared extraction + validation helper

New `crates/backend/src/agent/review.rs`, adapter-agnostic (sibling to `reply.rs`):

```rust
pub(crate) enum AgentReviewOutcome {
    // best-effort nonce: Some when the block parsed as an object carrying a
    // nonce, None when unparseable — the frontend nonce-gates on it (Section 1).
    // both nonce and reviewer are best-effort on malformed — recovered leniently
    // from a parseable-but-invalid object so the degrade note can be gated (nonce)
    // and named (reviewer); either may be None when unrecoverable.
    Malformed { raw: String, nonce: Option<String>, reviewer: Option<String> },
    Structured {
        raw: String,
        nonce: String,
        reviewer: String,
        findings: Vec<AgentReviewFinding>, // may be empty (a clean review)
    },
}

/// None                     → no open sentinel (not a review — emit nothing).
/// Some(Malformed { .. })   → sentinel present but truncated or schema-invalid.
/// Some(Structured { .. })  → schema-valid (findings may be empty).
pub(crate) fn extract_agent_review(reply_text: &str) -> Option<AgentReviewOutcome>;
```

Sentinel `<<<VIMEFLOW_REVIEW` / `VIMEFLOW_REVIEW>>>`, each on its own line; the scan takes the first open + the next close and parses the JSON between (surviving surrounding prose or a markdown fence), exactly as `extract_agent_reply`. The `> `-prefix strip (`normalize_reply_json`) is shared so a bracketed-paste echo doesn't break parsing.

### Event types (`types.rs`, beside `AgentReplyEvent`)

Mirror the existing agent-event pattern exactly — `pub struct` with `pub` fields, test-gated ts-rs export, camelCase / lowercase renames:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentReviewEvent {
    pub session_id: String,
    pub nonce: Option<String>,    // best-effort on malformed; None if unparseable
    pub reviewer: Option<String>, // best-effort on malformed; frontend falls back to a label
    pub raw_text: String,         // the degrade note
    pub findings: Option<Vec<AgentReviewFinding>>, // None = malformed marker; empty = clean
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
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

// Each gets the full derive stack + test-gated ts-rs export, mirroring
// AgentReplyStatus — and serializes to the exact literals the frontend already
// uses (no mapping layer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ReviewFindingScope { Line, Range, File }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ReviewFindingSide { Additions, Deletions }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ReviewFindingCategory { Bug, Suggestion, Change, Question }
```

`ReviewFindingSide` / `ReviewFindingCategory` serialize to the exact literals the frontend `AnnotationSide` / `ReviewCommentCategory` already use.

### Emitter (`events.rs`)

`pub(crate) fn emit_agent_review(events: &dyn EventSink, payload: &AgentReviewEvent)`, event name `"agent-review"`, mirroring `emit_agent_turn` / `emit_agent_reply`.

### Adapter wiring

`emit_review_if_present` is called from the **exact same guarded site** as `emit_reply_if_present`, so it inherits that site's gating rather than re-deriving a narrower one:

```rust
fn emit_review_if_present(reply_text: &str, session_id: &str, events: &Arc<dyn EventSink>) {
    let Some(outcome) = extract_agent_review(reply_text) else { return };
    // map Structured / Malformed → AgentReviewEvent, then emit_agent_review(...)
}
```

- **Codex** (`adapter/codex/transcript.rs`): in the `TaskComplete` arm on `last_agent_message`, **immediately after** the existing `emit_reply_if_present` call — same completed-turn point, same replay handling.
- **Claude Code** (`adapter/claude_code/transcript.rs`): in the assistant path, **immediately after** `emit_reply_if_present`, under the **same completion gate** it uses — `stop_reason ∈ { end_turn, stop_sequence, max_tokens }` (not `end_turn` alone) — and the **same `replay_done` suppression**, so a replayed transcript never re-emits a stale review. Do not add a second, narrower gate; run the review extractor exactly where the reply extractor already runs, on the same concatenated `text` blocks.
- Kimi / OpenCode: a follow-up (the same streaming-adapter deferral as VIM-293), out of scope here.

A completed, non-replayed turn is scanned for **both** sentinels independently — it can carry a reply block, a review block, or neither.

## Section 3 — Frontend ingestion + placement *(PR-2)*

### The "Request review" affordance + dispatch

A diff-side action (**"Request review"**, beside the existing Finish / Copy feedback controls) mints a per-dispatch `nonce` and dispatches the Section-1 instruction to the active agent's PTY (bracketed-paste, via the same `writePty` path as `dispatchFeedbackBatch`). It records a **pending review request** so the eventual `agent-review` can be gated + routed.

### Pending review request record

Parallel to `pendingReviews` (the reply-correlation store), a `pendingReviewRequests` store keyed by **nonce** (forward-compatible with VIM-297's nonce-keying — multiple requests can be in flight on one pty):

```ts
interface HunkRange { start: number; end: number } // diff-side line range

interface PendingReviewRequest {
  nonce: string
  ptyId: string
  ownerKey: string // sessionId:paneId at dispatch — findings route here
  cwd: string
  staged: boolean // the invoked diff view's axis; findings inherit it
  // The diff the reviewer was given, captured at DISPATCH: each reviewed file's
  // hunk line ranges per side. This is BOTH the scope named in the dispatch
  // instruction AND the placement resolver (below) — so a finding resolves
  // against exactly what the reviewer saw, immune to edits after dispatch.
  diffSnapshot: Array<{ path: string; additions: HunkRange[]; deletions: HunkRange[] }>
  dispatchedAt: number
}
```

No `[#n]` map — findings self-anchor. `ownerKey` routes the findings; `cwd` + `staged` form the batch key; **`diffSnapshot` is the single placement data source** — which `path`s exist and which lines are inside a hunk (for the file-level-vs-review-level fallback). Capturing it at dispatch (the app already has the diff loaded to render the view) removes the need to refetch or read live diff state at arrival, and eliminates drift.

### Capture hook — `useAgentReview`

Mirrors `useAgentReply`'s subscription; lives where all feedback owners are reachable (WorkspaceView). For each `agent-review` event:

1. **Gate (session + nonce):** look up `pendingReviewRequests[event.nonce]`. Ignore unless it exists, `event.nonce != null`, **and `event.sessionId === request.ptyId`** — matching the `agent-reply` contract (session id *and* nonce, not nonce alone). A stray sentinel or an ungateable review cannot touch the diff.
2. **`findings: Some` (structured):** for each finding, build an `author: 'reviewer'` annotation and place it (below) on the request's `ownerKey` via `addAnnotationForOwner`.
3. **`findings: null` (malformed marker):** attach one `author: 'reviewer'` plain-text note carrying `event.rawText`, named `event.reviewer ?? 'Reviewer'` (best-effort reviewer, else a fixed fallback label), at the review-level fallback surface.
4. **Clear the request** after processing (structured or malformed) so a replayed `agent-review` for that nonce is a no-op.

### Reviewer identity on `ReviewComment`

Extend the annotation model minimally:

```ts
author: 'self' | 'agent' | 'reviewer'   // + 'reviewer'
reviewer?: string                        // the delegated reviewer's name (when author === 'reviewer')
```

`category` is reused for the finding's category; `text` for the body.

**Correct the "pending" predicate (required).** Today `isPendingReviewAnnotation` is `author !== 'agent' && dispatchedAt === undefined`, so a `'reviewer'` annotation slips through as pending. The correct predicate is **`author === 'self' && dispatchedAt === undefined`** — only the user's *own undispatched* comments are pending; every `'agent'` / `'reviewer'` annotation is excluded (never counted toward the 50-comment cap, never dispatched or discarded as the user's feedback). Apply the same `author === 'self'` narrowing anywhere the soft-cap or dispatch path currently keys off `author !== 'agent'`.

### Placement + fallback

Each finding maps to a `DiffLineAnnotation<ReviewComment>` placed via `addAnnotationForOwner(ownerKey, cwd, path, staged, annotation)`:

- **line** → `{ lineNumber: line, side, metadata: { author:'reviewer', reviewer, category, text } }`.
- **range** → `target: { scope:'range', side, startLine, endLine }`, `lineNumber: startLine` (reuses the existing range-scope target from VIM-282/256).
- **file** → `target: { scope:'file' }`, `lineNumber: FILE_COMMENT_LINE_NUMBER (0)`.

**Anchor resolution + fallback** (Section 1). Anchors resolve against the request's **`diffSnapshot`** (captured at dispatch — the exact hunks the reviewer was given), so a finding places against what the reviewer actually saw, immune to edits after dispatch:
- `path` in the snapshot, and `line`/`range` falls inside a hunk range for that `side` → place at the anchor.
- `path` in the snapshot, but the line/range is **outside** every hunk range → downgrade to a **file-level** annotation on `(path, staged)`.
- `path` **not** in the snapshot → **review-level fallback** (Section 5), never dropped.

Because resolution is against the immutable snapshot, there is no drift-vs-live ambiguity: the reviewer's coordinates always map to the hunks it was shown. The placed annotation is then stored on the batch key `(cwd, path, staged)` and renders whenever the DiffView shows that file/side — the **same persistence property as every review comment** (VIM-282). If the user re-stages the file *after* placement, the annotation follows the `(cwd, path, staged)` key exactly as a user comment would; the snapshot fixes *where the reviewer's coordinates resolve*, not the batch key's later visibility (which is existing VIM-282 behavior, not a new failure mode).

### Lifecycle

Placed reviewer annotations persist like any comment (VIM-282) and become **thread roots** (Section 4). The `pendingReviewRequests` record is cleared once its `agent-review` is processed; a never-answered request is a harmless stale record (cleared on the next request to that pty, or by a TTL sweep — implementation detail).

### Tests

- **gate:** an `agent-review` whose nonce has no pending request is ignored;
- **placement:** line / range / file findings attach as `author: 'reviewer'` annotations on `(cwd, path, staged)` with the reviewer name + category;
- **staged routing:** a finding lands on the request's `staged` side, not the active view's;
- **fallback (line OOR):** an out-of-range line downgrades to a file-level note;
- **fallback (path not in diff):** an off-diff path attaches to the review-level surface, not dropped;
- **degrade:** `findings: null` attaches one reviewer note carrying `rawText`;
- **clean:** an empty `findings` array places nothing and clears the request;
- **idempotent:** a replayed `agent-review` after the request is cleared is a no-op.

## Section 4 — Type taxonomy + finding threads *(PR-2/3)*

Where a finding stops being a static annotation and becomes a **thread** the main agent and user continue on. It **extends** the shipped agent-reply contract rather than duplicating it.

### The two-axis taxonomy

Every thread turn has an **author** and (optionally) a **type**; the author selects the axis:

| Author | Turn | Type axis |
| --- | --- | --- |
| `self` (user) | root comment | `category` — question / change / bug / suggestion |
| `self` | reply inside a thread | **none** (an answer isn't an intent) |
| `reviewer` (delegated) | a finding | `category` (raising an issue) |
| `agent` (main) | every turn | `outcome` (below) |

`category` and `outcome` are **both optional** on `ReviewComment`. The user / reviewer *raise* (intent); the main agent *responds* (outcome).

### The agent `outcome` enum

Add to `ReviewComment`: `outcome?: 'reply' | 'clarify' | 'resolved' | 'deferred' | 'rejected'` — set when `author === 'agent'`.

| Value | Meaning | Awaits user? |
| --- | --- | --- |
| `reply` | answers the user | no |
| `clarify` | asks the user | **yes** |
| `resolved` | made the change / fixed the finding | no |
| `deferred` | punts for later (cites an issue # in `text` if one was filed) | no |
| `rejected` | declined / disagreed | no |

This **supersedes the shipped `AgentReplyStatus`** (`answered` / `changed` / `skipped`). The new literals are canonical; for resilience the parser also accepts the three legacy literals with a **fixed, deterministic map**: `answered → reply`, `changed → resolved`, **`skipped → rejected`**. `deferred` is reachable **only** via the new literal (the agent emits it explicitly — the legacy `skipped` can't disambiguate defer-vs-reject, so it maps to the more conservative `rejected`). No persisted `status` data exists to back-fill (the shipped `ReviewComment` never stored a status), so the map only covers **in-flight legacy blocks**. **It is a contract change to the merged VIM-249/283/292 reply path** — the backend `AgentReplyStatus` enum, the reply block's `status` literals, and `useAgentReply`'s consumption all move to the outcome vocabulary. Sequence it as its own step (it touches shipped code + regenerates the binding). `working` (in-progress) and `issue-filed` are intentionally **out** (before-patch is prose; a filed issue is `deferred` + an issue # in `text`).

A turn's `outcome` is per-turn; a **thread's rollup status** is *derived* from the latest agent turn — not stored. The mapping is 1:1 with the outcome of that turn: `resolved` → "resolved", `deferred` → "deferred", `rejected` → "rejected", `clarify` → "awaiting you", `reply` → "replied" (open — the agent responded but the finding isn't closed).

### Findings are thread roots (stable ids)

Each placed finding gets a **stable id** so a later agent turn can address it. The Section-3 pending-review-request **transitions** (rather than merely clears) once its `agent-review` is processed: into a **finding-thread record** keyed by **`(ptyId, nonce)`**, mapping each finding's **ordinal** (its 1-based index in the block — which the agent knows, having emitted them) → that finding's **target record**. **Every** finding gets a stable `commentId` and a target entry — anchored *or* review-level fallback (Section 3) — so a `target:"finding"` reply resolves uniformly regardless of where the finding landed:

- **anchored** → `{ kind: 'anchored', ownerKey, cwd, path, staged, commentId }`
- **review-level** (unplaceable — no `(path, staged)` row) → `{ kind: 'reviewLevel', ownerKey, commentId }`; a reply to it attaches to the review surface (Section 5), not a diff row.

The record carries `ptyId` so a `target:"finding"` reply upholds the **same session + nonce gate** as `agent-reply` (resolve only when `event.sessionId === record.ptyId` **and** `event.nonce === record.nonce`). The record persists for the thread's life; a replayed `agent-review` finds no pending *request* (already transitioned) and is a no-op. (This refines Section 3's "clear the request" — clearing the *request* is the transition into the thread record.)

### Unified reply target — the agent posts into a finding

The main agent posts into a finding's thread with the **same reply block** it uses for user comments, distinguished by a per-entry target:

```
<<<VIMEFLOW_REPLY
{"v":1,"nonce":"r7k2m9","replies":[{"target":"finding","id":1,"status":"resolved","text":"Changed to === at line 42."}]}
VIMEFLOW_REPLY>>>
```

- **`target`** — `"comment"` (default, existing) | `"finding"`. Selects the handle space.
- **`nonce`** — selects the pending record: a feedback-dispatch nonce → `pendingReviews` (user comments); a review nonce → the finding-thread record.
- **`id`** — the handle within that record: a `[#n]` user-comment handle, or a finding **ordinal**.
- **`status`** — the outcome value.

`useAgentReply` resolves `(sessionId, nonce, target, id)` — gating on `sessionId === ptyId` + `nonce` exactly as the reply path does — against the union of {pending user comments, live finding-thread records} and attaches an `author: 'agent'` annotation carrying the `outcome` + `text`, co-located with the addressed finding / comment (the same owner-addressed placement as VIM-249). A `clarify` marks the thread **awaiting-user**; the user's reply is dispatched back via **VIM-297** (single-turn dispatch), and the agent's next turn continues the thread. Multi-turn ordering + nesting render via **VIM-298**.

### Backend surface

The `AgentReply` type + the reply-block schema (backend `reply.rs`) gain the optional `target` field and the widened `status` (outcome) enum; `extract_agent_reply` validates them. **Additive** to the shipped block — an absent `target` ⇒ `"comment"`, preserving every current reply; an absent/unknown `status`… (existing malformed handling applies).

### Tests

- `outcome` round-trips through the reply block for each of the 5 values;
- a `target:"finding"` reply attaches to the addressed finding's thread by `(nonce, ordinal)`;
- a `target:"comment"` (or absent) reply preserves the existing `[#n]` behavior (regression);
- a `clarify` marks the thread awaiting-user; a subsequent user reply + agent turn continues it;
- the three legacy literals map to their canonical new values (`answered → reply`, `changed → resolved`, `skipped → rejected`).

## Section 5 — Rendering + rollout *(PR-2/3)*

### Reviewer + agent rows (reuse VIM-256)

`ReviewCommentRow` already renders `author: 'agent'` distinctly (the "Agent reply" treatment). Extend it for the two new cases — **variants of the existing row keyed on `author` + the type field, not a new renderer** (the VIM-249 non-goal holds):

- **`author: 'reviewer'`** — a distinct reviewer row showing the **reviewer name** (`reviewer`, or the fallback label) as its identity, plus the finding's **category chip** (the existing chip). Read-only; visually distinct from the user's own comment and from an agent reply.
- **`author: 'agent'` with an `outcome`** — a small state chip: `resolved` / `clarify` (reads as "awaiting you") / `deferred` / `rejected` / `reply`.

### Thread rollup

A finding thread shows a **rollup status** derived from its latest agent turn (resolved / awaiting you / deferred / rejected / replied — the 1:1 mapping in Section 4), so the user can scan a review's state without expanding every thread. Derived, not stored.

### Review-level fallback surface

Unplaceable findings (`path` not in the owner's diff) and a malformed reviewer note (Sections 1 / 3) have no `(path, staged)` row to render under. A small **review surface** — grouped under the request (e.g. a collapsible "Review — N findings, M unplaceable" header at the top of the diff, or a per-request section in the feedback panel) — lists them, reviewer-named, never dropped. Exact placement is an implementation UX detail; the contract requires only that they are **visible and attributable**.

### Multi-turn thread render + user reply → VIM-298 / VIM-297

The **ordered, nested** render of a multi-turn thread (reviewer finding → agent turns → user replies) and the **user's reply-dispatch** are **not built here** — they are VIM-298 (thread continuation) and VIM-297 (single-comment dispatch). VIM-304 places the reviewer / agent turns as annotations at the anchor; the two composed issues supply the thread UI + the user's outbound reply. VIM-304's own acceptance is met with the reviewer-finding + main-agent-reply turns rendering distinctly; the full multi-turn UX lands when 298 / 297 do.

### PR sequencing (one spec)

- **PR-1 — backend capture:** `review.rs` (`extract_agent_review`) + `AgentReviewEvent` / `AgentReviewFinding` + `emit_agent_review` + Codex / Claude adapter wiring + Rust tests + binding. Dormant-live.
- **PR-2 — frontend review ingestion:** Request-review affordance + dispatch, `pendingReviewRequests`, `useAgentReview`, `author: 'reviewer'` + `reviewer` on `ReviewComment`, the widened "pending" predicate, placement + fallback, reviewer-row rendering, the review-level surface. Lights up review capture.
- **PR-3 — finding threads + outcome axis:** the `outcome` enum (migrating `AgentReplyStatus`), the `target` discriminator on the reply block, the finding-thread record, `useAgentReply` union resolution, outcome-chip rendering. Composes with VIM-298 / 297 for the full multi-turn UX. The status migration is contained here so PR-1 / PR-2 don't disturb the shipped reply path.

### Risks / open questions

- **Prompt adherence** — the delegated reviewer may not emit a clean block, or the primary agent may not echo the nonce. Graceful degrade covers both (no block → nothing; malformed → a note); PR-2 should sanity-check adherence on a real delegated review before wider rollout.
- **Status migration** — PR-3 changes the shipped `agent-reply` status vocabulary; it must land atomically (backend enum + block schema + frontend + binding) with the legacy-literal map for in-flight blocks.
- **Snapshot vs. live view** — placement resolves against the dispatch-time diff snapshot (Section 3), so the reviewer's coordinates are unambiguous. If the user edits the file before the review returns, a placed annotation follows its `(cwd, path, staged)` batch key and renders only while the DiffView still shows that file / side — the same property as any persisted comment (VIM-282), not a new failure mode. Capturing the snapshot is cheap: the app already holds the diff to render the view.
- **Reviewer trust** — `reviewer`, `text`, and `rawText` are agent-controlled and render as **plain text** (React-escaped); findings can only annotate the request's own diff on the gated owner. No path executes reviewer text.

### Tests

Rust unit tests over `extract_agent_review` + the emit path:

- valid block → `Structured` with typed findings (line / range / file each);
- **empty `findings` → `Structured` with an empty vec** (clean review is valid, not malformed);
- sentinel + malformed JSON → `Malformed`; best-effort nonce recovered from a schema-invalid-but-parseable object;
- schema-invalid (missing/empty `nonce` or `reviewer`; bad `scope` / `category` / `side`; missing the anchor its scope requires; `startLine > endLine`; zero / negative line) → `Malformed`;
- open sentinel with no close → `Malformed` (truncated);
- no sentinel → `None`;
- multi-line `text` round-trips; a block wrapped in a markdown fence or `> `-prefixed still extracts;
- a Codex `task_complete` / a completed Claude turn (`end_turn` / `stop_sequence` / `max_tokens`) carrying a review block emits `agent-review` (asserts `sessionId` / `nonce` / `reviewer` / findings); a turn without a review block emits nothing.
