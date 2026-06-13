---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-06-13
ref_count: 0
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
