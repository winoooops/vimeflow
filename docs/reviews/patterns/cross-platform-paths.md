---
id: cross-platform-paths
category: cross-platform
created: 2026-04-09
last_updated: 2026-06-22
ref_count: 12
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

### 4. `sessionSubtitle` empty-string race-window fallback returned `""` despite "never empty" comment

- **Source:** github-claude | PR #174 round 20 | 2026-05-07
- **Severity:** LOW
- **File:** `src/features/workspace/components/Sidebar.tsx`
- **Finding:** The cycle-16 cwd-derivation rewrite for `sessionSubtitle` added a comment claiming the subtitle "is never empty" with the fallback `return session.workingDirectory` for the zero-segments case (`parts.length === 0` after split + filter). But when `workingDirectory` is itself `""` — the brief race-window state between session creation and the first OSC 7 cwd report from Tauri — the fallback returns `""`, the subtitle div renders with empty content, and a visible vertical gap appears between the title and the state pill. The comment's "never empty" guarantee is a lie that a future maintainer might rely on.
- **Fix:** Single-character change: `return session.workingDirectory || '~'`. `~` is the conventional shell display for an unknown / home cwd. Preserves POSIX root `/` (which is truthy and falls through `||`) and only kicks in for the actual empty-string race-window case. Comment expanded to spell out the race-window rationale explicitly so the next maintainer doesn't need to re-derive why the bare-`workingDirectory` fallback was insufficient. Added regression test asserting an empty-cwd session renders `~` in its row subtitle (scoped via `within(getByTestId('session-row'))` to avoid colliding with the SidebarStatusHeader's separate `~` display). Code-review heuristic: any fallback that promises an invariant in a comment must be testable with an actual edge-case test — comments alone don't enforce invariants, and review-time "looks fine" reading easily misses the chain `'' → split → []` → `[]` → fallback returns `''`.
- **Commit:** _(see git log for the cycle-20 fix commit on PR #174)_

### 5. Codex `proc_root` fallback `unwrap_or_else(|| PathBuf::from("/proc"))` re-introduced `/proc` on macOS/Windows after `default_proc_root()` already returned `None` to disable it

- **Source:** github-claude | PR #302 round 1 | 2026-05-29
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/bindings.rs` L115-118 (consumer), `crates/backend/src/agent/adapter/codex/locator.rs` (producer)
- **Finding:** The agent-adapter refactor wired Codex's `AgentBindings::for_attach` to pass `ctx.proc_root.clone().unwrap_or_else(|| PathBuf::from("/proc"))` into `CompositeLocator::new`. The platform guard in `config::default_proc_root()` (`Some("/proc")` on Linux, `None` elsewhere) was therefore silently undone at the consumer: on macOS / Windows production runs the proc-backed fast-paths (`resume_thread_id_from_proc`, `open_rollout_paths_from_proc`) would try to open `/proc/<pid>/cmdline` and `/proc/<pid>/fd/*` and fail with ENOENT every attach. Inline comments in `codex/mod.rs:56-57` and `locator.rs:124` already documented that the `/proc` hardcode was test-only and "safe ONLY because the `#[cfg(test)]` gate prevents accidental production use" — but the production binding did exactly what those comments warned against.
- **Fix:** Widened `CompositeLocator::new(_, _, _, proc_root: Option<PathBuf>)` and `SqliteFirstLocator::with_proc_root(_, proc_root: Option<PathBuf>)`. `resolve_from_resume_arg` and `resolve_from_proc_fds` early-return `Ok(None)` when `self.proc_root.is_none()`, so the locator falls through cleanly to the logs / FS-scan strategies on non-Linux. `AgentBindings::for_attach` now passes `ctx.proc_root.clone()` directly with no `unwrap_or_else`. The test-only `SqliteFirstLocator::new` and `CodexAdapter::new` constructors kept their explicit `Some(PathBuf::from("/proc"))` so the locator unit-test surface didn't change. Added a regression test (`proc_root_none_skips_proc_fast_paths_and_falls_through_to_logs`) pinning the contract: with `proc_root = None`, the locator binds via the logs-table path without crashing on the proc fast-paths. Code-review heuristic: any platform-conditional `Option<T>` plumbed through a constructor stack is only as strong as its weakest unwrap site — a single `unwrap_or_else(default)` undoes every upstream platform check, and the right structural fix is to thread `Option<T>` all the way down to the consumer that knows how to gate on `is_some()`.
- **Commit:** _(PR #302 upsource cycle 1 fix commit)_

### 6. Codex title-sync watcher path joined onto a relative `trust_root` when `HOME` was absent, bypassing the canonicalization that the status-path flow relies on

- **Source:** github-claude | PR #302 round 2 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/watcher_runtime.rs` L741-756
- **Finding:** Cycle 1's F5 fix re-wired the Codex `session_index.jsonl` title-sync watcher by computing `session_index_path = located.trust_root.join("session_index.jsonl")` and handing it to `spawn_watch`. But `default_codex_home()` returns relative `PathBuf::from(".codex")` when `dirs::home_dir()` is `None` (headless containers, service sessions with no `HOME` env, CI environments) — that relative path flows into `CompositeLocator::codex_home` → `LocatedStatusSource::trust_root`. The status-path flow tolerated this because `ensure_status_source_under_trust_root` canonicalizes early and fails noisily if `trust_root` can't resolve; the title-sync path I added in cycle 1 bypassed that gate entirely, so `session_index::spawn_watch` would open `.codex/session_index.jsonl` against the sidecar's cwd (NOT the user's home), silently emit zero events, and the operator would have no signal that Codex titles weren't updating. Sibling of #5 — same shape (platform-conditional / environment-conditional plumbing) but the gate this time wasn't a `cfg!` check, it was an implicit "canonicalize-or-error" gate that the new path missed.
- **Fix:** Add an explicit `if !located.trust_root.is_absolute()` guard in `start_watching` before spawning the title-sync watcher. Non-absolute trust_root → skip the spawn, set both `session_index_stop` / `session_index_join` to `None` (so `WatcherHandle::Drop` becomes a no-op for those fields), and emit `log::warn!` naming the offending relative path. Operators correlating "Codex titles aren't updating" now have a single grep target (`"codex title-sync: skipping spawn"`) and the cause (missing HOME / `dirs::home_dir()` returns `None`). Code-review heuristic: when a refactor adds a NEW consumer of a value that an EXISTING consumer treats as trusted (canonical path, validated URL, sanitized input), audit how the existing consumer earned that trust — usually via a canonicalization / validation / sanitization step that the new consumer might be bypassing. If the value's invariant is "absolute path", add an `is_absolute()` assertion at the new consumer; if "no traversal characters", re-run the sanitizer; if "schema-valid", re-validate. Don't assume upstream did it just because the type signature is the same.
- **Commit:** _(PR #302 upsource cycle 2 fix commit)_

### 7. `filesCwd !== gitStatusCwd` uses raw string equality and disables lifecycle labels

- **Source:** github-claude | PR #510 round 6 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/workspace/utils/editorFileLifecycleStatus.ts` L207-210
- **Finding:** The guard comparing `filesCwd` to `gitStatusCwd` used raw `!==`, so trailing slashes, tilde expansion, or case-only differences on case-insensitive volumes made equivalent directories look different. The function then returned `null`, silently disabling the `NEW`/`DELETED` lifecycle crumb for the selected editor file even though the file was inside the reported git status directory.
- **Fix:** Reuse the shared `normalizePathForComparison` helper (which expands `~`, normalizes separators, strips trailing slashes, and lowercases on macOS/Windows) before comparing both cwd values.

### 8. Workspace bucket basename could exceed filesystem component limits

- **Source:** github-codex-connector | PR #563 cycle 1 | 2026-06-19
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/terminal/bridge.rs` L84 (original)
- **Finding:** `workspace_bridge_bucket` constructed an app-data directory component from the sanitized cwd basename plus a `_<sha256>` suffix. When the project directory name was long but still a valid filename, the combined component exceeded common filesystems' 255-byte component limit, causing `create_dir_all` to fail and leaving the session without a generated bridge.
- **Fix:** Truncate the sanitized basename to `MAX_BUCKET_BASENAME_BYTES = 242` bytes (leaving room for the underscore, 6-hex hash, and margin) before appending the hash suffix. The resulting component stays well under 255 bytes even on conservative filesystems.
- **Commit:** same commit as this entry
- **Commit:** same commit as this entry

### 9. Path-normalization tests compared case-folded output against raw `$HOME`

- **Source:** github-claude | PR #572 round 2 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/workspace/utils/editorFileLifecycleStatus.test.ts`
- **Finding:** The pre-push Vitest hook failed on macOS because `parentPathForGitStatus('~/repo/src/new.ts')` intentionally lowercases the expanded path on case-insensitive platforms, while the test expected the raw `$HOME` casing (`/Users/...`). The production behavior was correct, but the platform-sensitive expectation made the local gate fail and encouraged a `git push --no-verify` bypass.
- **Fix:** Keep the direct `expandTildePath` assertion for raw home expansion, but compare the git-status parent path with `normalizePathForComparison(`${home}/repo/src`)` so the expected value follows the same case-folding contract as the API under test.
- **Commit:** same commit as this entry

### 10. opencode provider home used a Linux XDG path as a home-relative subdir

- **Source:** github-claude | PR #584 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/config.rs`
- **Finding:** The opencode registry entry set `home_subdir` to `.local/share/opencode`, which made `provider_home()` resolve a Linux XDG data path through `dirs::home_dir().join(...)` on every platform. macOS and Windows would receive nonexistent home-relative paths instead of their platform data directories once the opencode adapter starts consuming `provider_home`.
- **Fix:** Cleared opencode's `home_subdir` for the scaffold milestone and documented the M6 follow-up to resolve it through `dirs::data_dir().join("opencode")` when the adapter needs the value.
- **Commit:** same commit as this entry

### 11. Missing macOS helper binary blocked fallback attach strategies

- **Source:** github-claude | PR #593 round 1 | 2026-06-21
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/locator.rs`
- **Finding:** The non-`/proc` Codex locator relies on `lsof` for macOS/BSD open-rollout detection. If the binary was absent from PATH, the provider surfaced `NotFound` as an authoritative provider error, so the resolver returned `NotYetReady` before resume-argv, logs, or recency fallback strategies could run.
- **Fix:** Treat `io::ErrorKind::NotFound` from the lsof runner as empty output, preserving the pre-lsof fallback behavior when the platform signal is unavailable. Timeout and non-zero-exit errors still propagate as provider failures.
- **Commit:** same commit as this entry

### 12. Windows rename does not replace existing bridge plugin files

- **Source:** github-codex-connector | PR #603 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/install.rs` L147
- **Finding:** `std::fs::rename(tmp, target)` replaces an existing file on Unix but fails on Windows when `target` already exists. Because OpenCode bridge install errors are non-fatal, Windows users with a stale or unparsable plugin file could remain on the old schema indefinitely.
- **Fix:** Routed replacement through a platform helper: Unix keeps atomic rename-over-existing, while Windows removes an existing target before renaming the temp file into place and cleans up the temp file on failure.
- **Commit:** same commit as this entry
