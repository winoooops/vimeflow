---
id: git-operations
category: correctness
created: 2026-04-09
last_updated: 2026-04-12
ref_count: 1
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

### 6. Untracked files render blank diff pane (Tauri backend)

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** MEDIUM
- **File:** `src-tauri/src/git/mod.rs`, `src/features/diff/components/DiffPanelContent.tsx`
- **Finding:** `git diff -- <untracked>` exits 0 with empty stdout; DiffViewer renders zero hunks silently
- **Fix:** DiffPanelContent checks `status === 'untracked'` and shows placeholder
- **Commit:** `c1f0e68`

### 7. Rename metadata parsed then discarded

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** LOW
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** `parse_git_status` consumes second NUL token for renames but discards it. `old_path`/`new_path` always None in `FileDiff`.
- **Fix:** Deferred — tracked in issue #49

### 8. insertions/deletions stat counts absent from Tauri backend

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** LOW
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** `git status --porcelain=v1` doesn't emit stat counts. TS fields made optional; `+N/-N` badges suppressed.
- **Fix:** Deferred — tracked in issue #49. Needs `git diff --numstat`.

### 9. Subprocess timeout and cross-platform process kill

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** HIGH
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** `Command::output()` blocks indefinitely. Orphaned git processes leak Tokio thread pool slots.
- **Fix:** `run_git_with_timeout()` with `spawn()` + `wait_with_output()` + SIGKILL (unix) / taskkill (windows)
- **Commit:** `3bc4d23`

### 10. AM status inconsistent with MM rationale

- **Source:** claude-code-review | PR #47 | 2026-04-12
- **Severity:** LOW
- **File:** `src-tauri/src/git/mod.rs`
- **Finding:** MM defaults to staged=false but AM was staged=true; same rationale applies
- **Fix:** Changed AM to staged=false
- **Commit:** `c1f0e68`
