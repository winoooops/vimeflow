---
id: pane-slot-identity
category: correctness
created: 2026-06-19
last_updated: 2026-06-19
ref_count: 0
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
