# Per-comment dispatch (VIM-297) — Implementation Plan

**Goal:** send a single pending review comment to the agent immediately, without dispatching the rest of the pending batch — the foundation for threaded Q&A (VIM-298).

**Architecture:** one PR, three tasks. The load-bearing change is re-keying `pendingReviews` from `ptyId` (one in-flight dispatch per pty, replaced on send) to `(ptyId, nonce)` — the same keying the finding-thread record already uses — so concurrent dispatches on one pty each correlate their own `agent-reply` independently. Single-send then _reuses_ the batch path end-to-end: `buildFeedbackEntries` gains an id filter, `handleSendFeedback` gains an optional target id, and the existing `FinishFeedbackPopover` renders scoped to one comment. No new dispatch machinery, no new popover.

## Task 1: nonce-keyed pending store + reply resolution

**Files:** `src/features/diff/services/pendingReviews.ts` (+test), `src/features/diff/hooks/useAgentReply.ts` (+test), `src/features/workspace/WorkspaceView.tsx`.

- [ ] Failing tests — store: two records on the same pty under different nonces coexist; `get(ptyId, nonce)` / `clear(ptyId, nonce)`; `prunePendingReviewOwners` removes records for closed owners (new — the ptyId-keyed store never pruned). Reply: two concurrent dispatches each get their own reply attached by nonce (the acceptance case); a reply whose nonce matches no record is ignored (replaces the "superseded dispatch" semantics — nothing is clobbered anymore).
- [ ] Implement: key `${ptyId}\u0000${nonce}` (mirror `findingThreads`); `getPendingReview(ptyId, nonce)`; `useAgentReply` comment path resolves by `(event.sessionId, event.nonce)` — the explicit nonce equality check dissolves into the key; clear by `(sessionId, nonce)`. Wire `prunePendingReviewOwners` in WorkspaceView beside `prunePendingReviewRequestOwners`.
- [ ] Green + commit.

## Task 2: single-comment dispatch through the batch path

**Files:** `src/features/diff/Panel.tsx`.

- [ ] `buildFeedbackEntries(onlyCommentId?)`: when given, filter each batch's pending annotations to that id (handles/`markDispatched`/`setPendingReview` all derive from the filtered entries, so they scope automatically).
- [ ] `handleSendFeedback(pane, onlyCommentId?)`: thread the filter through; everything else (nonce mint, dispatch, record, markDispatched-subset, focus) is unchanged.
- [ ] Send-now popover state: `sendNowCommentId: string | null`; `finishFeedback` renders the existing popover with `open: finishOpen || sendNowCommentId !== null`, `commentCount`/`fileCount` scoped to 1 when single-sending, `onSend` bound to the id, `onCancel` clearing it.
- [ ] Behavior test at the row/popover seam (Panel test harness if tractable, else popover + row unit coverage): single send marks only that id dispatched; the rest stay pending and still dispatch on Finish.
- [ ] Green + commit.

## Task 3: Send-now affordance on the comment row

**Files:** `src/features/diff/components/ReviewCommentRow.tsx` (+test), `src/features/diff/components/PanelBody.tsx`, `src/features/diff/Panel.tsx` (render sites).

- [ ] Failing tests: a pending `self` comment row with `onSendNow` renders a "Send comment now" button that fires it; dispatched / agent / reviewer rows never render it.
- [ ] Implement: optional `onSendNow?: () => void` prop → send IconButton beside edit/delete (read-only rows excluded by the existing `readOnly` gate); thread from both render sites with `() => setSendNowCommentId(comment.id)`.
- [ ] Full gate: repo-wide lint + format + type-check, `npx vitest run src/features/diff src/features/workspace`. Green + commit.

**PR:** `feat(diff): per-comment dispatch (VIM-297)`, branch `feature/vim-297`, `Closes VIM-297`, `Part of VIM-284`, auto-review/auto-approve.

**Out of scope:** the reply affordance on agent rows and thread-grouped rendering (VIM-298, which builds on this); TTL/GC for abandoned dispatch records beyond owner-pruning (records are consumed when their replies land; abandoned ones fall with their owner).
