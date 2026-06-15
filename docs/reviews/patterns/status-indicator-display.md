---
id: status-indicator-display
category: code-quality
created: 2026-05-26
last_updated: 2026-06-15
ref_count: 1
---

# Status Indicator Display

## Summary

Ambient status indicators (the bottom StatusBar's diff / context / duration
segments, badges, counters) must never render a value that misrepresents the
underlying state. Two recurring failure modes show up here. First, gating a
whole segment on a container predicate while its inner sub-elements render
unconditionally — a one-sided value like `added=500, removed=0` still shows a
misleading orange `−0`. Second, collapsing "no data yet" into a real zero via
`?? 0`, so an absent reading (context window not reported, or a sub-minute
duration) renders as a confident `0%` or vanishes entirely. The fix shape:
guard each rendered sub-element on its own non-zero condition, and represent
"no data" as a distinct state — `number | null` with the segment omitted, or a
sentinel like `<1m` — rather than a numeric default that maps onto a meaningful
colour/face tier.

## Findings

### 1. Diff segment renders +0 / −0 when one direction has no changes

- **Source:** github-claude | PR #277 round 2 | 2026-05-26
- **Severity:** MEDIUM
- **File:** `src/components/StatusBar.tsx`
- **Finding:** `hasChanges(session.changes)` gated the diff segment, but the
  `+added` and `−removed` spans both rendered unconditionally. An add-only
  change displayed `+500−0` (orange `−0`) and a remove-only change displayed
  `+0−300` (green `+0`) — a coloured zero implying a direction of change that
  did not occur.
- **Fix:** Render the `+X` span only when `session.changes.added > 0` and the
  `−Y` span only when `session.changes.removed > 0`. `hasChanges` still
  guarantees at least one side is non-zero, so the segment never renders empty.
  Added added-only and removed-only unit tests.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Context smiley shows 😊0% before the first contextWindow payload

- **Source:** github-claude | PR #277 round 2 | 2026-05-26
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`, `src/components/StatusBar.tsx`
- **Finding:** `statusBarContextPct` used `agentStatus.contextWindow?.usedPercentage ?? 0`
  while the agent was active, so the window between agent start and the first
  context-window IPC payload rendered `😊0%` in the success tone — conflating
  "no data" with "0% used".
- **Fix:** Typed `StatusBarProps.contextPct` as `number | null`, passed
  `usedPercentage ?? null` (null when inactive too) from WorkspaceView, and
  suppressed the context segment in `buildSegments` when contextPct is null.
  Added unit + integration tests.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. formatStatusDuration hides the duration label for the first 59s

- **Source:** github-claude | PR #277 round 2 | 2026-05-26
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `Math.floor(durationMs / 60_000) <= 0` returned undefined for
  1–59999 ms, so a running agent showed no elapsed-time indicator for its first
  minute — indistinguishable from "not started".
- **Fix:** Return `'<1m'` for `0 < durationMs < 60s`; `durationMs <= 0` still
  returns undefined ("no data yet", semantically distinct from "<1m"). Added an
  integration test.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Burner align button shows out-of-sync amber while disabled for an in-progress align

- **Source:** github-codex-connector | PR #454 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/BurnerTerminalPopup/index.tsx`
- **Finding:** After migrating the align control to `IconButton`, the amber `outOfSync` styling was applied via `className` whenever `outOfSync` was true, even when `alignBusy` disabled the button. This produced conflicting cues during a normal sync: a disabled/in-progress tooltip alongside an urgent amber visual.
- **Fix:** Gated the amber `outOfSync` class on `outOfSync && !alignBusy` so the busy state keeps the neutral disabled visual precedence.
- **Commit:** same commit as this entry
