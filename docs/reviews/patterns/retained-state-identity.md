---
id: retained-state-identity
category: react-patterns
created: 2026-06-15
last_updated: 2026-07-04
ref_count: 1
---

# Retained State Identity

## Summary

When a React component renders retained (stale) content while fresh data for a new context loads asynchronously, state reads and writes must be keyed to the correct identity. Reading saved state against the retained key is correct — it preserves scroll position or selection continuity for the content the user currently sees. However, writes triggered by the user's current interactions must be keyed to the active/target context, not the retained one. Writing interaction state back to the retained key corrupts the source context's saved state and causes it to reopen at the wrong offset or in the wrong configuration later. Guard every write path with an identity check (`retainedKey === activeKey`) and include the active key in the relevant callback dependencies.

## Findings

### 1. Retained body scroll writes to the source pane anchor

- **Source:** github-claude | PR #468 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- **Finding:** During retained-body fetching, `bodySnapshotKey` referred to the previously rendered/source pane while `snapshotKey` referred to the current target pane. The `handleScroll` callback wrote user scroll events to `bodySnapshotKey`, so scrolling retained content during the refresh window overwrote the source pane's saved scroll position and caused it to reopen at the wrong offset later.
- **Fix:** Added an identity guard before `writeStatusScrollAnchor` that returns early when `bodySnapshotKey !== snapshotKey`, and added `snapshotKey` to the `handleScroll` `useCallback` dependencies.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Retained burner entries kept a stale native host PTY after pane restart

- **Source:** github-codex-connector | PR #656 round 1 | 2026-07-04
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/hooks/useBurnerTerminals.ts`
- **Finding:** Burner entries are intentionally retained by stable `${sessionId}:${paneId}` identity across pane restarts, but the native secondary request kept the old `hostPtyId`. When the host pane remounted with a new PTY, an open native burner stayed attached to the removed native surface until the user toggled it.
- **Fix:** Threaded a live pane-key-to-PTY map from `WorkspaceView` into `useBurnerTerminals`, updated retained entries when the host PTY changes, and covered the reattach path with a native burner regression test.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
