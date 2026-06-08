---
id: derived-state-consistency
category: code-quality
created: 2026-06-07
last_updated: 2026-06-08
ref_count: 2
---

# Derived State Consistency

## Summary

When a computed or derived value is produced alongside a base value from the
same source, later patches to the base must also refresh the derived value.
Leaving the derived field stale creates visible mismatches — wrong labels,
inconsistent displays, or silent logic errors — even though the underlying
base data is technically "correct."

## Findings

### 1. Legacy-cache reconciler overrides workingDirectory but not name

- **Source:** github-claude | PR #381 round 5 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts`
- **Finding:** When `overrideBaseline` is true (no persisted
  `grouping.workspaceDirectory`), the reconciler patches
  `workingDirectory` to the canonical active pane's cwd but leaves
  `session.name` at whatever `buildGroupedSession` computed from its
  fallback (`tabName(panes[0].cwd, fallbackIndex)`). For a workspace
  where `panes[0]` is not the real active pane, the tab name is derived
  from the wrong directory. The test for this path also lacked a `name`
  assertion, leaving the regression untested.
- **Fix:** Captured the grouped session index in the `.map()` callback
  and extended the override spread to include
  `name: tabName(newActivePane.cwd, sessionIndex)` alongside
  `workingDirectory`. Added the missing `name` assertion to the legacy-
  cache test.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)

### 2. Background restored tabs emit stale default URL before history restore

- **Source:** github-claude | PR #390 round 1 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/browser-pane.ts`
- **Finding:** In `createOwnedTab`, when `options.restore` is set and
  `options.activate` is false, `emitTabsChanged(record)` fires before
  `restoreTabHistory` has run. The new tab's `requestedUrl` is still
  `DEFAULT_BROWSER_URL` (set at tab creation), so the renderer receives a
  `BROWSER_PANE_TABS_CHANGED` snapshot carrying the wrong URL for every
  background restored tab. The corrected event arrives only after the async
  `navigationHistory.restore()` completes.
- **Fix:** Swapped the order so `restoreTabHistory` (which synchronously
  updates `tab.requestedUrl` to the persisted active URL) runs before the
  `activate`/`emitTabsChanged` block, ensuring the first snapshot is built
  from the correct URL.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)

### 3. createBrowserPane return snapshot reads tab-0 after restoring a non-zero active tab

- **Source:** github-codex-connector | PR #390 round 2 | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/browser-pane.ts`
- **Finding:** After restoring all browser tabs and calling `setActiveTab`
  for a non-zero active index, the `createBrowserPane` return block still
  reads `url`, `title`, and `navState` from the original `tab-0`
  `WebContentsView`. The renderer receives an initial IPC response where
  `tabs` says tab-N is active while the top-level `url`/`navState` reflect
  tab-0, causing a brief flash of inconsistent address-bar / navigation
  state before the corrective event arrives.
- **Fix:** Replaced the hard-coded tab-0 references with
  `this.activeTab(record)` / `this.activeWebContents(record)` so the
  returned snapshot always reflects the currently active tab, matching the
  `tabs` array already emitted by `this.tabSnapshots(record)`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on
  this line)

### 4. Split-horizon favicon DNS dropped the public resolved target

- **Source:** github-claude | PR #404 round 3 | 2026-06-08
- **Severity:** LOW
- **File:** `electron/browser-pane.ts`
- **Finding:** `resolveHostForFaviconFetch` derived several candidate targets from DNS answers but selected the first private target before the PNA gate ran. For a split-horizon hostname with both private and public answers, a public page rejected the private target and never tried the public address, so favicons silently failed even though a safe public target existed.
- **Fix:** Prefer the first public resolved target, falling back to a private target only when all answers are private. Added a regression test that verifies the pinned lookup uses the public address when DNS returns private then public addresses.
- **Commit:** same commit as this entry
