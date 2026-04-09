---
id: git-operations
category: correctness
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Git Operations

## Summary

Git operations exposed via API must handle edge cases: hunk-level staging/discard
requires extracting the correct patch (not full-file `git add`), untracked files
need special handling (`git diff --no-index`), and diff sources must be consistent
between display and mutation operations.

## Findings

### 1. Stage hunk always stages the full file

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** `/api/git/stage` ignores `hunkIndex` and always runs `git add` on entire file
- **Fix:** Implemented hunk-level staging with `git apply --cached` on extracted patch
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 2. Discard fails for untracked files

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** Discard uses `git checkout -- <file>` which fails for untracked files
- **Fix:** Detect untracked files and use `git clean -f -- <file>` instead
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 3. Discarding a hunk discards the entire file (data loss)

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** HIGH
- **File:** `vite.config.ts`
- **Finding:** `/api/git/discard` ignores `hunkIndex` — pressing discard drops ALL changes in file
- **Fix:** Implemented hunk-level discard with reverse patch via `git apply -R`
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 4. Diff endpoint omits committed changes when working tree has edits

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** HIGH
- **File:** `vite.config.ts`
- **Finding:** Default view falls back between `git diff` and `git diff main` — silently drops committed changes
- **Fix:** Always diff against base branch for default view
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

### 5. Untracked files return 404 from diff endpoint

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** `git diff` doesn't emit diffs for untracked paths — falls through to 404
- **Fix:** Detect untracked files and use `git diff --no-index` or `git add -N`
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`
