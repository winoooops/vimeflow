---
id: filesystem-scope
category: security
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Filesystem Scope

## Summary

Tauri IPC commands that access the filesystem must validate paths against an
allowlist. The webview is an untrusted boundary — a compromised renderer could
enumerate sensitive directories without scope restrictions.

## Findings

### 1. Unrestricted filesystem access from Tauri command

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** `list_dir` accepts any client-supplied path without validating against an allowed root or Tauri fs scope
- **Fix:** Added home-directory scope validation — canonicalize requested path, verify `starts_with(home_dir)` before reading
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 2. File explorer can navigate above home directory

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** MEDIUM
- **File:** `src/features/files/hooks/useFileTree.ts`
- **Finding:** `navigateUp` allows navigation to paths outside home scope, triggering access denied errors
- **Fix:** Clamped `navigateUp` at home directory boundary
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 3. Rust filesystem tests use temp dir outside allowed home scope

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** Tests create directories under `/tmp` which is outside the enforced home-directory scope, causing test failures
- **Fix:** Moved test directories under home directory path
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`
