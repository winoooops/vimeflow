---
id: persisted-state-invariants
category: correctness
created: 2026-06-08
last_updated: 2026-06-08
ref_count: 3
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

### 2. storePresent stays true for an all-zero-pane store

- **Source:** github-claude | PR #396 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `reconstructWorkspace` filters zero-pane persisted sessions before rebuilding, but `storeAuthoritative` was computed from the raw `storeShape.sessions.length`. If a crash or migration leaves only zero-pane records, restore falls back to live PTYs while `onRestore` is told to skip the legacy browser-pane cache, so cached browser panes can disappear.
- **Fix:** Compute `storeAuthoritative` from the same usable-session invariant as reconstruction: `storeShape.sessions.some((session) => session.panes.length > 0)`.
- **Commit:** same commit as this entry

### 3. activate returns even when optional onActivePersisted did not run

- **Source:** github-claude | PR #396 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** `activate` called `onActivePersistedRef.current?.(activeStoreId)` and then unconditionally returned. The exported hook declares `onActivePersisted` optional; any caller that omits it while restoring an active store session skips both PTY-based activation and fallback activation, leaving no selected session.
- **Fix:** Guard the callback invocation and return: only return after persisted activation when `onActivePersistedRef.current` exists and was invoked; otherwise fall through to the existing PTY/fallback activation paths.
- **Commit:** same commit as this entry

### 4. Brand-new browser pane with no live tabs blocked the whole durable write

- **Source:** github-claude | PR #404 round 2 | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `WorkspaceLayoutWriter.assemble()` returned `null` whenever any browser pane lacked live, remembered, or preserved tabs. A newly-created browser pane can enter the renderer shape before its main-side `WebContentsView` exists, so a close during that gap made `flush()` fail and skipped persistence of the latest workspace shape.
- **Fix:** Treat a pane with no live, remembered, removed, or preserved source as a brand-new pane and persist `tabs: []`; Rust repair seeds the default tab if that snapshot is restored. Kept the removed-and-readded guard returning `null`, and added writer tests for both cases plus close-flush persistence.
- **Commit:** same commit as this entry

### 5. Browser-tab cache and assembled snapshots need separate cloned objects

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** LOW
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `tabsForBrowserPane` cloned live or preserved tabs, stored that clone in `lastTabsByBrowserPane`, then cloned the clone for the assembled store. That extra pass obscured the real invariant: the writer cache and returned snapshot should be separate cloned objects so callers cannot mutate the cached durable fallback.
- **Fix:** Clone the original live or preserved tabs separately for the cache and the assembled store, avoiding clone-of-clone work while preserving object isolation between the cache and the returned snapshot.
- **Commit:** same commit as this entry

### 6. Reappearing browser pane keys must clear removed-state before flush

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** HIGH
- **File:** `electron/workspace-layout-writer.ts`
- **Finding:** `noteBrowserPaneShape` added disappearing browser pane keys to `removedBrowserPaneKeys` but did not clear that set when a key reappeared. A pane that briefly disappeared and then reappeared before its live view was capturable caused `tabsForBrowserPane` to return `null`, making teardown flush skip persistence.
- **Fix:** Clear `removedBrowserPaneKeys` for every key present in the next shape. Updated assemble and flush coverage so a reappearing pane with no live capture persists as `tabs: []` rather than blocking the save.
- **Commit:** same commit as this entry
