---
id: custom-pane-layout-preservation
category: correctness
created: 2026-06-19
last_updated: 2026-06-22
ref_count: 5
---

# Custom Pane Layout Preservation

## Summary

Custom pane layouts can define capacities larger than any builtin layout. When a custom layout is removed, rejected, or replaced with a smaller definition while sessions still depend on it, blindly shrinking those sessions to a builtin layout can silently drop panes on the next durable save/reload. The frontend must preserve the depended-on definition until every session using it can fit within the remaining allowed layouts, or explicitly resolve the excess panes instead of persisting an over-capacity builtin layout.

## Findings

### 1. Removing a large custom layout drops panes beyond builtin capacity

- **Source:** github-codex-connector (P1 / HIGH) | PR #546 round 1 | 2026-06-19
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/layout-registry/layoutRegistry.ts` L104-106
- **Finding:** `autoShrinkLayoutFor` fell back to `grid3x2` when the current custom layout was no longer registered and `nextPaneCount > 6`. The renderer kept all panes in memory, but the backend durable repair caps non-custom layouts at six panes, so the next save/reload silently dropped panes beyond the sixth.
- **Fix:** In `setCustomPaneLayouts`, validate the incoming definitions first, then preserve any existing custom layout whose id is still used by a session with more panes than `MAX_BUILTIN_PANE_COUNT` and that is absent or under-capacity in the candidate registry. The preserved definition overrides rejected or insufficient replacements, preventing the over-capacity builtin fallback.
- **Commit:** same commit as this entry

### 2. Builtin layout pick allowed for session with more panes than builtin supports

- **Source:** github-codex-connector (P1 / HIGH) | PR #569 round 1 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L532-532
- **Finding:** When a custom layout held 7–16 panes, the top-chrome layout switcher still exposed builtin layouts. Selecting a builtin layout persisted the session under a non-custom layout while retaining more panes than any builtin supports. The backend durable repair caps non-custom layouts at six panes, so extra panes were silently dropped on the next restore.
- **Fix:** Added a guard in `handlePickLayout` that rejects builtin layout picks whose capacity is below the active session's pane count. The session stays on its valid custom layout until panes are reduced.
- **Commit:** same commit as this entry

### 3. Imported custom layouts with too many tracks can pass UI validation and throw on Save

- **Source:** github-codex-connector (P1 / HIGH) | PR #569 round 2 | 2026-06-20
- **Severity:** P1 / HIGH
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts` L212-254 and `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx` L716-884
- **Finding:** `validateDraftLayout` only checked overlap, empty cells, and slot count. A JSON/YAML import with more than `MAX_LAYOUT_TRACKS` columns or rows but 16 or fewer covering slots could produce `validation.ok=true`, enabling Save. `definitionFromDraft` then invoked `validatePaneLayoutDefinition`, which enforced the 24-track cap and threw with no user-facing recovery.
- **Fix:** Added a `trackOverCapacity` flag to `DraftLayoutValidation` and `validateDraftLayout`; it is included in the `ok` predicate and surfaced as a validation message in `LayoutCreatorModal` so Save remains disabled for over-capacity imports.
- **Commit:** same commit as this entry

### 4. Custom layout picks can hide active panes without a capacity guard

- **Source:** github-codex-connector (P2 / LOW) | PR #569 round 2 | 2026-06-20
- **Severity:** P2 / LOW
- **File:** `src/features/workspace/WorkspaceView.tsx` L1246-1262
- **Finding:** `handlePickLayout` only capacity-guarded builtin layouts. The display-menu custom-layout path could apply a custom layout whose capacity was smaller than the active session's pane count, immediately hiding panes without explanation.
- **Fix:** Removed the builtin-only condition and applied the capacity check to all selected layouts via `layoutRegistry.capacityFor(layoutId)`.
- **Commit:** same commit as this entry

### 5. Intentional custom layout delete is undone by preservation guard

- **Source:** github-claude | PR #569 round 3 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts` L276-366 and `src/features/workspace/WorkspaceView.tsx` L1294-1314
- **Finding:** `handleDeleteCustomLayout` called `setSessionLayout(activeSessionId, 'single')` before calling `setCustomPaneLayouts` to remove the layout. The preservation guard inside `setCustomPaneLayouts` read `sessionsRef.current` before the queued session-layout change had committed, so it still saw the deleted custom layout as needed by an over-capacity session and re-merged it, silently undoing the delete.
- **Fix:** Added a `skipPreservation` option to `setCustomPaneLayouts`. `handleDeleteCustomLayout` passes `{ skipPreservation: true }` so the layout is removed unconditionally; the session migration then moves affected sessions to a fallback layout.
- **Commit:** same commit as this entry

### 6. Saving an undersized custom layout can reapply it to an over-capacity session

