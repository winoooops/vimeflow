# Sidebar Status Header — Design Spec

**Date:** 2026-04-30
**Status:** Superseded by shipped sidebar header + global status bar work
**Author:** Claude (with Will)

## Current State

The sidebar status header work shipped: `WorkspaceView` owns the live
`useAgentStatus` read and passes it to `SidebarStatusHeader` and the activity
panel. The right-side activity panel no longer owns the agent identity card.

The former activity-panel footer has been removed. Session duration, turn
count, cache hit rate, and line deltas now live in the global bottom
`StatusBar`; the activity panel ends at the scrollable activity/test/file
sections.

## Follow-Ups

- Keep `useGitStatus` watcher deduplication tracked separately.
- Keep responsive `StatusCard` / `BudgetMetrics` work separate from the
  footer removal.
