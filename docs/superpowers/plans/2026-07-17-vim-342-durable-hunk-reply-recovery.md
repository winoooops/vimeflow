# VIM-342 Nonce-Scoped Reply and Review Recovery Plan

**Goal:** If pane A is inactive when its agent finishes, returning to pane A recovers either a structured hunk reply (`VIMEFLOW_REPLY`) or a delegated review (`VIMEFLOW_REVIEW`) and attaches the result once to the original review owner.

**Key decision:** Keep the Codex and Claude `replay_done` guards unchanged. Normal transcript replay must not rebroadcast historical `agent-reply` or `agent-review` events. VIM-342 adds separate read-only recovery commands that return only nonces still pending in renderer memory.

**Issue boundary:** VIM-342 fixes pane switching in the current app process. VIM-346 separately persists review comments, replies, metadata, drafts, and pending delivery state across app restarts and linked worktrees. VIM-346 is related work, not a prerequisite for VIM-342 acceptance.

**Claude review:** Reviewed with `claude -p` on 2026-07-18. The review approved nonce-scoped recovery but rejected coupling VIM-342 to an async disk write: the current synchronous handle consumption already gives exactly-once UI effect, while awaiting persistence would create a new double-attach window.

## Existing invariant to reuse

`pendingReviews.ts` already stores each dispatch by `(ptyId, nonce)` and captures the original `ownerKey`. A pane switch does not remove that owner, so the pending record survives. `useAgentReply.ts` synchronously deletes matched handles and clears an empty record; JavaScript processes a live event and a recovered copy sequentially, so the first consumes the record and the second becomes a no-op.

VIM-342 therefore needs recovery, not a new delivery ledger.

The real A → B → A reproduction also exposed the delegated-review variant: `PendingReviewRequest` must retain the target PTY, and `useAgentReview` must request `recover_agent_reviews` when that PTY becomes active again. The same nonce consumption rule makes a concurrent live/recovered copy a no-op after the first result.

## Runtime flow

```text
Pane A dispatch
  → register PendingReview(ptyId, nonce, ownerKey, handles)
  → write prompt to PTY
  → switch to pane B; pane A transcript tail stops
  → agent A writes VIMEFLOW_REPLY while no tail is active
  → return to pane A
  → list pending nonces for pane A's PTY
  → recover_agent_replies(sessionId, nonces)
  → pass results through the same synchronous handleReply()
  → matching handles attach to owner A and are consumed
```

Normal transcript replay remains suppressed. Recovery reads the backend's last validated transcript source and returns data directly; it never emits through `EventSink`, calls `start_or_replace`, or spawns a replacement tailer.

The review path mirrors this flow with `PendingReviewRequest`, `VIMEFLOW_REVIEW`, `recover_agent_reviews`, and the existing synchronous `handleReview` placement logic.

## Planned files

