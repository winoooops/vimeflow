# Multi-turn finding threads — GitHub-style conversation UI + follow-up dispatch — VIM-298

**Issue:** VIM-298 (epic VIM-284 — Inline Agent Q&A). Depends on VIM-297 (merged, PR #684) and VIM-310 (merged, PR #683).

**Delivery:** one PR on `feature/vim-298`.

**Builds on (all merged):** per-comment dispatch with the nonce-keyed `pendingReviews` store + send-now row action scoped through `FinishFeedbackPopover` (VIM-297, PR #684); the agent outcome axis on `ReviewComment` + `AGENT_OUTCOME_META` chips + never-consumed finding-thread records (VIM-304 PR-3: backend #679, frontend #683 — tracked as VIM-322/VIM-310); agent replies attaching as `author: 'agent'` annotations via `useAgentReply`/`attachAgentNote` (VIM-249/283).

**Design provenance:** the thread-card recipe was settled in a demo-first pass (throwaway `preview-thread-demo.tsx`, per the issue's design note) — GitHub-style wrapping container, header rollup, hairline dividers, paired footer actions, and the real `ReviewCommentEditor` for replies. Exact values are in Section 3.

## Section 1 — Problem & Goals

### Problem

Inline Q&A (VIM-249) is a single round-trip: a user comment dispatches, one agent reply attaches below it, and the exchange dead-ends. There is no reply affordance on the exchange — to continue, the user would have to add a _new_ comment at the same line, which is unlinked to the conversation, forced through the category tabs, dispatched with no indication to the agent that it continues an earlier exchange, and rendered as yet another disconnected card.

VIM-297 built the dispatch foundation: a single comment can dispatch alone (other pending comments untouched) and its reply correlates independently via the nonce-keyed pending store. VIM-304 PR-3 gave agent turns an outcome axis (`reply`/`clarify`/`resolved`/`deferred`/`rejected`). What's missing is the loop: **reply on the thread → dispatch only that follow-up, marked as a continuation → next agent reply lands on the same thread → repeat**.

Visually, turns today render as disconnected stacked cards (one per annotation). A multi-turn conversation needs to read as one thread.

### Goals

1. After an agent reply, the user can reply on the thread; submitting dispatches **only that follow-up** via the VIM-297 single-comment path.
2. The agent's next reply attaches to the same thread; arbitrary turn counts work (Q → A → follow-up → A2 → …), rendered in order.
3. Turns at one anchor render as **one GitHub-style conversation card** (recipe settled in the VIM-298 demo pass): wrapping container, header with anchor + rollup chip + turn count, hairline-divided turn rows, footer with paired **↳ Reply** / **✓ Resolve** actions.
4. Other pending comments are untouched by a follow-up dispatch.
5. Threads can be **resolved locally**: rollup flips to Resolved and the card collapses to its header (expand on click). Nothing is dispatched on resolve.

### Non-goals

- Persistence of comments/threads across sessions (VIM-282).
- Whole-changelist delegated review dispatch (VIM-327).
- Reply capture for kimi/opencode (VIM-293).
- Notifying the agent on resolve — resolve is purely local UI state.
- Review-level notes (`ReviewLevelNote`, unanchored) — they have no diff anchor, so they do not become thread cards and gain no reply affordance in this PR.
- Changing the pending-comment (pre-dispatch) row UX — flat rows, send-now, edit, delete all stay as shipped in VIM-297.

## Section 2 — Thread identity, view-model & grouping

### Thread identity: `threadId` on `ReviewComment`

Threads need a stable identity — "same `(line, side)`" is not enough, since two independent roots can share an anchor and their turns would interleave. A new optional field:

```ts
/** Root comment id of the thread this turn belongs to. A comment whose
 *  threadId equals its own id (or a dispatched comment with none) is a root. */
threadId?: string
```

Stamping (all in-memory — there is no persisted legacy data to migrate). The one normalization rule, used everywhere: **`effectiveThreadId = comment.threadId ?? comment.id`** — so a root self-roots and a follow-up (created with the root's `threadId`, Section 4) keeps it. In particular `markDispatched` must NOT overwrite an existing `threadId`:

- **User comment on dispatch:** `markDispatched` stamps `threadId = comment.threadId ?? comment.id`. Pending comments without a thread never carry `threadId` — they are not conversations yet.
- **Agent reply (comment path):** `PendingReviewHandle` gains `threadId = comment.threadId ?? comment.id`, captured at handle registration in `buildFeedbackEntries` (which runs _before_ `markDispatched` — hence the same normalization, not a read of the stamped value); `attachAgentNote` copies it onto the agent annotation.
- **Agent reply (finding path):** `FindingThreadRecord.byOrdinal` already records the placed finding's `commentId` — the anchored finding is stamped `threadId = commentId` at placement in `useAgentReview`, and finding-thread turns inherit it the same way. Delegated findings thereby become thread roots for free (per the VIM-304 spec's intent).
- **Follow-up:** created with the root's `threadId` (Section 4).

### Grouping: a render-layer transform (mechanism A — pre-group)

The store stays **flat** — turns remain sibling `DiffLineAnnotation<ReviewComment>` entries; `threadId` is data, not nesting. Grouping happens between the store and Pierre, in a memoized selector in `Panel`:

1. Partition annotations by a synthesized grouping key (all fields live on the annotation's `metadata: ReviewComment`): `groupKey(a) = a.metadata.threadId ?? (a.metadata.author !== 'self' || a.metadata.dispatchedAt !== undefined ? a.metadata.id : undefined)`. A `undefined` key (pending user comments, the draft sentinel) passes through untouched as a flat row; the second arm makes orphan agent/reviewer annotations and legacy dispatched roots one-turn groups keyed by their own id, consistent with the in-flight rule below.
2. Each group collapses to its **first annotation** (the anchor) in the `lineAnnotations` array handed to `MultiFileDiff`, so Pierre opens exactly one slot per thread.
3. A `Map<groupKey, ThreadGroup>` rides alongside to `PanelBody`; `renderAnnotation` checks it — anchor of a group → `<ReviewThreadCard>`, otherwise the existing draft-editor / flat-row branches, unchanged.

The same selector runs on **both** annotation lists: Pierre's line-level list (`isLineLevelReviewAnnotation`) _and_ the file-level strip (`isFileLevelReviewAnnotation`, rendered as plain rows outside Pierre in `Panel`). File-scoped threads — including delegated findings downgraded to file scope — get the same `ReviewThreadCard` in the file-comments strip, with the Reply footer; only review-level notes (no annotation at all) stay out of scope.

```ts
interface ThreadGroup {
  threadId: string
  /** Store-order turns (arrival order — attachAgentNote appends). */
  turns: DiffLineAnnotation<ReviewComment>[]
  rollup: { label: string; chip: string }
  resolved: boolean
}
```

**In-flight rule:** an annotation renders inside a thread card exactly when its `groupKey` is defined — which by construction means "dispatched, or authored by the agent/reviewer". A lone un-replied dispatched comment is a 1-turn card ("Sent…" state); an orphan agent annotation (no threadId, e.g. constructed by older tests) is a 1-turn card keyed by its own id.

**Ordering:** store array order within the group (chronological by construction; `createdAt` ties are irrelevant since order is positional).

**Rollup derivation** — a total function of the **latest turn** (not the latest agent turn — a dispatched follow-up after a `clarify` must flip the thread back to awaiting the agent), with the local resolve override on top:

1. Thread locally resolved (Section 5) → **Resolved**.
2. Latest turn `author: 'agent'` → `AGENT_OUTCOME_META[outcome]`, falling back to the "Replied" meta when `outcome` is absent (fallback agent notes may omit it).
3. Latest turn `author: 'self'` → **Sent** (awaiting agent). This arm is total because no undispatched self turn can exist inside a thread: follow-ups are created atomically with a successful dispatch (Section 4), and pending root comments have no `threadId` yet.
4. Latest turn `author: 'reviewer'` (a finding with no agent turn yet) → **Open**.

The non-agent rollup states get complete chip metas (a small `THREAD_ROLLUP_META` beside the existing metas): **Sent** `text-primary` (matching the existing Sent badge), **Open** `text-on-surface-variant`, **Resolved** reusing `AGENT_OUTCOME_META.resolved`'s `text-success`.

**What thread turns lose:** inside a card, per-turn edit/delete/send-now actions are dropped in v1 — the card's operations are the footer pair (Reply / Resolve). Pending flat rows keep all VIM-297 actions.

**1:1 consumers audit:** the collapse happens _after_ everything that counts comments — `buildFeedbackEntries`, pending counts, and the Finish popover all read the store, not the Pierre-bound array. The only consumers of the collapsed array are `MultiFileDiff` (slots/gutter) and `renderAnnotation` itself; the plan adds a test pinning that dispatch counting is unaffected by grouping.

## Section 3 — Thread card UI (the settled recipe)

New component `src/features/diff/components/ReviewThreadCard.tsx`, rendered by `renderAnnotation` for a group's anchor (and by the file-comments strip for file-scoped groups). All values below were settled in the demo-first pass the issue's design note asked for; colors are theme tokens / `color-mix(var(--color-*))` only (per `vimeflow/no-hardcoded-colors`), no visible borders — hairlines are on-surface mixes, consistent with The Lens.

**Container** — `mx-3 my-2 overflow-hidden rounded-lg bg-surface-container-high/80`.

**Header strip** — `px-4 py-2`, `text-[10px] text-on-surface-variant`, background `color-mix(in srgb, var(--color-on-surface) 4%, transparent)`. Content: anchor label — the existing `annotationTargetLabel` in `PanelBody` is private and only labels range targets, so it is **extended and exported** (or superseded by a `threadAnchorLabel` helper) to cover all three cases: plain line ("line R40"), range ("lines R88–94"), and file scope ("file"), the **rollup chip** (same `Chip` shape as category chips: `rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium` + the meta's text class), and the turn count ("4 turns"). In the resolved state the header doubles as the collapsed card (Section 5).

**Turn rows** — `px-4 py-2.5`; rows after the first get a hairline `border-top: 1px solid color-mix(in srgb, var(--color-on-surface) 12%, transparent)`. No per-author background tint (evaluated, rejected). Each row:

- identity line: 16px round avatar (agent: `bg-primary-container/60 text-primary` "A"; user: `bg-surface-container-highest text-on-surface-variant`; reviewer: same neutral treatment with the reviewer's initial), name ("You" / "Agent" / reviewer name, `text-[11px] font-medium`), chip (user turn with category → `REVIEW_CATEGORY_META`; agent turn → `AGENT_OUTCOME_META[outcome]` with the existing "Agent reply" fallback; typeless follow-ups → no chip), and a relative timestamp (`text-[10px]`) — dispatched self turns use `dispatchedAt` ("Sent 2m ago", reusing the pure time-ago formatter already in `ReviewCommentRow`); all other turns (agent, reviewer, and reviewer/orphan-agent roots, which have no `dispatchedAt`) use `createdAt`.
- body: `whitespace-pre-wrap break-words text-xs leading-5 pl-[22px]` (indented under the avatar; `pre-wrap` preserves the multiline text the editor accepts, matching `ReviewCommentRow`).

**Footer** — hairline-divided from the turns. Default: right-aligned matched pair, `px-4 py-2`:

- **↳ Reply** — `rounded-md px-3 py-1.5 text-[11px] font-medium text-primary`, background `color-mix(in srgb, var(--color-primary) 12%, transparent)`, hover `bg-surface-container-highest/60`.
- **✓ Resolve** — same shape, `text-on-surface-variant`, background `color-mix(in srgb, var(--color-on-surface) 6%, transparent)`, hover lifts to `text-on-surface`. Resolved threads swap it for **⟲ Reopen** (Section 5).

Clicking Reply swaps the footer for the real `ReviewCommentEditor` (`chrome="plain"`, `surfaceRole="none"`, new reply mode — Section 4) in a `px-2 py-1.5` wrapper; Cancel/confirm restores the button pair.

**Capability gating** — the footer renders iff `Panel` passes an `onReplyToThread` handler, mirroring how the send-now action is gated on `onSendComment !== undefined` today (there is no panel-level read-only flag; capability is expressed by handler presence). Contexts without dispatch capability omit the handler and get a footer-less card.

**Rejected variants (for the record):** flat stack, indent, connector-rail and indent+rail structures; hover-on-agent-row reply affordance; latest-turn-only rollup; per-author tint; compact density. All were evaluated against the GitHub-conversation variant in the demo and dropped.

## Section 4 — Reply flow (follow-up dispatch)

### Editor: a `reply` mode on `ReviewCommentEditor`

New prop `mode?: 'comment' | 'reply'` (default `'comment'`, existing behavior untouched). In reply mode:

- category tabs and the ⌃H/⌃L hint are hidden; the cycle shortcuts are inert — follow-ups are **typeless** (per the VIM-310 taxonomy: user/reviewer _raise_ with a category, thread replies don't).
- header reads **"Reply to thread"** (in place of "Local comment"); the right-side target copy stays the anchor label.
- confirm button reads **"Reply"**; placeholder "Reply to the agent…".
- `onConfirm(text, category)` keeps its signature; the category argument is ignored by the reply-mode caller (no signature churn).

`ReviewThreadCard` mounts it with `chrome="plain"`, `surfaceRole="none"`, `mode="reply"`. Cancel discards the draft text (uncontrolled, same as other editor cancels).

### Creating + dispatching the follow-up — atomic with dispatch

A follow-up is **never stored as a pending comment**: it enters the batch store only together with a successful dispatch. This keeps three invariants for free — whole-batch Finish can never sweep a follow-up, keyboard comment-navigation never targets a hidden in-card pending turn, and no in-card edit/delete/send controls are needed for a state that cannot exist.

On confirm, `Panel`'s `onReplyToThread(threadId, text)`:

1. Opens the **same scoped confirm flow as send-now** (`FinishFeedbackPopover` scoped to one item) against the panel's agent candidate. **Cancelled → nothing is created**; the reply editor stays open with the text intact, so nothing is lost.
2. On confirm: creates the follow-up `ReviewComment` — `author: 'self'`, **no `category`**, `threadId` = the thread's id, same `(lineNumber, side)` and `target` as the anchor — and dispatches it in the same handler. **Not via the render-closure `buildFeedbackEntries`** (which scans the render-time batch for _pending_ annotations and would not see a same-callback insert): a dedicated `dispatchFollowUp` builds the single `DispatchEntry` directly from the just-created comment and shares the lower-level primitives — nonce minting, payload formatting, `[#n]` handle registration (the handle carrying `threadId` per Section 2), `pendingReviews` registration, and a scoped `markDispatched`. Other pending comments are untouched by construction.
3. **UI state commits only after the dispatch write succeeds**: the editor closes and (Section 5) `resolvedAt` clears at that point; a write failure keeps the editor open with the text and creates no comment.

### Agent affinity (routing to the originating session)

Thread lifetime already bounds this problem: batches are owned by the agent pane (`prunePendingReviewOwners`), so a thread whose originating pane closes is pruned with it — a live thread's panel candidate _is_ in practice the originating session, and `WorkspaceView` supplies exactly that one candidate today (there is no live-pane inventory to search).

v1 therefore ships the send-now flow verbatim (step 1 above) — no new pane machinery. Additionally, `markDispatched` stamps **`dispatchedTo`** (the target ptyId) on the comments it dispatches, which (a) lets the payload/context layer know the conversation continuity is real, and (b) enables the fast-follow of skipping the confirm popover when `dispatchedTo` matches the current candidate. Delegated finding roots never pass through `markDispatched` and carry no `dispatchedTo` — their first follow-up simply goes through the confirm flow like any other.

### Payload: marking the continuation

`formatFeedbackPayload` renders typeless follow-ups as **`[#1 · Follow-up]`** (category label position) and inserts one context line after the location line:

```
> [#1 · Follow-up] src/auth.ts:42 (additions) [unstaged]
> ↩ Continuing our thread — your last reply: "The pool applies backpressure per write; the cap bounds …" (truncated)
> ─ Can you help me understand how that interacts with the resize path?
> → Answer inline in your reply. Do not edit files.
```

The context input is explicit: `dispatchFollowUp` receives the `ThreadGroup` and quotes the **latest turn preceding the follow-up**, with author-appropriate phrasing — `your last reply: "…"` for an agent turn, `the finding: "…"` for a reviewer turn (a finding not yet answered), `my earlier comment: "…"` when the only prior turn is the user's own (a Sent card awaiting its first answer). Reply is available on every card; the rule is total.

The excerpt is truncated to ~200 chars **and passes through the same terminal-control sanitization `formatFeedbackPayload` already applies** (stripping ESC/CR/bracketed-paste terminators — the quoted text is agent-controlled, so a paste-breakout regression test rides with this). The `VIMEFLOW_REPLY` footer (nonce + `[#n]` ids) is unchanged — the agent's answer routes exactly like any VIM-297 reply and lands on the thread via the handle's `threadId`.

## Section 5 — Resolve & collapse

### State

`ReviewComment` gains **`resolvedAt?: number`**, set on the thread's **root** comment only (the annotation whose id equals the thread id) via the existing `updateAnnotation` machinery. Local-only, in-memory like all comment state; it rides into VIM-282 persistence for free when that lands. `ThreadGroup.resolved` derives from the root's `resolvedAt`.

### Behavior

- **✓ Resolve** (footer) → stamps `resolvedAt`. The card collapses to its **header only** — anchor label, **Resolved** rollup chip, turn count — plus an expand chevron. Turn rows and footer are hidden.
- Clicking the collapsed header **expands** the card for reading (an expanded-while-resolved state); the footer then shows **↳ Reply** and **⟲ Reopen** (in Resolve's slot). Collapsing again is a header click.
- **⟲ Reopen** → clears `resolvedAt`; the thread returns to its normal expanded state and derived rollup.
- **Reply implies reopen**: a follow-up that _successfully dispatches_ on a resolved thread clears `resolvedAt` — you don't converse on a closed thread. (Cancelling the picker or a failed write reopens nothing; Section 4's commit-after-write rule governs.)

### Precedence with late-arriving agent turns (deferred from Section 1)

**Local resolution is authoritative.** An agent reply that arrives after the user resolved (an in-flight dispatch completing late) **appends to the thread but does not clear `resolvedAt`** — the collapsed header's turn count ticks up, the rollup stays Resolved. Rationale: resolve is the user saying "I'm done here"; an answer to a question they no longer have shouldn't re-open work. The turn is not lost — expanding shows it. (Mirrors GitHub: new pushes don't unresolve conversations.)

Expanded/collapsed is ephemeral component state; `resolvedAt` is the durable-ish fact.

## Section 6 — Testing & rollout

### Tests (co-located, `test()` not `it()`)

- **Grouping selector** — `groupKey` partition: pending/draft pass through; dispatched root self-roots; follow-up + agent turns join the root's group; two roots on one line stay two groups; orphan agent annotation becomes a 1-turn group; file-level and line-level lists both grouped; collapse hands Pierre exactly one anchor per group.
- **threadId stamping** — `markDispatched` preserves an existing `threadId` (the follow-up-fork regression codex caught in review); handle registration normalizes `threadId ?? id`; `attachAgentNote` copies the handle's threadId; finding placement stamps `threadId = commentId`.
- **Rollup** — total-function table: latest-agent per outcome + missing-outcome fallback, latest-self (always Sent), reviewer-only (Open), resolved override; `THREAD_ROLLUP_META` chip classes.
- **`ReviewThreadCard`** — turn order, chips (category / outcome / none for typeless), header content, footer pair, reply-editor swap, collapse/expand/reopen, read-only hides footer.
- **Editor reply mode** — tabs hidden, ⌃H/⌃L inert, labels, confirm passes text.
- **Reply dispatch** — follow-up created typeless with root's threadId/anchor; only that comment dispatched (others untouched — pin the VIM-297 invariant); confirm flow scoped to the follow-up, popover cancel → no comment created and editor text preserved, dispatch write failure → editor stays open and no comment persists; payload renders `[#1 · Follow-up]` + context line with author-appropriate phrasing for agent/reviewer/self-only threads (respecting the dispatch-vocab pins); context excerpt passes control-character sanitization (paste-breakout regression); reply-implies-reopen only after successful dispatch.
- **Integration** — full loop: comment → dispatch → agent reply → follow-up → second agent reply, asserting one card with 4 ordered turns and rollup transitions; late reply after resolve appends without unresolving.

### Rollout & cleanup

- Single PR on `feature/vim-298`: `Closes VIM-298` + `Part of VIM-284`, `auto-review` + `auto-approve` labels.
- Full local gate before push: repo-wide `lint`, `format:check`, `type-check:generated`, `vitest run` (the Code Quality CI check is repo-wide).
- Delete the demo artifacts (`preview.html`, `preview-thread-demo.tsx`, `vite.preview.config.ts`) from the main checkout once this spec merges — the recipe now lives in Section 3.
- No backend/Rust changes; no bindings churn expected.
