---
id: retained-state-identity
category: react-patterns
created: 2026-06-15
last_updated: 2026-07-04
ref_count: 4
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

### 2. Single focus-toggle restore slot is shared across sessions

- **Source:** github-claude | PR #631 round 1 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** The Mod+Z single-pane focus toggle stored the previous layout in
  one ref for the whole hook. Toggling session A to focus and then toggling
  session B overwrote A's restore layout, so returning to A left the keyboard
  restore path as a silent no-op.
- **Fix:** Replaced the single restore slot with a ref-held `Map` keyed by
  session id, storing, reading, and deleting only the active session's restore
  layout. Added a regression test covering two sessions toggled to focus mode
  independently.
- **Commit:** same commit as this entry

### 3. Range-bar repaint can target a stale file container on file switch

- **Source:** github-codex-connector | PR #654 round 1 | 2026-07-04
- **Severity:** HIGH
- **File:** `src/features/diff/hooks/useDiffRangeBars.ts`
- **Finding:** The diff range-bar hook retained Pierre's last rendered shadow-DOM container but repainted whenever selected-file annotations changed. During file navigation, new-file spans could be combined with the previous file's retained container before Pierre posted the new file's render callback.
- **Fix:** Passed the selected-file key into the hook, stored that key with the retained container, invalidated the container on file-key changes, and skipped repaint unless the stored container key still matches the active file key. Added a regression test that changes file keys with different spans and verifies the previous file host is not repainted.
- **Commit:** same commit as this entry
