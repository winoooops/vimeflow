---
id: shared-controller-segmentation
category: react-patterns
created: 2026-06-18
last_updated: 2026-06-18
ref_count: 0
---

# Shared Controller Segmentation

## Summary

When a single logical control surface (for example, a split-pane divider) is
rendered as multiple visual segments, every segment must be driven by the same
stateful controller or hook instance. Giving each segment its own controller
causes the segments to fight: they write to the same CSS variables or state,
react to one another's updates with stale internal values, and can produce
infinite re-render loops or interactions that snap back to a previous position.
The fix is to group segments by the logical boundary they represent, instantiate
the controller once per group, and pass the resulting binding down to each
positioning child.

## Findings

### 1. Segmented dividers own independent hooks — infinite update loop on drag

- **Source:** github-claude | PR #527 round 1 | 2026-06-18
- **Severity:** HIGH
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx` L60-135
- **Finding:** `DIVIDER_SPECS` rendered each visual segment as its own
  `SplitDividerHandle`, and each handle called `useSplitDivider`. For `quad` and
  `grid3x2`, multiple segments shared the same `trackAxis` + `trackIndex`
  boundary. A drag commit on one segment updated `initialRatios`, which changed
  the sibling segment's `writeRatio` callback reference and re-fired its commit
  effect with a stale `size`, reverting the drag and triggering a loop.
- **Fix:** Grouped divider specs by logical boundary (`trackAxis` +
  `trackIndex`) and introduced a `SplitBoundary` component that owns a single
  `useSplitDivider` instance per group. Each visual segment now receives the
  shared binding as a prop.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this
  line)

### 2. Avoid mounting duplicate controllers for one divider

- **Source:** github-codex-connector | PR #527 round 1 | 2026-06-18
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/SplitView/SplitDividers.tsx` L126
- **Finding:** The lower-row vertical segments in `grid3x2` mounted a second
  `useSplitDivider` for the same column boundary as the upper segment. After a
  drag, the sibling segment's commit effect re-ran with its old elastic `size`
  and wrote the old boundary back, making the vertical divider snap or revert.
- **Fix:** Same grouping as finding 1: each unique `(trackAxis, trackIndex)`
  boundary now maps to exactly one controller, and the duplicated segments are
  rendered as passive visual handles sharing that controller.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this
  line)
