---
id: agent-state-guards
category: correctness
created: 2026-06-15
last_updated: 2026-06-28
ref_count: 8
---

# Agent-State Guards

## Summary

UI state that tracks an active agent session must validate the agent's identity and lifecycle phase before reacting to events that could originate from the agent, the shell, or a subprocess running inside the same PTY. Raw terminal input — keystrokes, command submissions, or PTY data — is not self-describing; the same byte sequence can come from the user typing in a shell, a full-screen tool like vim, or an actual agent command. Acting on such input without confirming the pane is running the expected agent type can reset, suppress, or corrupt agent-scoped state and leave the UI inconsistent for the remainder of the session. Always gate agent-scoped mutations on an explicit agent-type or session-identity signal, and keep non-agent side effects scoped so a false positive does not cascade.

## Findings

### 1. Missing agent-type guard: false /clear detection silences live Codex events

- **Source:** github-claude | PR #469 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L544-564
- **Finding:** `handleTerminalCommandSubmit` incremented the agent-status reset generation for any `/clear` command submitted from any terminal pane, with no check that the pane was actually running Codex. A false positive in a subprocess (e.g. searching `/clear` in vim and pressing Enter) captured the still-running Codex session ID and token total, causing `useAgentStatus` to suppress every subsequent same-run status, tool-call, turn, and test-run event until a real session boundary or pane switch.
- **Fix:** Gated `setAgentStatusReset` on `agentStatus.agentType === 'codex'` when the submitted `/clear` came from the active PTY-backed pane. Cache-history clearing for the matching pane remained unconditional because it is harmless on a false positive. Added a regression test covering the non-Codex case.
- **Commit:** same commit as this entry

### 2. Stale status event leaks through null priorTokenTotal gate

- **Source:** github-claude | PR #469 round 2 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts` L480-512
- **Finding:** After a local `/clear` reset, `useAgentStatus` compared arriving `agent-status` token totals against a pre-reset snapshot to decide whether the event was stale. If the React state had no `contextWindow` snapshot at reset time (`priorTokenTotal === null`), neither suppression branch fired, so a concurrent stale same-run status event repopulated `agentSessionId` and `contextWindow` and also cleared the run-scoped event latch, allowing old tool-call, turn, and test-run events to refill the sidebar.
- **Fix:** Added a conservative `priorTokenTotal === null` early-return inside the same-session reset guard. When freshness cannot be measured, the hook keeps the previous cleared state and preserves the run-scoped suppression latch until a fresh session boundary (different `agentSessionId`) arrives. Added a regression test covering the null-snapshot case.
- **Commit:** same commit as this entry

### 3. Double clear overwrites the reset latch with null

- **Source:** github-claude | PR #469 round 3 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts` L197-200
- **Finding:** A second `/clear` after the first reset committed saw `prev.agentSessionId === null` and overwrote `locallyResetAgentSessionIdRef` with null. That disabled the same-run staleness guard, so the next stale `agent-status` event could repopulate the cleared sidebar and clear the run-scoped suppression latch for old tool-call, turn, and test events.
- **Fix:** Preserved the existing reset latch when `prev.agentSessionId` is already null, while still keeping run-scoped suppression active. Added a regression test that sends two reset generations across separate renders, then verifies same-run stale status, tool-call, and turn events remain suppressed until a fresh agent session ID arrives.
- **Commit:** same commit as this entry

### 4. Same-id reset hook cleared before status latch could recover

- **Source:** github-codex-connector | PR #583 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentReattach.ts`
- **Finding:** The reattach hook treated a zero-token same-id event as a successful recovery, but `useAgentStatus` still suppressed same-id reset events unless the token total dropped below the captured total. When `/clear` happened before any tokens accrued, the red reattach state disappeared while the status panel stayed reset.
- **Fix:** Updated the status latch to accept zero-token same-id reset events and kept the reattach predicate aligned with that latch. Added regression coverage for the zero-token path in the reattach hook and retained status-hook coverage for same-id reset recovery.
- **Commit:** same commit as this entry

### 5. Unknown token baseline kept same-id reset recovery impossible

- **Source:** github-claude | PR #583 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentReattach.ts`
- **Finding:** When the pre-clear status had an `agentSessionId` but no `contextWindow`, `staleTotal` was null, so same-id relocated events with non-zero tokens could never satisfy the freshness predicate. The pane stayed in the red stale state until a pane switch or a different agent session ID arrived.
- **Fix:** Treat a known post-reset token total as fresh when the captured baseline is unknown, and mirror that rule in `useAgentStatus` so the panel accepts the same event. Added hook and status tests for same-id recovery from a null token baseline.
- **Commit:** same commit as this entry

### 6. Unknown stale session id let any old rollout clear reattach state

