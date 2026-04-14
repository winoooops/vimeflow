---
id: filesystem-scope
category: security
created: 2026-04-09
last_updated: 2026-04-10
ref_count: 1
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

### 4. `write_file` calls `create_dir_all` before scope validation (path traversal)

- **Source:** local-codex | PR #38 round 1 | 2026-04-09
- **Severity:** P1 / HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** Initial `write_file` implementation called `fs::create_dir_all(parent)` before canonicalizing the parent and validating it against `home_canonical`. A forged path like `~/../etc/evil.txt` passed the raw-prefix check and mutated directories outside the home sandbox before the canonical scope check rejected the write.
- **Fix:** Reject any `..` component in the expanded raw path before any filesystem mutation. Walk up to the deepest existing ancestor, canonicalize it, verify it's under `home_canonical`. Re-anchor the unresolved tail onto the canonical ancestor and verify again. Only then call `create_dir_all` and write to `resolved_parent.join(file_name)`.
- **Commit:** `1a6ef44 fix(security): prevent path traversal in write_file`

### 5. `write_file` final target path not validated — symlink escape via `fs::write`

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** The parent directory check was correct, but `fs::write` follows symlinks by default. A symlink at the target position (e.g. `~/evil_link -> /etc/passwd`) would pass the parent check and let the write escape home.
- **Fix:** Add a post-parent symlink guard using `fs::symlink_metadata` to reject any symlink at the target. For existing regular files, canonicalize the full target path and verify it resolves under home (matches the `read_file` pattern).
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 6. `read_file` TOCTOU — no `O_NOFOLLOW`, scope-check bypassable

- **Source:** github-claude | PR #38 round 6 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** `read_file` canonicalized the path and checked scope, then called `fs::read_to_string` which opens without `O_NOFOLLOW`. Between the scope check and the read, a concurrent process could `unlink` the canonical file and place a symlink to `/etc/passwd` at that exact path — `read_to_string` would follow the new symlink and leak sandboxed-out contents to the webview.
- **Fix:** Rewrite `read_file` to use `OpenOptions` with `O_NOFOLLOW` on Unix and `FILE_FLAG_OPEN_REPARSE_POINT` on Windows, plus a post-open metadata check on Windows to reject reparse points. Mirror the write_file pattern.
- **Commit:** `36902f7 fix: address Claude review round 6 findings`

### 7. `write_file` TOCTOU between `symlink_metadata` check and `fs::write`

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** LOW / MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** Residual TOCTOU window between the `symlink_metadata` pre-check and the subsequent `fs::write` — a racing `unlink`+`symlink` could swap the validated regular file for a symlink, and `fs::write` would follow it.
- **Fix:** Use `OpenOptions` with `O_NOFOLLOW` (Unix) so the kernel atomically refuses to follow a symlink at the final component, returning `ELOOP` instead.
- **Commit:** `28027a5 fix: address Claude review round 5 findings`

### 8. Windows TOCTOU — no equivalent of `O_NOFOLLOW`

- **Source:** github-claude | PR #38 round 5 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** The Unix path was protected by `O_NOFOLLOW` but the Windows branch had no equivalent, leaving a TOCTOU window between `symlink_metadata` and `OpenOptions::open`. A racing `unlink`+`symlink` could still swap the validated regular file for a reparse-point symlink.
- **Fix:** Set `FILE_FLAG_OPEN_REPARSE_POINT` (0x00200000) via `std::os::windows::fs::OpenOptionsExt::custom_flags` so `CreateFileW` opens the reparse point itself rather than following it. Add a post-open metadata check on Windows to reject if we landed on a symlink (O_NOFOLLOW-style atomic refusal is Unix-only).
- **Commit:** `28027a5 fix: address Claude review round 5 findings`

### 9. Windows reparse-point guard silently corrupts racing symlinks

