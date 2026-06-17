---
id: equality-guard-completeness
category: correctness
created: 2026-06-17
last_updated: 2026-06-17
ref_count: 0
---

# Equality Guard Completeness

## Summary

When a function preserves object identity by comparing fields and returning the
previous object when "nothing meaningful changed," every semantically
significant field must participate in the comparison. Omitting a field from the
equality guard makes the function return a stale object whenever that omitted
field is the only thing that changed, which hides the update from downstream
observers and can trigger redundant work, stale UI, or incorrect cached state.

## Findings

### 1. `mergeAgentStatusSnapshot` omits `usageFetched` from equality guard

- **Source:** github-claude | PR #517 round 10 | 2026-06-17
- **Severity:** LOW
- **File:** `src/features/agent-status/utils/statusSnapshotStore.ts` L143-165
- **Finding:** The early-return equality check compared 14 status fields but
  left out `usageFetched`. When a usage fetch returned without changing token or
  cost values, the function returned the previous snapshot with
  `usageFetched: false`, causing the cached pane state to remain stale and an
  unnecessary usage re-fetch IPC call on restore.
- **Fix:** Added `previous.usageFetched === next.usageFetched` to the compound
  equality guard.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Preserve `usageFetched` when merging snapshots

- **Source:** github-codex-connector | PR #517 round 10 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/utils/statusSnapshotStore.ts` L164
- **Finding:** The same equality gate did not compare `usageFetched`. For Kimi
  panes where the usage fetch/consent state changed without a rate-limit value
  changing, the cached snapshot stayed at `false`/`undefined`, so switching back
  to that pane could show the usage gate as still loading.
- **Fix:** Added `previous.usageFetched === next.usageFetched` to the merge
  comparison so the snapshot advances when the consent flag changes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
