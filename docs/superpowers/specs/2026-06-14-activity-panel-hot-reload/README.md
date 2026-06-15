# Activity Panel Hot Reload — VIM-127

**Linear:** [VIM-127](https://linear.app/vimeflow/issue/VIM-127/epic-stabilize-activity-panel-hot-reload-across-pane-switching)
**Integration branch:** `feat/vim-127-activity-panel-hot-reload`
**PR1 branch / worktree:** `feature/vim-127` on `worktrees/vim-127-activity-panel-hot-reload`
**Status:** PR5 in progress
**Supporting design analysis:** [`docs/design/activity-panel-hot-reload-analysis.html`](../../../design/activity-panel-hot-reload-analysis.html)

## Overview

The right activity/status sidebar currently becomes visually unstable when a user accumulates a long agent history across multiple panes and then switches panes. The panel can clear, rebuild, jump its scroll position, and replay status updates in a way that feels chaotic.

This spec plans a five-PR stabilization sequence. PR1 is documentation-only: it adds the technical plan, links the supporting HTML analysis, and defines the validation loop. PR2-PR5 implement the data model, hot loading, render stability, and final verification in separate reviewable increments.

All five implementation PRs target the integration branch, not `main`. After PR5 lands and the full feature is verified, the accumulated integration branch gets one final PR into `main`.

## Product Direction

- Preserve a per-pane scroll anchor so switching panes does not destroy reading context.
- Keep the content area calm during refresh by retaining the last good snapshot.
- Show stale/loading state as a subtle header affordance rather than a large banner.
- Hot-load only the current session's visible split panes in v1, keeping background work bounded.
- Let each PR revise its own plan at the beginning based on what the previous PR actually found.
- Accumulate PR1-PR5 on `feat/vim-127-activity-panel-hot-reload` before opening the final `main` PR.

## PR Sequence

1. [PR1 — Spec artifacts and documentation guardrails](./pr-1-spec-artifacts.md)
2. [PR2 — Status snapshot store](./pr-2-status-store.md)
3. [PR3 — Visible-pane hot loading and prefetch](./pr-3-prefetch-hotload.md)
4. [PR4 — Sidebar rendering stability](./pr-4-sidebar-rendering.md)
5. [PR5 — Verification, polish, and observability](./pr-5-polish-observability.md)

## Claude Code Review Loop

Every PR must run a local Claude Code review before it is considered ready. The review should use the repository's normal review policy from `AGENTS.md`, `agents/code-reviewer.md`, and the shared rules under `rules/`.

Use this command shape from the PR worktree:

```bash
claude -p \
  --output-format json \
  --json-schema "$(jq -c . .github/codex/codex-output-schema.json)" \
  --permission-mode plan \
  "Review the current git diff for Vimeflow using AGENTS.md, agents/code-reviewer.md, and the repository review rules. Return only the structured JSON verdict."
```

If Claude returns `overall_correctness: "patch has issues"`, fix only issues that belong to the current PR's scope, rerun the relevant checks, then rerun Claude. The PR is ready only after Claude returns `overall_correctness: "patch is correct"`.

## Acceptance Criteria

- The final implementation removes the visible jump/flicker behavior in the recording scenario: long histories, multiple panes, and fast pane switching.
- Pane switches retain existing content and per-pane scroll position while fresh data loads.
- Warm pane switches keep a retained below-header body visible until cold target status settles; first-load cases use fixed skeleton footprints instead of flashing empty content.
- Prefetch stays bounded to visible panes in the current session unless a later PR explicitly revises that boundary.
- Tests cover snapshot reuse, stale request drops, bounded prefetch, and scroll retention.
- The final docs explain the implemented behavior and any remaining limitations.

## Non-Goals

- PR1 does not change runtime behavior.
- V1 does not prefetch hidden sessions or the full workspace history.
- V1 does not introduce a prominent stale-data banner.
- V1 does not redesign unrelated sidebar surfaces.
