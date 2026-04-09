---
id: command-injection
category: security
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
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
