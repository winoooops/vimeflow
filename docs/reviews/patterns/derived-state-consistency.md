---
id: derived-state-consistency
category: code-quality
created: 2026-06-07
last_updated: 2026-06-26
ref_count: 12
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

### 9. Saved crumb timestamp not tied to buffer identity

- **Source:** github-codex-connector | PR #510 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** The saved timestamp was inferred from a dirty→clean transition without verifying that the same buffer/session identity produced the transition. Switching sessions could show `SAVED · just now` for a buffer that had never been saved.
- **Fix:** Lifted `editorSavedAt` into `WorkspaceView`, reset it on file-path or session-id changes, and passed it down as a `savedAt` prop so the timestamp is scoped to the current buffer identity.
- **Commit:** see current commit

### 10. Saved crumb timestamp driven by dirty→clean heuristic

- **Source:** github-codex-connector | PR #510 round 1 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/DockPanel.tsx`
- **Finding:** The crumb timestamp was set on every transition from dirty to clean, including undoing all edits back to the original content. No disk write occurred, yet the UI rendered `SAVED · just now`.
- **Fix:** Replaced the heuristic with an explicit `savedAt` timestamp that `WorkspaceView` sets only after `editorBuffer.saveFile()` resolves successfully.
- **Commit:** see current commit

### 11. SplitView mapped pane index to `slots[N]` instead of persisted `addOrder[N]`

- **Source:** github-codex-connector | PR #542 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** `gridAreaForSlotIndex` resolved the slot id from `definition.slots[slotIndex].id`. For custom layouts whose `addOrder` intentionally differs from the `slots` declaration order, pane index N would be placed in the wrong grid region even though the persisted definition specified a different insertion order.
- **Fix:** Changed the helper to resolve the slot id from `definition.addOrder[slotIndex]` before converting it to a grid area, so restored and added panes follow the persisted insertion order.
- **Commit:** same commit as this entry

### 12. Prebuilt layout track units diverge numerically from `DEFAULT_RATIOS`

- **Source:** github-claude | PR #542 round 2 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/terminal/layout-registry/layoutDefinition.ts` L136-141 and `src/features/terminal/layout-registry/prebuiltLayouts.ts`
- **Finding:** `getPaneLayoutRatios(definition)` returned raw prebuilt track units such as `[14, 10]` for `threeRight`, while `DEFAULT_RATIOS.threeRight.cols` used `[1.4, 1]`. The proportions were identical for CSS grid rendering, but the numeric scales differed, so an equality check like `equalTrackRatios(currentRatios, getPaneLayoutRatios(layout.definition))` would report a mismatch even when the layout was at its default state.
- **Fix:** Normalized all prebuilt track units to the same scale as `DEFAULT_RATIOS` (e.g., `columns(1.4, 1)` for `threeRight`) and added a JSDoc note to `getPaneLayoutRatios` clarifying that it returns raw definition units and that callers needing canonical defaults should read `layout.defaultRatios`.
- **Commit:** same commit as this entry

### 13. Null context-window percentage normalized to known zero percent

- **Source:** github-codex-connector | PR #590 round 1 | 2026-06-21
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** The agent-status hook normalized `contextWindow.usedPercentage: null` to `0`, so opencode sessions with known input tokens but unknown context-window size reached the UI as a known 0%-used state. The existing `ContextReservoirCard` unknown-window token display never activated.
- **Fix:** Changed `ContextWindowState.usedPercentage` to `number | null`, preserved null during hook normalization, and added a regression test for an unknown-window opencode payload with input tokens.
- **Commit:** same commit as this entry

### 14. Tool args upgrade left test-file classification stale

- **Source:** github-codex-connector | PR #590 round 2 | 2026-06-21
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/transcript.rs`
- **Finding:** The opencode live path refreshed an in-flight tool record when `tool.before` supplied authoritative args after an empty pending part, but only patched `tool` and `args`. The derived `is_test_file` flag stayed at the pending placeholder value, so the terminal `tool.after` event could report a test-file tool call as non-test-file.
- **Fix:** Derive test-file status from authoritative `filePath` args and patch `entry.is_test_file` alongside the upgraded tool and args. Added a pending-empty -> `tool.before` test-file -> `tool.after` regression test that asserts the terminal event keeps `isTestFile: true`.
- **Commit:** same commit as this entry

### 15. Blank session name bypassed derived folder-name fallback

- **Source:** github-codex-connector + github-claude | PR #624 round 1 | 2026-06-26
- **Severity:** P2 / LOW
- **File:** `src/features/sessions/components/NewSessionDialog/NewSessionDialog.tsx`
- **Finding:** The dialog passed an empty or whitespace-only session name through to
  session creation, bypassing the derived folder-name fallback used for nullish names.
- **Fix:** Trim the submitted name and fall back to `deriveSessionName(path)` when it is blank.
- **Commit:** same commit as this entry
