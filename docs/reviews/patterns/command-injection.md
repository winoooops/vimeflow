---
id: command-injection
category: security
created: 2026-04-09
last_updated: 2026-05-02
ref_count: 2
---

# Command Injection

## Summary

Never interpolate user-supplied values into shell commands via template strings
or string concatenation. Use `execFileSync`/`spawnSync` with an args array (no
shell). For file APIs, validate paths are repo-relative and resolve symlinks
before access.

## Findings

### 1. Shell injection via unescaped file parameter in execSync

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** CRITICAL
- **File:** `vite.config.ts`
- **Finding:** Untracked-file diff path uses `execSync` with template string interpolating `file` query parameter directly into shell command
- **Fix:** Switched to `execFileSync` with args array, validated path is repo-relative
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 2. Path traversal via symlink in file API

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** HIGH
- **File:** `vite-plugin-files.ts`
- **Finding:** `validateRepoPath` doesn't resolve symlinks — repo-contained symlink to external location bypasses validation
- **Fix:** Resolved real paths with `fs.realpath` and validated real path is within repo root
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 3. File API allows reading excluded/sensitive paths

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** HIGH
- **File:** `vite-plugin-files.ts`
- **Finding:** Exclude list only filters during tree traversal, not direct path access — `.git`, `.env` readable via direct query
- **Fix:** Applied exclude check to all path access, not just tree traversal
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 4. Untracked diff endpoint allows arbitrary file reads

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** HIGH
- **File:** `vite.config.ts`
- **Finding:** Untracked-file fallback only strips `..` — absolute paths and symlinks still pass through
- **Fix:** Validated path resolves inside repo root using `path.resolve` + `path.relative`
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 5. Unquoted paths in `sh -c` hook commands silently disable security

- **Source:** claude-review | PR #73 | 2026-04-20 (round 2)
- **Severity:** HIGH
- **File:** `harness/client.py`
- **Finding:** `settings.json` `PreToolUse` hook entries were built as raw
  f-strings: `f"{sys.executable} {hook_runner} bash"`. Claude CLI passes the
  string to `sh -c`, so a space anywhere in `sys.executable` (Windows
  "Program Files") or the harness path (macOS "/Users/John Doe/…") splits the
  command at that space, drops the runner, and falls through to CLI-default-allow
  — the Bash allowlist and feature_list integrity hook are both silently bypassed.
- **Fix:** `shlex.quote()` both tokens before interpolation. Regression test
  monkey-patches `sys.executable` to a path with a space and asserts
  `shlex.split` round-trips the emitted command to exactly 3 args.
- **Commit:** `0f76df4 fix(harness): shell-quote hook command paths; hoist imports; document judge cache scope`

## How to apply

Beyond the general "no template-string shell commands" rule:

- **Any string that will be passed to `sh -c`, `bash -c`, `settings.json`
  hook commands, cron lines, systemd `ExecStart`, etc. — `shlex.quote` every
  path component.** Don't assume the path is well-formed; macOS and Windows
  defaults both include spaces.
- **Test with a space-in-path fixture.** Monkey-patch `sys.executable` or
  copy your tool into a `/tmp/has space/` directory in a regression test.
  Static review rarely catches this.

### 6. Allowlist for git refs admits range operators (`..`, `...`) that change diff semantics

- **Source:** github-claude | PR #130 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/diff/services/gitPatch.ts`
- **Finding:** `isSafeBaseBranch` blocked `-`-prefixed flag injection and null-byte injection — both real shell-style attacks. It did not block git range operators (`main..HEAD`, `main...HEAD`), which are valid characters in the existing allowlist but completely change git diff's semantics: `git diff main..HEAD` is a two-dot range diff (commits reachable from HEAD but not main), not a simple branch comparison. The displayed hunks would silently misrepresent which changes the user is reviewing. Same finding-class as #4 (untracked diff endpoint allows arbitrary file reads): the validation considered the obvious shell-injection vectors but missed git-semantic injection.
- **Fix:** Tightened the allowlist to a regex `/^[a-zA-Z0-9_/][a-zA-Z0-9_/.-]*$/` that admits letters, digits, slash, hyphen, underscore, and `.` as a single character — sufficient for branch names, slash-separated ref paths, and SHA-shaped values. Added an explicit `!baseBranch.includes('..')` check on top of the regex so the rejection is unambiguous to readers. Test cases added for `main..HEAD`, `main...HEAD` (both reject → fall back to working-tree path), `feature/diff-cleanup`, and `abc1234` (both accept).
- **Commit:** _(see git log for the round-1 fix commit)_
