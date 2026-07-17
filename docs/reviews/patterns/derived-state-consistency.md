---
id: derived-state-consistency
category: code-quality
created: 2026-06-07
last_updated: 2026-07-17
ref_count: 24
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

### 16. Blocked burner sync status survived after the foreground command exited

- **Source:** github-claude | PR #658 round 1 | 2026-07-04
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/HeaderActions.tsx`
- **Finding:** Clicking sync while a burner foreground command was active set
  the visible sync state to `blocked`, but the cleanup effect only watched
  whether the sync affordance disappeared. If the command exited while the
  burner stayed open and out of sync, the header kept showing the blocked icon
  and instruction even though the next click could sync normally.
- **Fix:** Added a focused effect that resets `blocked` back to `idle` when
  `burnerActive` becomes false while the sync affordance remains visible, plus
  regression coverage for the active-to-idle rerender transition.

### 17. Empty diff toolbar ignored draft-only feedback

- **Source:** github-codex-connector | PR #637 round 1 | 2026-06-30
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The empty diff state derived toolbar feedback visibility only from submitted annotations. When a non-empty draft survived after its file or hunk disappeared from git status, the workspace still had a pending draft-only review but the empty-state Discard/Finish controls were hidden.
- **Fix:** Derive the toolbar pending-feedback count from submitted annotations plus a non-empty draft, so users can discard draft-only reviews even when the diff has no changed files. Added an empty-state regression test for a draft-only feedback store.
- **Commit:** same commit as this entry

### 18. Draft-only feedback enabled Finish for an empty dispatch

- **Source:** github-codex-connector | PR #637 round 1 | 2026-06-30
- **Severity:** HIGH
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The toolbar pending-feedback count included draft text so the
  draft-only Discard action stayed visible, but the same count also made Finish
  clickable even though dispatch only sends submitted annotations.
- **Fix:** Keep the draft-inclusive count for action visibility, but only pass a
  Finish handler when submitted annotations exist. Added a regression test that
  draft-only empty-state feedback keeps Discard enabled while Finish is
  disabled and cannot open the popover.
- **Commit:** same commit as this entry

### 19. Range draft validity checked only the start line

- **Source:** github-codex-connector | PR #643 round 1 | 2026-07-01
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/hooks/useReviewCommentDraft.ts`
- **Finding:** Range comment drafts gained a `rangeEndLine`, but the diff
  refresh guard still considered the draft current as soon as the start line
  existed. If the end of the same-side range disappeared after a same-file
  refresh, the UI could keep rendering and submitting a draft that pointed at a
  non-existent end line.
- **Fix:** Track every required endpoint for the target side and only keep the
  draft current after both the start and optional range-end line have been seen.
  Added same-side range regression tests for the valid and stale-end cases.
- **Commit:** same commit as this entry

### 20. Mouse add-comment reused a stale visual selection from another line

- **Source:** github-claude | PR #643 round 1 | 2026-07-01
- **Severity:** HIGH
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The gutter add-comment handler passed the clicked
  line/side into the shared target builder, but the helper always preferred
  `visualSelectedLines` whenever a visual range existed. A user could leave a
  keyboard or drag visual range active, click the gutter plus on an unrelated
  row, and silently create feedback for the old range instead of the clicked
  line.
- **Fix:** Only reuse the visual range when the clicked line and side are inside
  that range; otherwise build a single-line target from the actual gutter click.
  Added a regression test that clicks line 1 while a visual range covers lines
  2-3.
- **Commit:** same commit as this entry

### 21. Editing range comments dropped the derived end-line target

- **Source:** github-claude | PR #643 round 2 | 2026-07-01
- **Severity:** MEDIUM
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The edit-comment path rebuilt `annotationTarget` from the
  annotation row only, preserving the start line and side but dropping
  `metadata.target.rangeEndLine`. Editing an existing range comment therefore
  collapsed the dialog back to a single-line target, and the subsequent update
  could lose the range endpoint used by staleness detection.
- **Fix:** When the annotation metadata carries a same-side range target,
  rebuild the edit target from `startLine` plus `endLine`; otherwise keep the
  single-line fallback. Added a regression test that opens an existing R1-R2
  comment for edit and submits the updated text through the range dialog.
- **Commit:** same commit as this entry

### 22. Copied feedback used weaker path derivation than sent feedback

- **Source:** github-codex-connector | PR #650 round 1 | 2026-07-03
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The terminal send path resolved each feedback batch key through
  the stored repo root before formatting, but the clipboard fallback parsed the
  same batch keys directly into repo-relative paths. Pasting copied feedback
  into an agent running from a repo subdirectory could therefore point at the
  wrong file.
- **Fix:** Extracted one shared feedback-entry builder for send and copy, using
  the per-cwd repo-root lookup before falling back to the current or last-known
  root. Added a clipboard regression test that copies a batch authored from a
  repo subdirectory and asserts the payload contains the resolved repo-root
  path.
- **Commit:** same commit as this entry

### 23. Sent review anchors counted as active pending feedback

- **Source:** github-claude + github-codex-connector | PR #655 round 1 | 2026-07-04
- **Severity:** HIGH
- **File:** `src/features/diff/hooks/useFeedbackBatch.ts`
- **Finding:** VIM-282 kept dispatched review comments in the hunk as sent
  anchors, but the soft-cap and send-completion paths still treated every
  retained annotation as active pending feedback. A sent 50-comment review could
  permanently block new comments, and comments added after the send snapshot but
  before completion could be stamped as sent without ever being included in the
  terminal payload.
- **Fix:** Changed the cap to count only pending annotations and made
  `markDispatched` accept the exact dispatched annotation-id snapshot built by
  the send path. Added hook regressions for sent anchors freeing capacity and
  for late comments remaining pending.