| File                                                         | Change                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/features/diff/Panel.tsx`                                | Register pending correlation before PTY output; clear it if the write fails                       |
| `src/features/diff/services/pendingReviews.ts`               | Add pending-nonce listing by PTY                                                                  |
| `src/features/diff/hooks/useAgentReply.ts`                   | Reuse one synchronous handler for live and recovered replies; trigger recovery for the active PTY |
| `src/features/diff/hooks/useAgentReview.ts`                  | Recover delegated reviews for the active PTY through the existing placement handler               |
| `src/features/diff/hooks/useRequestReview.ts`                | Store the delegated PTY on the pending request and roll it back on write failure                  |
| `src/features/workspace/WorkspaceView.tsx`                   | Pass the active PTY to the global reply consumer                                                  |
| `crates/backend/src/agent/adapter/traits.rs`                 | Add a default empty nonce-scoped recovery method                                                  |
| `crates/backend/src/agent/adapter/base/transcript_state.rs`  | Retain a read-only validated recovery source after watcher stop                                   |
| `crates/backend/src/agent/adapter/codex/transcript.rs`       | Recover only requested Codex reply nonces                                                         |
| `crates/backend/src/agent/adapter/claude_code/transcript.rs` | Recover only requested Claude reply nonces                                                        |
| `crates/backend/src/runtime/state.rs`                        | Delegate recovery to `TranscriptState`                                                            |
| `crates/backend/src/runtime/ipc.rs`                          | Add `recover_agent_replies` with input caps                                                       |
| `electron/backend-methods.ts`                                | Allow both recovery methods through the production bridge                                         |

No new storage file, generated binding, repository identity, or dependency is required for VIM-342.

## Task 1 — Close the fast-reply registration race

- [x] In both batch and follow-up dispatch paths, mint the nonce and call `setPendingReview` before `dispatchFeedbackBatch` writes to the PTY.
- [x] If PTY output throws, call `clearPendingReview(ptyId, nonce)` and leave the comment/draft pending.
- [x] Keep the successful `markDispatched` and follow-up insertion behavior unchanged.
- [x] Do not add a prepared/sent state machine. The pending record is only in-process correlation state.

### Task 1 checks

- The pending record exists when the mocked PTY write begins.
- A failed write removes only that nonce's record and does not stamp the comment.
- A reply arriving immediately after the write can resolve the pre-registered record.

## Task 2 — Read-only backend recovery

- [x] Add `recover_agent_replies(sessionId, nonces) -> Vec<AgentReplyEvent>`.
- [x] Reject an empty session id, overlong nonce, or more nonces than the existing pending-comment cap. Deduplicate input before scanning.
- [x] Retain the last validated transcript path and provider recovery implementation separately from the active `TranscriptWatcher` handle.
- [x] `stop_agent_watcher` stops and removes the tailer but keeps the read-only recovery source. Final PTY/session removal forgets the source.
- [x] Recovery never accepts a renderer-supplied path, calls `start_or_replace`, starts a thread, or emits an event.
- [x] Scan with the live tail's 4 MiB per-line bound and return only sentinel blocks whose nonce is requested.
- [x] Re-scan pending nonces when `agent-replay-summary` marks the replay→live boundary, closing the handoff without a timing assumption.
- [x] Recover both `VIMEFLOW_REPLY` and `VIMEFLOW_REVIEW` for Codex and Claude.
- [x] Implement Codex and Claude only. Other providers use the trait's default empty result until a provider-specific loss case requires support.
- [x] Leave both live `if !replay_done { return; }` guards unchanged.

### Task 2 checks

- Normal replay still emits zero historical `agent-reply` events.
- Requested nonce A is returned while historical nonce B in the same transcript is excluded.
- Unknown nonce returns an empty list.
- A stopped watcher stays stopped during recovery.
- The renderer cannot choose an arbitrary transcript path.

## Task 3 — Reuse synchronous reply ingestion

- [x] Add `pendingNoncesForPty(ptyId)` to `pendingReviews.ts`; return only the current in-memory nonce set.
- [x] Move `handleReply` into a stable synchronous callback used by the existing listener and recovery results.
- [x] Keep the listener mounted once. Use a separate effect for active-PTY recovery so pane changes do not resubscribe and create a listener gap.
- [x] On active PTY change, request only that PTY's pending nonces. Skip IPC when the list is empty.
- [x] Feed each recovered event through `handleReply` without awaiting inside the consume-and-attach section.
- [x] Keep existing `(sessionId, nonce)` lookup, captured-owner routing, handle deletion, malformed fallback, and delegated-finding fingerprint behavior unchanged.

### Task 3 checks

- Pane A dispatch → switch to B → A completes → return to A → reply attaches to A.
- Live and recovered copies result in one annotation.
- Repeated A/B switches do not duplicate the reply.
- Pane B's identical `[#1]` handle cannot receive pane A's reply.
- Historical replies without an in-memory pending nonce are never requested or attached.
- Existing same-pane live replies and delegated finding turns remain unchanged.
- Delegated `agent-review` findings completed while inactive are placed when the original PTY becomes active again.
- Recovery requests are chunked to the backend's 50-nonce limit.

## Task 4 — Verification

- [x] Run focused TypeScript tests for `pendingReviews`, `useAgentReply`, `Panel`, and the workspace integration case.
- [x] Run focused Rust tests for IPC validation, `TranscriptState`, Codex recovery, and Claude recovery.
- [x] Run formatting, lint, type-check, and the relevant Rust test target.
- [ ] Manually reproduce the pane A → pane B → pane A flow and repeat the switch twice to prove no duplicate.

## VIM-346 follow-up: persistence only

VIM-346 remains responsible for restart/worktree durability. Its implementation should reuse Vimeflow's existing atomic JSON-cache convention in a separate `app_data_dir/review-state.json`, because `sessions.json` is cleared on graceful shutdown and workspace-layout writes have a different lifecycle.

The minimum VIM-346 scope is:

- persist owner review annotations, resolution/dispatch metadata, and non-empty drafts;
- persist pending deliveries and received outcomes so interrupted application can resume after restart;
- key files by repository identity plus repo-relative path, not absolute cwd;
- hydrate before rendering and delete only on explicit review/worktree/session cleanup;
- use deterministic reply ids or an equivalent persisted dedup key across restart.

Those disk operations must not be inserted into VIM-342's synchronous live/recovery handler until VIM-346 defines an atomic mutation boundary that cannot create duplicate attachment.

## Acceptance mapping

- **No lost pane-A reply:** pending nonce listing plus targeted transcript read.
- **No pane-B misrouting:** `(ptyId, nonce)` lookup plus captured owner key.
- **At most one rendered reply:** existing synchronous handle consumption.
- **No replay flood:** unchanged replay guards; recovery returns only requested nonces and never emits events.
- **No new watcher lifecycle:** retained source is read-only; recovery never starts a tailer.
- **Restart/worktree survival:** intentionally deferred to VIM-346.

## Deliberate non-goals for VIM-342

- `review-state.json` or any other disk persistence.
- Keeping every inactive pane's full watcher alive.
- Removing or weakening the Codex/Claude replay guard.
- Persisting or accepting renderer-supplied transcript paths.
- Supporting providers outside Codex/Claude.
- Saving immutable diff/hunk bodies.
