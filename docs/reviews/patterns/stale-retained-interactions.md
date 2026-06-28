---
id: stale-retained-interactions
category: react-patterns
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 2
---

# Stale Retained Interactions

## Summary

When a React component renders retained or stale content while fresh data for a new context is loading asynchronously, interactive descendants must be made inert. If clicks, keyboard activation, or assistive-tech interaction remain enabled on the retained content, actions dispatch against callbacks bound to the current context and produce wrong results — for example, opening a diff or file for the old pane's path against the new pane's working directory. The fix is to detect the retained-content state and apply the `inert` attribute (or equivalent `pointer-events`/`select` disabling) to the retained-content wrapper, not to loading skeletons or to current-pane content.

## Findings

### 1. Make retained body non-interactive during pane switches

- **Source:** github-codex-connector | PR #468 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- **Finding:** While `useRetainedBodyState` showed a previous pane's retained snapshot during a cold-pane fetch (`phase === 'fetching'`), the body content remained fully interactive. Clicking a retained `FilesChanged` row or live action dispatched `onOpenDiff`/`onOpenFile` callbacks bound to the current pane's `cwd`, which could open the wrong diff or fail even though the visible row came from the old repo.
- **Fix:** Added `isRetainedBody = isBodyFetching && bodySnapshotKey !== snapshotKey` and applied `inert` plus `select-none` to a wrapper around the non-skeleton body content. Same-pane refreshes and loading skeletons are unaffected. Added unit tests covering both the retained (inert) and same-pane refresh (interactive) cases.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Retained-body inert test clicked a non-actionable ActivityFeed node

- **Source:** github-codex-connector + local-codex verify | PR #468 round 2 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusPanel/index.test.tsx`
- **Finding:** The test named `makes retained body non-interactive while fetching a cold target pane` clicked `src/retained.ts`, but that text was rendered by `ActivityFeed`, while `onOpenDiff` is only wired through `FilesChanged`. Because the retained snapshot used an empty `gitStatus`, there was no `FilesChanged` row to click, so `expect(onOpenDiff).not.toHaveBeenCalled()` stayed true even if `inert` were removed from the actionable body.
- **Fix:** Populated the retained snapshot with a `gitStatus.files` entry and changed the click target to the rendered `FilesChanged` row button. Added an inert click-blocking polyfill to the jsdom test setup because jsdom exposes the `inert` attribute but does not suppress activation of inert subtrees, so synthetic clicks on the row would otherwise still dispatch `onOpenDiff` and make the meaningful assertion fail.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
