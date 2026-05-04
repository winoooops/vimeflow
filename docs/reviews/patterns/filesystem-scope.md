---
id: filesystem-scope
category: security
created: 2026-04-09
last_updated: 2026-05-03
ref_count: 3
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

### 15. Agent status transcript path not scoped before tailing

- **Source:** github-claude | PR #63 round 1 | 2026-04-14
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/watcher.rs`
- **Finding:** `maybe_start_transcript` converted the `transcript_path` string from `status.json` directly into a `PathBuf` and passed it to the transcript tailer. A crafted or injected statusline could make Vimeflow open and tail an arbitrary local file.
- **Fix:** Add a shared transcript-path validator that canonicalizes the file and requires it to resolve under the canonical `~/.claude` root before tailing. Use it from both `maybe_start_transcript` and the direct `start_transcript_watcher` IPC command.
- **Verification:** Added `validate_transcript_path_rejects_path_outside_claude_root`; `cargo test --lib agent::transcript -j1`.
- **Commit:** (pending — agent-status-sidebar PR)

### 16. `start_transcript_watcher` IPC accepted renderer-controlled cwd

- **Source:** local-handed-back | PR #109 round 0 | 2026-04-29
- **Severity:** HIGH
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `start_transcript_watcher` Tauri command's `cwd: Option<String>` parameter came from the renderer and was passed straight into the watcher. The test-runner parser then used it to read `package.json` for npm-script alias resolution and to canonicalize per-file test paths. Renderer-controlled filesystem influence on which workspace gets read.
- **Fix:** Remove the `cwd` parameter from the IPC. The command now derives cwd server-side from `PtyState::get_cwd(session_id)`. Backend-internal callers (the statusline bridge in `watcher.rs`) keep using the inner `start_or_replace` API directly.
- **Verification:** Existing tests + new `transcript_state_threads_cwd_through`.
- **Commit:** `006be43 fix(agent): close cwd data-flow gaps in TranscriptWatcher`

### 17. `TranscriptState::start_or_replace` ignored cwd in identity check (stale workspace)

- **Source:** local-handed-back | PR #109 round 0 | 2026-04-29
- **Severity:** HIGH
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** Identity check compared only `transcript_path`, so a same-transcript-different-cwd start returned `AlreadyRunning` and the tail thread kept its stale snapshot. Test-runner parser then resolved aliases and per-file paths against the previous workspace. The `TranscriptWatcher.cwd` field carried a `#[allow(dead_code)]` annotation that silenced the lint without fixing the bug.
- **Fix:** Identity check became `(transcript_path, cwd)` — either changing forces a Replace. Removed the dead_code annotation; the field is now load-bearing state. Docstring rewritten to explain why.
- **Verification:** Added `transcript_state_replaces_when_only_cwd_changes`.
- **Commit:** `006be43 fix(agent): close cwd data-flow gaps in TranscriptWatcher`

### 18. `start_watching` captured cwd snapshot — stale after `cd`

- **Source:** github-codex (chatgpt-codex-connector) | PR #109 round 5 | 2026-04-29
- **Severity:** P1 / HIGH
- **File:** `src-tauri/src/agent/watcher.rs`
- **Finding:** Notify closure, initial-read block, and polling fallback all held a `cwd: PathBuf` snapshot taken at `start_watching` call time. After the user `cd`'d in the PTY, `maybe_start_transcript` kept passing the OLD cwd to `TranscriptState::start_or_replace`, so npm-script alias resolution and per-file path containment kept running against the previous workspace.
- **Fix:** `maybe_start_transcript` queries cwd FRESH from `PtyState` at every call. The cwd parameter was removed from `start_watching` and from its caller `start_agent_watcher`. Combined with the `(transcript_path, cwd)` identity check, a mid-session `cd` now triggers a Replace of the tail thread on the next statusline event.
- **Verification:** existing transcript and watcher tests.
- **Commit:** `99dbfe9 fix(agent): address codex review findings on PR #109`

### 19. `process_tool_result` defaulted to `Path::new(".")` when no PTY cwd

- **Source:** github-codex (chatgpt-codex-connector) | PR #109 round 6 | 2026-04-29
- **Severity:** P2 / MEDIUM
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** When `PtyState::get_cwd(session_id)` returned None, `process_tool_result` substituted `Path::new(".")` as the cwd for the test-runner snapshot builder. `Path::new(".")` canonicalizes to the Tauri app process's cwd — NOT the user's workspace — so per-file test groups would silently resolve against the wrong directory (producing non-clickable rows or rows pointing to unrelated files in the app dir).
- **Fix:** Skip the test-run snapshot entirely when no workspace cwd is available; log at `debug!`. The standard `agent-tool-call` event still fires unconditionally; only the structured snapshot is gated. Three integration fixtures updated to pass a valid temp cwd (they previously relied on the now-removed fallback).
- **Verification:** `transcript_vitest_e2e`, `transcript_vitest_replay`, `transcript_cargo_e2e`.
- **Commit:** `a02be27 fix(agent): round-6 fixes — cwd fallback, content joining, overflow`

### 20. Debug log to fixed `/tmp` path vulnerable to symlink attack

- **Source:** github-claude | PR #109 round 5 | 2026-04-29
- **Severity:** MEDIUM (security)
- **File:** `src-tauri/src/agent/watcher.rs`
- **Finding:** `OpenOptions::new().create(true).append(true).open("/tmp/vimeflow-debug.log")` follows symlinks on Unix. A local actor on a shared system (cloud dev VMs, Codespaces, Gitpod) can pre-create the path as a symlink to redirect appends. Linux's default umask 022 also leaves the file world-readable. The block was inside `cfg(debug_assertions)` so debug builds shipped with this. Logged values include workspace paths and session IDs.
- **Fix:** Drop the file-log block entirely; use the existing structured `log::debug!` macro (already configured for the rest of the file). Run with `RUST_LOG=debug` to see startup diagnostics.
- **Commit:** `ea6b1ea fix(agent): round-5 review findings — security, polish, runner coverage`

### 21. Transcript path validation needs explicit invalid-path and threat-model boundaries

- **Source:** github-claude | PR #152 post-merge review | 2026-05-03
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/adapter/claude_code/transcript.rs`, `src-tauri/src/agent/adapter/base/path_security.rs`
- **Finding:** Transcript path validation built a `PathBuf` from raw statusline text without first rejecting embedded null bytes, and the path-security helper documented its two-phase canonicalize/create/check flow without stating the accepted single-user desktop threat model. That left future maintainers unsure whether the residual same-user TOCTOU window was intentional or overlooked.
- **Fix:** Reject null bytes before path conversion, keep transcript files scoped under canonical `~/.claude`, and document the helper as a best-effort single-user desktop guard. The comment now calls out that fd-pinned traversal or `cap-std`-style APIs are required if the threat model expands to shared writable roots or hostile same-user races.
- **Commit:** _(pending on this branch)_