- **Source:** github-codex-connector | PR #593 round 1 | 2026-06-21
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentReattach.ts`
- **Finding:** When `/clear` was submitted before the first status event populated `agentSessionId`, the stale identity snapshot was null. The hook treated any later non-null id as different from null, so an old-rollout status event could clear the red reattach state even though the watcher was still pinned to the pre-clear rollout.
- **Fix:** Require a known captured stale id before the different-id branch can resolve recovery. Unknown-baseline clears now require the existing token-reset freshness signal, and a regression test covers a different-id old-rollout event followed by a zero-token reset event.
- **Commit:** same commit as this entry

### 7. Unknown token baseline let same-id stale replay clear reattach state

- **Source:** github-claude | PR #593 round 2 | 2026-06-21
- **Severity:** HIGH
- **File:** `src/features/agent-status/hooks/useAgentReattach.ts`
- **Finding:** A `/clear` after `agentSessionId` was known but before any `contextWindow` baseline left `staleId` known and `staleTotal` null. The reattach predicate accepted any known token total in that state, so an old watcher event with the same id and non-zero context could clear the red stale state even though no relocated watcher had been observed.
- **Fix:** Kept zero-token reset and lower-token reset events valid, but allowed the unknown-baseline fallback only when no stale identity was captured. Added a same-id, non-zero context replay regression test that keeps `needsReattach` armed.
- **Commit:** same commit as this entry

### 8. Retained Codex type kept drift relocation alive after exit

- **Source:** github-claude | PR #593 round 2 | 2026-06-21
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `WorkspaceView` enabled Codex drift relocation from `agentStatus.agentType === 'codex'` alone, but `useAgentStatus` intentionally retains `agentType` after disconnect so the exit UI can describe the last agent. Exited Codex panes could keep the periodic relocation loop active until the PTY closed or was replaced.
- **Fix:** Gated drift relocation on both Codex identity and `agentStatus.isActive`. Added workspace coverage asserting an inactive retained Codex status passes `driftEnabled: false` into `useAgentReattach`.
- **Commit:** same commit as this entry

### 9. Unknown token baseline accepted same-id stale status after reset

- **Source:** github-codex-connector | PR #593 round 3 | 2026-06-21
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** After a local `/clear`, the status latch accepted a same-id `agent-status` event with non-zero tokens when the captured pre-reset token baseline was null. In that recovery window, an old watcher still pinned to the stale rollout could repopulate the sidebar and clear run-scoped suppression before the relocated watcher was proven fresh.
- **Fix:** Kept same-id unknown-baseline status suppressed unless the event is a zero-token reset. Different `agentSessionId` events still clear the latch as the explicit session boundary. Updated the null-context regression test to prove non-zero stale replays stay blocked while zero-token reset events recover.
- **Commit:** same commit as this entry

### 10. OpenCode attach emitted stale PTY cwd instead of resolved project directory

- **Source:** github-claude | PR #603 round 1 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/transcript.rs` L88-110
- **Finding:** OpenCode did not emit OSC 7, so the runtime passed the terminal spawn cwd into transcript tailing even when the locator had resolved a project directory from the bridge index. The initial `agent-cwd` event could therefore point the file explorer, git watcher, and test-run parser at `~` instead of the OpenCode project.
- **Fix:** Added `resolved_directory` to `LocatedStatusSource`, populated it from OpenCode index rows and cache fallback, and made the watcher runtime prefer it over PTY cwd when starting transcript tailing.
- **Commit:** same commit as this entry

### 11. Replay dropped in-flight tool calls at catch-up

- **Source:** github-codex-connector | PR #630 round 1 | 2026-06-28
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/events.rs`
- **Finding:** Replay suppression retained completed tool calls for the boundary summary but discarded `running` events observed before the first EOF. Users resuming during a long-running command lost the active tool indication until a later terminal event arrived.
- **Fix:** Added replay storage for unsettled running tool calls, removed them when a matching done/failed event arrives, and flushed remaining running calls as live `agent-tool-call` events at the replay-to-live boundary.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. Codex replay activity crossed session id reset boundaries

- **Source:** github-codex-connector | PR #630 round 1 | 2026-06-28
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** Codex cleared in-flight calls, turns, cwd, and lifecycle state when `session_meta.id` changed, but the replay accumulator survived that reset. A boundary summary for the new session could include completed tools from the previous rollout.
- **Fix:** Reset `ReplayActivity` alongside the other run-scoped Codex tail state when the session id changes, and added a replay-mode regression test that proves old-session activity is not included after the reset.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. Claude replay boundary dropped retained running tool calls

- **Source:** github-claude | PR #630 round 2 | 2026-06-28
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/claude_code/transcript.rs`
- **Finding:** The Claude decoder flushed replay lifecycle phase and replay summary at catch-up but did not drain retained running tool calls first. Users resuming a Claude transcript during a long-running Bash/Edit tool saw the activity panel idle until completion arrived, or forever if the command hung.
- **Fix:** Mirrored the Codex replay boundary by draining `ReplayActivity::take_running()` and emitting each retained call as an `agent-tool-call` event before taking the summary. Added a Claude replay regression test that proves an in-flight replayed tool emits `running` at catch-up.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
