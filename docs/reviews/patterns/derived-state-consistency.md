---
id: derived-state-consistency
category: code-quality
created: 2026-06-07
last_updated: 2026-06-15
ref_count: 8
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

### 5. Restore-tab serving returned a mutable reference to the retained store

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/workspace-layout-controller.ts`
- **Finding:** `tabsForPane` returned `pane.tabs` directly from the controller's retained repaired store. A caller that mutated the returned array or nested history entries could corrupt the in-memory restore source, so later writer fallbacks could persist caller-owned mutations instead of the repaired durable state.
- **Fix:** Clone tab arrays and nested history entries before returning them from `tabsForPane`. Added a regression test that mutates the returned tabs and verifies a later lookup still reads the original repaired history.
- **Commit:** same commit as this entry

### 6. Theme child command labels exposed the internal kebab-case ID instead of the human-readable name

- **Source:** github-claude | PR #424 round 1 | 2026-06-12
- **Severity:** LOW
- **File:** `src/features/workspace/commands/buildWorkspaceCommands.ts` and `src/features/command-palette/data/defaultCommands.ts`
- **Finding:** Both command trees mapped theme child entries with `label: theme.id`, so the command palette rendered `"obsidian-lens"` / `"flexoki"` as the primary text. `description` already used `theme.label` (`"Switch to Obsidian Lens"`), confirming the intended display value was available but misassigned.
- **Fix:** Changed both sites to `label: theme.label` so users see the theme display name.
- **Commit:** same commit as this entry

### 7. Vite HMR fallback reverted a theme to its original import after editing the other theme

- **Source:** github-claude | PR #424 round 2 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/theme/service.ts`
- **Finding:** The `import.meta.hot.accept` callback rebuilt the `themes` array from the updated module exports, but when only one theme file changed Vite passed `undefined` for the other module. The fallback used the original static `obsidianLens` / `flexoki` imports, which were frozen at module load and did not reflect earlier HMR updates. Editing one theme, then the other, silently replaced the first edited theme with its initial values until reload.
- **Fix:** Insert a `themes.find((t) => t.id === ...)` fallback between the new-module export and the original static import, so the live `themes` entry is preserved when a sibling theme file is the one that changed.
- **Commit:** same commit as this entry

### 8. `activate()` still receives stale `list.activeSessionId` after `activePtyId` is updated for restarted shell

- **Source:** github-claude | PR #443 round 1 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/sessions/hooks/useSessionRestore.ts` L343-400
- **Finding:** The restore effect correctly recomputes `activePtyId` when `restartPersistedActiveShell` spawns a replacement PTY for the persisted active shell. That updated value is passed to `reconstructWorkspace`, but the subsequent `activate()` call still used the original `list.activeSessionId`. In the graceful-quit restart path that original value is `null`, so callers that rely on the active-PTY activation branch (no `onActivePersisted` handler) fall back to the first session instead of selecting the restarted active shell.
- **Fix:** Pass the updated `activePtyId` local to `activate()` instead of `list.activeSessionId`.
- **Verification:** Added regression test that restarts a persisted active shell without an `onActivePersisted` handler and asserts `onActiveResolved` is called with the workspace session id.
- **Commit:** same commit as this entry

### 9. Directional pane shortcut used raw pane index instead of visible-slot index

- **Source:** github-codex-connector | PR #460 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** When a session had more panes than the current layout capacity, `SplitView.selectVisiblePanes` rendered the active pane in the last visible slot, but the new directional shortcut passed the pane's original array index into `resolveDirectionalPane`. The grid only contains slots like `p0`/`p1`, so a pane beyond the prefix could not be found and the shortcut returned `null` even though the pane was clearly visible.
- **Fix:** Moved `selectVisiblePanes` to a shared utility and computed the visible-pane mapping inside `usePaneShortcuts`. Directional resolution now uses the active pane's visible-slot index and maps the resulting visible-slot index back to the actual pane id via `visiblePanes[targetVisibleIndex].id`.
- **Commit:** same commit as this entry

### 10. Vim leader directional chords resolved against raw pane indices instead of visible slots

- **Source:** github-claude | PR #460 round 2 | 2026-06-15
- **Severity:** HIGH
- **File:** `src/features/command-palette/hooks/useVimLeaderChords.ts`
- **Finding:** `focusDirection` passed the active pane's raw `session.panes` index into `resolveDirectionalPane`, but the layout grid only contains slots up to `capacity - 1`. When the session had more panes than the layout capacity and the active pane was rescued into the last visible slot, the chord consumed the key and returned `true` with no movement because the raw slot did not exist in the grid.
- **Fix:** Mirrored the `usePaneShortcuts` approach: compute `visiblePanes` via `selectVisiblePanes(session.panes, shape.capacity)`, resolve from `activeVisibleIndex`, and activate `visiblePanes[targetVisibleIndex].id`. Added an over-capacity regression test for Vim leader `h`/`j`/`k`/`l`.
- **Commit:** same commit as this entry

### 11. Vim leader `w` chord cycled through raw pane array instead of visible slots

- **Source:** github-claude | PR #460 round 2 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/hooks/useVimLeaderChords.ts` L79-93
- **Finding:** `cycleNextPane` advanced through `session.panes` directly. In an over-capacity layout (e.g. three panes in a two-slot `vsplit`), pressing the leader `w` chord could focus a hidden pane. `selectVisiblePanes` would then rescue that pane into the last visible slot, evicting the pane that was already there and causing a visible layout jump. This also made `w` inconsistent with the directional `h`/`j`/`k`/`l` chords, which already resolved against the visible-slot subset.
- **Fix:** Derived the current layout shape from `LAYOUTS[session.layout]`, guarded the `undefined` case, computed `visiblePanes = selectVisiblePanes(session.panes, shape.capacity)`, and cycled within the visible array before activating `visiblePanes[next].id`. Added an over-capacity regression test verifying that `w` wraps within the visible subset rather than jumping to a hidden pane.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
