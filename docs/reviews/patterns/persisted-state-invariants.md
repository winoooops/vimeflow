---
id: persisted-state-invariants
category: correctness
created: 2026-06-08
last_updated: 2026-06-08
ref_count: 0
---

# Persisted State Invariants

## Summary

Durable user-facing state (workspace shapes, caches, settings files) can be malformed by crashes, partial writes, migration gaps, or manual edits. Code that reads this state must validate runtime invariants before acting on them — never assume that a successfully-deserialized record satisfies every invariant the in-memory model requires. A single bad record should be skipped with a diagnostic, not allowed to abort the entire restore or poison downstream state.

## Findings

### 1. Zero-pane persisted session can abort the entire workspace restore

- **Source:** github-claude | PR #396 round 1 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/utils/groupSessionsFromInfos.ts`
- **Finding:** `buildStoreSession` assumed every persisted session had at least one pane. When `shape.panes` was empty, `activePane` evaluated to `undefined` and `activePane.agentType` threw. The exception was caught by `useSessionRestore`'s broad catch, causing the entire restore to fall back to an empty workspace and silently discarding otherwise valid sessions.
- **Fix:** In `reconstructWorkspace`, filter out zero-pane store sessions before calling `buildStoreSession`, logging a warning with the bad session id. Valid store sessions and unreferenced live PTYs continue to restore normally. Added a regression test pinning the skip behavior.
- **Commit:** same commit as this entry
