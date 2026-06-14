# PR3 — Visible-Pane Hot Loading And Prefetch

**Status:** draft
**Scope:** bounded refresh orchestration
**Depends on:** PR2

## Goal

Warm the status snapshots for panes the user is likely to switch to next without creating unbounded background work.

## Implementation Plan

- Define the v1 prefetch boundary as visible panes in the current session's split layout.
- Refresh the active pane at highest priority.
- Prefetch sibling visible panes in the background after the active pane request is scheduled.
- Deduplicate concurrent refreshes for the same pane.
- Track request generation or abort signals so late responses from older pane selections are ignored.
- Keep hidden sessions and non-visible historical panes out of prefetch for v1.

## Interface Guidance

- Expose a small refresh coordinator API from the snapshot layer rather than scattering request logic through components.
- Keep request cancellation and stale-result dropping close to the coordinator.
- Make prefetch limits explicit and testable.

## Tests

- Active pane refresh runs before sibling prefetch.
- Visible sibling panes are prefetched once.
- Hidden sessions are not prefetched.
- Duplicate requests for the same pane coalesce.
- A stale response from an old active pane does not replace the current pane snapshot.

## Acceptance Criteria

- Fast switching among visible split panes usually hits a warm snapshot.
- Background work remains bounded by the current visible pane set.
- The implementation is deterministic enough for unit tests and does not depend on timing heuristics.

## PR Boundary Notes

At the start of PR3, revisit whether PR2's store API is sufficient. If not, make a small PR3-local API adjustment and document the reason in this file.