- **Commit:** same commit as this entry

### 24. Active review target selected a sent anchor before pending feedback

- **Source:** github-codex-connector | PR #664 round 1 | 2026-07-05
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/hooks/useReviewTargetNavigation.ts`
- **Finding:** The active review-target comment was derived with the first
  annotation matching the current line and side. After a sent comment remains
  as a dispatched thread anchor, adding a new pending comment on the same line
  left keyboard edit/delete shortcuts pointed at the older sent anchor.
- **Fix:** Resolve all annotations for the active target and prefer the newest
  pending annotation before falling back to the first retained anchor. Added a
  hook regression test for a dispatched anchor plus pending comment on the same
  line.
- **Commit:** same commit as this entry

### 25. Background pane restart clobbered active session metadata

- **Source:** local-codex | PR #667 round 4 | 2026-07-05
- **Severity:** HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** The pane-targeted restart path can restart an inactive pane, but
  the session-level `workingDirectory` and `agentType` were always overwritten
  from the restarted pane. Restarting a background shell could therefore make
  future panes spawn from the wrong cwd and make the session display disagree
  with the active pane.
- **Fix:** Updated session-level cwd and agent type only when the restarted pane
  is the active pane. Extended the inactive-pane restart test to assert the
  active session metadata remains unchanged.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 26. Cached terminal surfaces kept the previous resolved font

- **Source:** github-claude + github-codex-connector | PR #672 round 1 | 2026-07-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/Body.tsx`
- **Finding:** Terminal font settings were resolved in React state, but cached
  xterm instances and native Ghostty frame updates did not receive the changed
  font family. A settings change could update the provider while already-open
  terminal panes continued rendering with the previous font.
- **Fix:** Reapply the resolved font when reusing cached xterm instances and
  thread `terminalFontFamily` through the native Ghostty update path, including
  frame dedupe and Electron parent/helper handling. Added renderer and Electron
  regression tests.

### 27. Preserved native surface caches skipped replay on recreation

- **Source:** github-codex-connector | PR #675 round 1 | 2026-07-08
- **Severity:** P2 / MEDIUM
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** Destroying a primary Ghostty surface while preserving its burner secondary left `lastBackgroundColor`, `lastForegroundColor`, and `lastShortcutDigits` populated. Recreating the native surface with the same theme and shortcut context then skipped the setter calls needed to initialize the new surface.
- **Fix:** Reset the surface-scoped visual and shortcut caches whenever a native surface is torn down, including preserved-secondary destroys and window reparenting destroys. Added a regression test proving the same colors and shortcut digits are replayed onto the recreated surface.
- **Commit:** same commit as this entry

### 28. Shortcut tooltips ignored live keymap overrides

- **Source:** github-claude | PR #672 round 2 | 2026-07-09
- **Severity:** MEDIUM
- **File:** `src/components/StatusBar.tsx`, `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Dock-toggle and sidebar-tab tooltips continued rendering static
  shortcut chips even though those commands are rebindable through the new
  keymap settings. After customization, hover text showed stale combinations
  that no longer matched the active command bindings.
- **Fix:** Derive dock and sidebar tooltip shortcuts from `bindingFor(...)`
  using the same `chordToShortcutInput` path as the command palette tooltip.
  Added status bar coverage for a custom dock shortcut chip.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 29. Settings broadcasts must merge with local pending-load edits

- **Source:** github-claude | PR #672 round 4 | 2026-07-09
- **Severity:** MEDIUM
- **File:** `src/features/settings/SettingsProvider.tsx`
- **Finding:** Cross-window settings broadcasts replaced local state even while
  the receiving provider still had a pending pre-load edit. That could hide the
  user's own optimistic edit, then later replay the pending patch over a stale
  load base and revert fields from the broadcast.
- **Fix:** Retain the latest pre-load broadcast as the load base and overlay any
  pending local patch before rendering or saving. Added regression coverage for
  a broadcast arriving between a local pre-load edit and the load resolution.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 30. Request-review gates ignored single-comment Finish popovers

- **Source:** github-claude | PR #684 round 1 | 2026-07-11
- **Severity:** MEDIUM
- **File:** `src/features/diff/Panel.tsx`
- **Finding:** The Finish feedback popover's rendered open state was expanded
  from `finishOpen` to `finishOpen || sendNowCommentId !== null`, but the
  Request-review shortcut and toolbar gates still checked only `finishOpen`.
  Opening "Send comment now" could therefore leave Request-review enabled and
  allow two confirmation popovers to render at once.
- **Fix:** Derived a single `isFinishPopoverOpen` value and reused it for the
  Finish popover state plus both Request-review entry gates, so the shortcut
  and toolbar share the same exclusivity contract.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 31. Settings section availability split from pane render eligibility

- **Source:** github-claude | PR #700 round 1 | 2026-07-17
- **Severity:** MEDIUM
- **File:** `src/features/settings/sections.ts`, `src/features/settings/SettingsContent.tsx`
- **Finding:** Settings navigation and search used `AVAILABLE_SETTINGS_SECTIONS`
  while pane rendering maintained a separate `REAL_PANES` list with the same
  section IDs. Future settings work could update one list without the other,
  making a section appear navigable but render a placeholder, or hide a
  finished pane from navigation.
- **Fix:** Promoted available section IDs to the single exported availability
  source, derived `SETTINGS_SECTIONS` and `AVAILABLE_SETTINGS_SECTIONS` from it,
  and made `SettingsContent` type its pane registry against that same ID union.
  Added focused coverage that available IDs and available sections stay aligned.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