- **Source:** github-claude | PR #38 round 6 | 2026-04-10
- **Severity:** LOW
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** `FILE_FLAG_OPEN_REPARSE_POINT` opens the reparse point itself rather than following it, and the subsequent `write_all` would write editor content into the reparse data buffer — returning `Ok(())` while destroying the in-home symlink. Security held (no escape) but behavior diverged from Unix's clean `ELOOP` rejection.
- **Fix:** After `open()` on Windows, query the handle's metadata and reject if the file type is a symlink, returning the same "refusing to write through symlink" error as the pre-open check.
- **Commit:** `36902f7 fix: address Claude review round 6 findings`

### 10. `write_file` intermediate symlink TOCTOU — lexical join unsafe after validation

- **Source:** github-claude | PR #38 round 7 | 2026-04-10
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** After the ancestor canonicalization walk, `resolved_parent` was assembled as a lexical join of `ancestor_canonical` and the unresolved `relative_tail`. `create_dir_all` then operated on this lexical path, and the subsequent `open()` only had `O_NOFOLLOW` protection on the **final** component. A concurrent process could create a symlink at a not-yet-existing intermediate component (e.g. `~/real_dir/raced_sub -> /tmp`) and redirect the write outside home.
- **Fix:** Re-canonicalize `resolved_parent` AFTER `create_dir_all` and re-verify it's under home before constructing `target = resolved_parent.join(file_name)`. Canonicalize resolves any symlinks a racing process may have slipped in.
- **Commit:** `1545491 fix: address Claude review round 7 findings`

### 11. `create_dir_all` leaves stray directories outside home before re-check

- **Source:** github-claude | PR #38 round 8 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** The previous round re-canonicalized AFTER `create_dir_all` ran in a single shot, so empty directories may have been created outside home if a racing process planted a symlink at an intermediate not-yet-existing segment. The write was still blocked, but the filesystem was mutated.
- **Fix:** Replace the single `create_dir_all` call with a per-segment loop that creates one directory at a time and canonicalizes after each `mkdir`. The first out-of-scope segment is detected immediately, capping the blast radius at one stray empty directory per call.
- **Commit:** `3e0304f fix: address Claude review round 8 findings`

### 12. `create_dir` per-segment loop fails on `AlreadyExists`

- **Source:** github-claude | PR #38 round 13 | 2026-04-10
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** The `if !next.exists()` check is not atomic with the subsequent `create_dir` call. A concurrent process creating the same directory in the gap caused `create_dir` to return `Err(AlreadyExists)`, which was propagated as a user-visible save failure — even though the directory is now present and the write would succeed.
- **Fix:** Replace `map_err(?)` with an explicit match that swallows `ErrorKind::AlreadyExists` as benign. The subsequent canonicalize + scope check still verifies the final state is under home.
- **Commit:** `3999b50 fix: address Claude review round 13 findings`

### 13. `write_file` truncates before writing — corrupt file on partial write failure

- **Source:** github-claude | PR #38 round 14 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** `OpenOptions::create(true).truncate(true)` zeroed the target file the moment `open()` returned, BEFORE `write_all` transferred any bytes. Any mid-write failure (disk full, I/O error, signal) left the file at zero length — silent data loss for a code editor.
- **Fix:** Switch to the atomic write pattern — write to a sibling temp file, `sync_all` for durability across post-rename crashes, then `fs::rename` the temp onto the target. `rename(2)` is atomic on POSIX within the same filesystem; the target either points at the old bytes or the new bytes, never a partially-written file.
- **Commit:** `fa933d6 fix: address Claude review round 14 findings`

### 14. Atomic write temp-file name collides on concurrent saves (PID-only suffix)

- **Source:** github-claude | PR #38 round 15 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** Temp file named `.{file_name}.vimeflow.tmp.{pid}` — PID is constant for the process lifetime, so two concurrent `write_file` IPC calls targeting the same path collide on `create_new(true)` with `EEXIST`. Common trigger: `:w :w` in vim (the save callback fires on every keypress).
- **Fix:** Add a per-process `AtomicU64` counter and append its value to the temp-file name, giving every invocation a unique path.
- **Commit:** `38292c7 fix: address Claude review round 15 findings`
