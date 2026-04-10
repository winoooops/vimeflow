---
id: cross-platform-paths
category: cross-platform
created: 2026-04-09
last_updated: 2026-04-10
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

### 2. Windows `O_NOFOLLOW` equivalent required for symlink TOCTOU closure

- **Source:** github-claude | PR #38 round 5 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** On Unix, `libc::O_NOFOLLOW` passed via `OpenOptionsExt::custom_flags` makes the kernel atomically refuse to follow a symlink at the final path component. The `#[cfg(unix)]` block excluded this flag on Windows, and there was no Windows-side equivalent, leaving a TOCTOU window between `symlink_metadata` and `open`.
- **Fix:** Under `#[cfg(windows)]`, set `FILE_FLAG_OPEN_REPARSE_POINT` (0x00200000) via `std::os::windows::fs::OpenOptionsExt::custom_flags`. This tells `CreateFileW` to open the reparse point itself rather than following it. Add a post-open metadata check to explicitly reject reparse points (since `CreateFileW` succeeds against them rather than erroring like `ELOOP` on Unix).
- **Commit:** `28027a5 fix: address Claude review round 5 findings`, `36902f7 fix: address Claude review round 6 findings`