- **Source:** github-codex-connector | PR #569 round 4 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L1270-1295
- **Finding:** `handleSaveCustomLayout` persisted the custom definition and then unconditionally called `setSessionLayout(activeSessionId, definition.id)`. When the active session had more panes than the saved layout supported, that later session-layout update could override the custom-layout preservation/migration guard and leave panes hidden under an undersized layout.
- **Fix:** Guarded the auto-apply path with `activeSession.panes.length <= getPaneLayoutCapacity(definition)`. The definition is still saved and unhidden, but the active session is only rebound when the saved layout can display every pane.
- **Commit:** same commit as this entry

### 7. Capacity guard rejects layout picks without visible feedback

- **Source:** github-claude | PR #569 round 5 | 2026-06-20
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L1246-1258 and `src/features/terminal/components/LayoutSwitcher/LayoutDisplayMenu.tsx` L196-280
- **Finding:** The capacity guard correctly rejected layouts whose slot count was below the active session pane count, but the main switcher still displayed those choices and the display menu closed after a rejected custom-layout pick. The click appeared to do nothing and left users without a visible explanation.
- **Fix:** `handlePickLayout` now returns a success boolean, the top pill switcher receives only layouts that can fit the active session (plus the active layout), and the display menu marks blocked custom layout apply actions disabled so rejected picks stay visible instead of closing silently.
- **Commit:** same commit as this entry

### 8. Paint drag advertises a valid pane while the layout is already at the pane cap

- **Source:** github-claude | PR #569 round 6 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/terminal/components/LayoutCreator/LayoutCreatorModal.tsx` L285-287
- **Finding:** `previewValid` checked only spatial freedom, so after reaching `MAX_LAYOUT_SLOTS` a user could start a paint drag over an empty cell, see the valid green preview, release, and have `addSlotRect` refuse the pane with no visible feedback.
- **Fix:** Included the slot-count cap in preview validity and disabled empty paint cells while the draft already has `MAX_LAYOUT_SLOTS` panes. Added a regression test that imports a 16-pane layout, adds an empty column, and verifies the empty paint cell is disabled.
- **Commit:** same commit as this entry

### 9. Reduced-capacity custom layout edits can be silently discarded

- **Source:** github-codex-connector | PR #569 round 7 | 2026-06-21
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L1301-1310
- **Finding:** `handleSaveCustomLayout` saved edited definitions through `setCustomPaneLayouts` without marking the update as intentional. When an existing custom layout was edited down to fewer slots while an over-capacity session still referenced it, the preservation guard could restore the old definition and make the modal close as though the reduced-capacity edit had saved.
- **Fix:** Pass `{ skipPreservation: true }` from `handleSaveCustomLayout` so intentional edits bypass the preservation guard, matching the delete path. The existing session migration path handles sessions that no longer fit the edited layout.
- **Commit:** same commit as this entry

### 10. Duplicated custom layout id is minted from the source title

- **Source:** github-claude | PR #609 round 1 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleDuplicateCustomLayout` generated the clone id from the source layout title while assigning the visible clone title `Copy of ...`. The layout was unique, but persisted ids and UI/debug surfaces could show a slug unrelated to the clone's display title.
- **Fix:** Derive `cloneTitle` once and pass it to `createCustomPaneLayoutId`, then assign the same title to the cloned definition. The top-chrome regression test now expects the duplicated id slug to begin with `custom:copy-of-...`.
- **Commit:** same commit as this entry

### 11. Saving over-capacity custom layout edits bypasses preservation

- **Source:** github-codex-connector | PR #610 round 1 | 2026-06-22
- **Severity:** P1 / HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx` L1380-1386
- **Finding:** `handleSaveCustomLayout` passed `skipPreservation` for every save. Editing a custom layout down to fewer slots while a 7+ pane session still used it bypassed the guard that keeps the old over-capacity definition alive, allowing durable repair to drop panes beyond the builtin cap after reload.
- **Fix:** Removed the preservation bypass from ordinary saves so `setCustomPaneLayouts` can preserve depended-on over-capacity definitions. Intentional delete and duplicate flows keep their explicit behavior.
- **Commit:** same commit as this entry

### 12. Editing inactive custom layouts can unexpectedly switch the active session

- **Source:** github-codex-connector | PR #610 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx` L1391-1397
- **Finding:** Saving edits to any custom layout called `setSessionLayout` for the active session when the pane count fit, even if the edited layout was not the active session's current layout. A rename or metadata edit to an inactive layout could unexpectedly change the workspace layout.
- **Fix:** Gate auto-apply to newly created layouts and edits of the active layout only. Edits to inactive custom layouts now persist the definition without rebinding the active session.
- **Commit:** same commit as this entry

### 13. Slot resize can discard custom pane-kind restrictions

- **Source:** github-codex-connector | PR #610 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts` L475-479
- **Finding:** Resizing or moving a slot replaced the existing draft slot with geometry returned from the drag operation. If the original slot carried an `accepts` pane-kind restriction, that restriction was silently dropped from the saved custom layout.
- **Fix:** Preserve the existing slot's `accepts` restriction when `moveSlot` receives geometry that does not specify one, while still allowing explicit model updates to clear or replace restrictions.
- **Commit:** same commit as this entry
