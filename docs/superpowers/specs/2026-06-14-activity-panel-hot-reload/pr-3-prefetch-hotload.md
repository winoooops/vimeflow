# PR3 — Visible-Pane Hot Loading And Prefetch

**Status:** implemented in PR3
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

## PR3 Implementation Notes

- Added `statusRefreshCoordinator` as the small refresh coordinator API.
- The coordinator runs bounded `detect_agent_in_session` refreshes and writes
  pane-keyed warm snapshots; it does not replace the existing active
  `useAgentStatus` live event subscription.
- Active pane refresh is planned first, then visible sibling shell panes.
- Refreshes are capped at four visible PTY-backed panes, matching the current
  split layout ceiling.
- In-flight refreshes for the same pane coalesce.
- Late responses are applied only if the pane is still in the current visible
  set, so old active-pane responses cannot warm hidden sessions.
- Detection refreshes preserve existing rich snapshot fields such as context,
  cost, tool calls, and tests; they only update the minimal active/detected
  identity fields.

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
