---
id: cross-platform-paths
category: cross-platform
created: 2026-04-09
last_updated: 2026-05-06
ref_count: 2
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

### 3. UI subtitle splits cwd on `/` only — Windows native separators collapse the whole path into one segment

- **Source:** github-codex-connector | PR #174 round 16 | 2026-05-06
- **Severity:** MEDIUM (P2)
- **File:** `src/features/workspace/components/Sidebar.tsx`
- **Finding:** `sessionSubtitle` derived the subtitle line by `workingDirectory.split('/').filter(Boolean)` and returning the last segment. On Windows, Tauri can hand back a native path like `C:\Users\alice\my-repo`; the `/`-only split treats the whole string as one element, the basename derivation returns the entire path, and the row layout regresses for Windows users whenever `currentAction` is empty. The bug had no test coverage because all existing fixtures used POSIX paths.
- **Fix:** Normalize `\\` → `/` first (`workingDirectory.replace(/\\/g, '/')`), THEN split-and-trim. Per user direction during the same cycle, also widened the basename rule to "last 2 segments joined by `/`" so a shallow path like `/home/will` reads as `home/will` instead of collapsing aggressively to `will`. Single-segment paths return that segment as-is; empty falls back to the raw cwd. Added two regression tests: `C:\Users\alice\my-repo` → `alice/my-repo`, and `/home/will` → `home/will`. Code-review heuristic: any path-derivation that splits on a hardcoded separator is implicitly POSIX-only — desktop apps that ship on Windows (here: a Tauri target) must normalize separators OR use `path.basename`/`std::path::Path` BEFORE any string slicing.
- **Commit:** _(see git log for the cycle-16 fix commit on PR #174)_
