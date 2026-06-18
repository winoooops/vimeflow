---
id: dead-code
category: code-quality
created: 2026-06-13
last_updated: 2026-06-18
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

### 2. VITE_TERMINAL_RENDERER assignment in E2E onPrepare is dead code

- **Source:** github-claude | PR #524 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `tests/e2e/ghostty/wdio.conf.ts` L31-34
- **Finding:** `process.env.VITE_TERMINAL_RENDERER = 'ghostty'` in the WDIO `onPrepare` hook has no effect on the Electron renderer because `VITE_*` variables are baked into the renderer bundle by Vite at build time. The same variable is already injected by the `test:e2e:ghostty:run` script via `cross-env`, making the assignment doubly redundant.
- **Fix:** Removed the `VITE_TERMINAL_RENDERER` assignment from `onPrepare`; kept `VIMEFLOW_DISABLE_AGENT_DETECTION`, which is a genuine runtime env var.
- **Commit:** same commit as this entry
