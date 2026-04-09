---
id: testing-gaps
category: testing
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Testing Gaps

## Summary

Every `.ts`/`.tsx` production file must have a co-located `.test.ts`/`.test.tsx`
sibling. New modules added without tests violate the project testing rule and
increase regression risk. Tests must also respect runtime constraints (e.g.,
filesystem scope restrictions).

## Findings

### 1. New core modules lack co-located tests

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/workspace/hooks/useResizable.ts` (and 3 others)
- **Finding:** Four new production modules added without sibling test files: `useResizable.ts`, `useSessionManager.ts`, `fileSystemService.ts`, `useFileTree.ts`
- **Fix:** Added co-located test files for all new modules
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`
