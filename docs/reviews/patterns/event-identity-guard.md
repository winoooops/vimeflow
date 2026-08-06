---
id: event-identity-guard
category: backend
created: 2026-06-11
last_updated: 2026-08-06
ref_count: 6
---

# Event Identity Guard

## Summary

Events that carry an identity field for deduplication, stale-event rejection, or downstream correlation must never be emitted until that identity is populated. If the identity is derived from an external stream (transcript tail, session metadata, handshake), the emission path must be gated on a non-empty/valid identity, or the phase must be queued and flushed only after the identity arrives. Emitting with an empty or default identity silently bypasses the guard the identity was meant to enforce.

## Findings

### 1. Codex lifecycle events emitted with empty agent_session_id

- **Source:** github-codex-connector | PR #421 round 1 | 2026-06-11
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** `CodexTranscriptDecoder` starts `codex_agent_session_id` as an empty string, emits `replay_phase` in `on_caught_up` without checking it, and `record_lifecycle` is called for `EventMsg` before any `SessionMeta` has populated the ID. If live tailing or truncated replay observes lifecycle events before `session_meta`, the frontend receives `agent_session_id: ""`, weakening the stale-event correlation guard.
- **Fix:** Guarded both live `record_lifecycle` and replay flush so lifecycle events are emitted only after `codex_agent_session_id` is non-empty.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. OpenCode message events routed by message ID instead of session ID

- **Source:** github-claude | PR #585 round 2 | 2026-06-20
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts`
- **Finding:** `message.updated` events did not carry a top-level `sessionID`, so the bridge fell back to `properties.info.id`. For message events that value is the message ID, not the session ID, causing writes to land in `msg_*.jsonl` files that the backend never tails.
- **Fix:** Changed the session extraction fallback to prefer `properties.info.sessionID` before `properties.info.id`, preserving the session-event path while routing message events to the correct per-session JSONL.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. OpenCode locator could rebind an established watcher to another same-cwd session

- **Source:** github-codex-connector | PR #595 round 1 | 2026-06-21
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/locator.rs`
- **Finding:** A locator that had already resolved one OpenCode session could later see a newer same-cwd index row from another pane and switch its transcript path by recency alone. That let an older pane's watcher surface another pane's agent activity.
- **Fix:** Made same-cwd resolution fail closed when multiple distinct session IDs are fresh, while preserving an existing cached binding across ambiguous or missing-current-cwd reads.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. OpenCode completion dedupe reused session identity across turns

- **Source:** local-codex | PR #785 focused fixer | 2026-08-05
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/notification.rs`, `src/features/sessions/hooks/useNotificationCenter.ts`
- **Finding:** OpenCode completion events reused `turn:<agentSessionId>` after each busy edge, but the renderer retained that key in notification history and suppressed every later completion for the same session.
- **Fix:** Added a per-registration OpenCode turn sequence to completion keys so status-idle and session-idle duplicates share one identity while later turns receive distinct identities. Added backend and renderer regressions for the cross-layer contract.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 5. Delayed Claude hooks used watcher scan time as occurrence time

- **Source:** local-codex | PR #785 focused fixer | 2026-08-06
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/bridge.rs`
- **Finding:** Minimized Claude hook records omitted both identity and occurrence
  time, so delayed filesystem reconciliation stamped an old completion as newer
  than the following turn's running lifecycle event.
- **Fix:** Added a privacy-safe hook-execution timestamp to every generated
  record without reading hook stdin, allowing the existing renderer staleness
  guard to reject delayed completions. Added generation and pane-state
  regressions.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 6. Delayed semantic completion ignored a newer running lifecycle

- **Source:** github-codex-connector | PR #785 focused fixer | 2026-08-06
- **Severity:** P2 / MEDIUM
- **File:** `src/features/sessions/hooks/useAgentNotificationProducers.ts`
- **Finding:** The notification producer skipped semantic lifecycle events, so
  a delayed completion from the previous turn could be scheduled after the next
  turn was already running and publish an obsolete finished notification.
- **Fix:** Record the latest running timestamp for every agent, reject older
  completions before scheduling, and cancel pending completion timers on a new
  running edge. Added a focused delayed-Claude regression.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 7. Missing notification identity acted as a wildcard after agent replacement

- **Source:** github-codex-connector | PR #785 focused fixer | 2026-08-06
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/notification.rs`,
  `crates/backend/src/agent/adapter/claude_code/bridge.rs`,
  `src/features/sessions/hooks/useAgentNotificationProducers.ts`,
  `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** Notification consumers treated `agentSessionId: null` as current,
  so a delayed completion, error, or attention event from a replaced agent could
  mutate or notify the replacement pane sharing the same PTY.
- **Fix:** Made notification identity non-nullable, captured Claude hook session
  IDs, initialized Codex registrations from `session_meta`, suppressed emission
  until identity exists, and required exact identity matches in both consumers.
- **Commit:** uncommitted (the focused fixer task prohibited commits)

### 8. Pane hydration lag dropped a current notification identity

- **Source:** github-codex-connector | PR #785 focused fixer | 2026-08-06
- **Severity:** P2 / MEDIUM
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** A notification arriving after the backend emitted agent identity
  but before the matching pane state hydrated required the pane's delayed React
  identity and permanently discarded the current completion.
- **Fix:** Compared notifications with the synchronously observed per-PTY
  identity first, retaining the hydrated pane identity only as the restore
  fallback. Added a startup-order regression that observes status identity
  before pane restore and completion afterward.
- **Commit:** uncommitted (the focused fixer task prohibited commits)
