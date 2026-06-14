# PR2 — Status Snapshot Store

**Status:** draft
**Scope:** frontend data model and tests
**Depends on:** PR1

## Goal

Introduce a stable activity/status snapshot layer so pane switching does not force the sidebar to clear and rebuild from scratch.

## Implementation Plan

- Audit the current data flow in `src/features/agent-status`, `src/features/sessions`, and `src/features/workspace` to identify the active pane/session keys used by the sidebar.
- Add a snapshot store or hook that keeps the latest known status payload per pane.
- On pane switch, render the existing snapshot immediately, then refresh asynchronously.
- Preserve a per-pane scroll anchor in the store so returning to a pane restores the user's reading position.
- Merge updates incrementally using stable item ids; do not replace the entire list when only a few rows changed.
- Keep terminal states and error states explicit so retained content never hides a real failure.

## PR2 Boundary Decision

The current sidebar already has a usable status identity: `WorkspaceView` passes the active PTY-backed pane id into `useAgentStatus`, and backend agent events are already keyed by the same PTY id. PR2 therefore keys snapshots by that PTY-backed pane id and stays frontend-only. No Rust IPC or binding change is required for this slice.

The PR2 store is intentionally in-memory and bounded to the most recent pane snapshots. PR3 owns request orchestration and should add stale-response guards in the hot-load coordinator, where the async refresh lifecycle has a real production caller.

## Interface Guidance

- Prefer existing feature-local hooks and stores over a new global state framework.
- Avoid Rust IPC changes unless the audit proves current events lack a stable identity needed for incremental merging.
- If a backend event shape must change, stop PR2 at a revised spec and split the wire change into its own implementation step.

## Tests

- Snapshot is reused immediately when switching back to a pane.
- Unknown pane shows the existing loading state, then stores its first snapshot.
- Incremental updates preserve row identity for unchanged items.
- Per-pane scroll anchor is saved and restored.
- Stale refresh results cannot overwrite the currently active pane.

## Acceptance Criteria

- Switching between panes with existing snapshots does not show an empty sidebar.
- Returning to a pane restores its last content and scroll context.
- Tests document the expected store behavior before render-level work begins.

## PR Boundary Notes

At the start of PR2, verify whether the current sidebar already has a usable status identity. If not, revise this document before implementing rather than inventing identity policy inside code.
