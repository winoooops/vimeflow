---
id: pane-slot-identity
category: correctness
created: 2026-06-19
last_updated: 2026-07-08
ref_count: 1
---

# Pane Slot Identity

## Summary

`SplitView` renders panes inside a CSS grid whose cells are addressed by explicit
`slot:<id>` identifiers. The visual position of a pane is determined by its slot,
not by its index in `session.panes[]`. Code that derives user-visible labels,
keyboard-shortcut hints, or callback arguments from the array index (or that drops
the slot id while threading an action through the component tree) will misalign
what the user sees with what the UI claims. Always use the resolved `slotIndex` or
pass the `slotId` through every layer that needs to act on a specific cell.

## Findings

### 1. SplitView tooltip/shortcut hint uses pane-array index, not slot position

- **Source:** github-claude | PR #555 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx` L291-340
- **Finding:** The `visiblePaneAssignments.map(({ pane, slotId }, i)` callback used
  the array index `i` for the focus tooltip (`Focus pane ${i + 1}`) and the shortcut
  hint (`Mod+${i + 1}`). With explicit placements, `panes[0]` can occupy a later
  visual slot, so the label/hint no longer matched the pane's grid position.
- **Fix:** Replaced both `i + 1` uses with `slotIndex + 1`, where
  `slotIndex = layout.definition.addOrder.indexOf(slotId)`.
- **Commit:** same commit as this entry

### 2. Pass the clicked empty slot into pane creation

- **Source:** github-codex-connector (P2 / MEDIUM) | PR #555 round 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx` L403-403
- **Finding:** Each rendered empty slot knew its `slotId`, but `EmptySlot` was not
  passed the value and `onAddPane` had no slot parameter. `applyAddPane` then let
  `normalizePanePlacements` assign the new pane to the first empty slot in
  `addOrder`, so clicking a later empty hole could create the pane elsewhere.
- **Fix:** Added `slotId` to `EmptySlotProps`, passed it from `SplitView` to
  `EmptySlot`, threaded it through `onAddPane` / `useSessionManager.addPane`, and
  updated `applyAddPane` to record a `{paneId, slotId}` placement when a slot id is
  provided.
- **Commit:** same commit as this entry

### 3. Pane focus shortcuts follow array order instead of visual slots

- **Source:** github-codex-connector | PR #610 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts` L89-164
- **Finding:** SplitView advertised focus shortcuts by visual slot after drag-to-slot placements, but `usePaneShortcuts` still mapped `Digit1` through `Digit6` to `activeSession.panes[index]`. Swapped panes could show `Mod+1` on one slot while the shortcut focused a different pane, and custom 3x3 layouts advertised `Mod+7` through `Mod+9` that were not handled.
- **Fix:** Resolve digit shortcuts through the active layout's `addOrder` and `resolvePanePlacement`, then focus the pane assigned to the requested visual slot. The hook now accepts the workspace layout registry and supports slots 1 through 9.
- **Commit:** same commit as this entry

### 4. Native shortcut context reused pane-order assignments for slot shortcuts

- **Source:** github-codex-connector | PR #642 round 1 | 2026-07-01
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitView.tsx`
- **Finding:** The native Ghostty shortcut context derived `paneIds` from `resolvePanePlacement().assignments`, whose order follows the visible pane array rather than `layout.definition.addOrder`. Explicit placements could therefore map native digit shortcuts to the wrong visual slot.
- **Fix:** Added a slot-ordered pane-id helper that projects assignments through `layout.definition.addOrder`, used it for `NativeGhosttyShortcutContext`, and covered swapped placements with a unit regression.
- **Commit:** same commit as this entry

### 5. Directional focus inferred neighbors from pane order instead of occupied slots

- **Source:** github-claude | PR #672 round 1 | 2026-07-08
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/usePaneShortcuts.ts`
- **Finding:** Directional pane navigation passed the active pane's visible-array
  index into the neighbor resolver. After drag-to-slot placement, that index no
  longer represented the pane's grid cell, so focus could jump to an absent or
  visually unrelated pane.
- **Fix:** Resolve active and occupied slot ids from `resolvePanePlacement`, then
  choose directional neighbors from the layout slot geometry and map the chosen
  slot back to its assigned pane. Added slot-placement regression coverage.
- **Commit:** same commit as this entry
