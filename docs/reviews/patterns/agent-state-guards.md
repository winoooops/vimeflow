---
id: agent-state-guards
category: correctness
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 2
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
