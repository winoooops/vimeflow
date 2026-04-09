---
id: cross-platform-paths
category: cross-platform
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Cross-Platform Paths

## Summary

Path manipulation using string operations (regex split on `/`) breaks on
Windows. Drive roots like `C:/Users` become `C:` (drive-relative, not root)
when the trailing segment is stripped. Always normalize drive roots and
consider using path libraries for cross-platform code.

## Findings

### 1. Windows path navigation resolves to drive-relative `C:` instead of `C:/`

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** MEDIUM
- **File:** `src/features/files/hooks/useFileTree.ts`
- **Finding:** `navigateUp` strips last segment with `/` regex, turning `C:/Users` into `C:` — not a valid absolute path on Windows
- **Fix:** Added Windows drive root detection — if result matches `^[A-Za-z]:$`, append `/`
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`
