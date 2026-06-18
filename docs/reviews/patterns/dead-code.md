---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-06-15
ref_count: 1
---

# Dead Code

## Summary

Unreachable or obsolete code paths add maintenance surface, mislead future
refactors, and can mask API-contract bugs. When every call site satisfies a
stricter precondition, fallback branches that were once necessary become dead
code and should be removed.

## Findings

### 1. Label-matching fallback in actionIdFor is unreachable

- **Source:** github-claude | PR #444 round 1 | 2026-06-13
- **Severity:** LOW
- **File:** `src/features/workspace/components/panels/FileExplorer.tsx`
- **Finding:** All entries in `contextMenuActions` carried explicit `id` fields, so the early `return action.id` made the subsequent `switch (action.label)` block unreachable. The dead code risked misleading maintainers into thinking new actions could rely on label matching.
- **Fix:** Removed the unreachable `switch` fallback; `actionIdFor` now returns `action.id ?? null` directly.
- **Commit:** see `git blame` / `git log` on this line

### 2. `clearAgentStatusRefreshCoordinator` exported but never called

- **Source:** github-claude | PR #459 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/utils/statusRefreshCoordinator.ts`
- **Finding:** `clearAgentStatusRefreshCoordinator` was exported from the singleton module but had no call sites. Without a comment, a future refactor would likely delete it.
- **Fix:** Added a comment documenting that the export is intentionally reserved for PR4 lifecycle hooks (session close / workspace teardown) and should not be wired to a `useEffect` cleanup today.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Redundant Tailwind padding shorthand alongside explicit overrides

- **Source:** github-claude | PR #464 round 1 | 2026-06-15
- **Severity:** LOW
- **File:** `src/features/agent-status/components/AgentStatusPanel/Header.tsx`
- **Finding:** The header root carried `px-2 pr-2 pl-3.5`. `px-2` set both sides to `0.5rem`, `pr-2` repeated the right value, and `pl-3.5` overrode the left value. The shorthand was a dead no-op that made the cascade harder to reason about.
- **Fix:** Removed `px-2`; kept only `pr-2 pl-3.5`.
- **Commit:** see `git blame` / `git log` on this line
