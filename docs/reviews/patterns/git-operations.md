---
id: git-operations
category: correctness
created: 2026-04-09
last_updated: 2026-05-02
ref_count: 4
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

### 11. `git diff --name-only` enumerates unstaged, not staged, files

- **Source:** github-claude | PR #112 round 1 | 2026-04-29
- **Severity:** MEDIUM
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** Step 6.5 of the github-review skill enumerated code-fix files via `while IFS= read -r f; do STAGED_FILES+=("$f"); done < <(git diff --name-only)`, then re-staged them with `git add`. But Step 4 already stages every code fix; by Step 6.5 those files are in the index, so `git diff --name-only` (which reports working-tree-vs-index) returns nothing for them — and instead picks up unrelated unstaged edits (debug files, half-finished features) and sweeps them into the review-fix commit. This directly violates the "no `git add -A`" safety rule.
- **Fix:** Remove the loop entirely. Code fixes are already staged from Step 4; only pattern files (`TOUCHED_PATTERN_FILES`) and the index file (`docs/reviews/CLAUDE.md`) need explicit staging in Step 6.5. Added a NOTE explaining why `git diff --name-only` is the wrong API here, plus a guard to skip `git add` when the array is empty.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. INDEX_TOUCHED flag missed when only existing-pattern rows update

- **Source:** github-codex-connector | PR #112 round 2 | 2026-04-29
- **Severity:** P2 / MEDIUM
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** Step 6.5 stages `docs/reviews/CLAUDE.md` only when `INDEX_TOUCHED=1`. The flag was set when Step 6.3 created a new pattern (a new row appended to the index) but NOT when Step 6.2 appended an entry to an existing pattern (the row's Findings count + Last Updated also change). Result: an index with stale Findings counts and dates after every cycle that only touched existing patterns — a small but progressively-misleading drift.
- **Fix:** Documented the invariant explicitly in `references/pattern-kb.md` § Step 6.4: "Set `INDEX_TOUCHED=1` whenever the index file is rewritten — Step 6.2 (appending to existing) AND Step 6.3 (creating new)." Updated SKILL.md § Step 6.5 to reference the invariant with a comment near the `[ "${INDEX_TOUCHED:-0}" -eq 1 ] && STAGED_FILES+=("docs/reviews/CLAUDE.md")` line.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. Displayed diff source diverged from hunk mutation source

- **Source:** github-codex | issue #22 | 2026-05-02
- **Severity:** HIGH
- **File:** `vite.config.ts`
- **Finding:** `/api/git/diff` displayed `git diff main -- <file>` while hunk stage/discard extracted patches from `git diff -- <file>`. Mixed committed plus uncommitted changes could shift hunk indexes and stage/discard the wrong patch.
- **Fix:** Default `/api/git/diff` to the same working-tree diff source used by hunk mutations, keep branch comparison behind explicit `base=<branch>` mode, and reject stale hunk indexes instead of falling back to whole-file operations.
- **Commit:** issue #22 fix PR

### 14. Display-mode parameter accepted on display endpoint but ignored by mutation endpoints

- **Source:** github-claude | PR #130 round 1 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `vite.config.ts` (`/api/git/stage`, `/api/git/discard`)
- **Finding:** PR #130 added a `base=<branch>` query parameter to the display endpoint so the UI could show a branch-comparison diff (e.g. PR review). The mutation endpoints (`/api/git/stage`, `/api/git/discard`) continued to extract patches from the working-tree diff via `buildGitDiffArgs({ ..., staged: false })`. In mixed committed + uncommitted states, the branch-comparison hunk list and the working-tree hunk list can differ, so a `hunkIndex` taken from the displayed (base=) view points at a different hunk in the patch source — the wrong patch gets applied. The PR's intent was that base= mode is "read-only", but there was no server-side enforcement. Same finding-class as #13 (displayed diff source diverged from hunk mutation source) — a UI-layer contract that depends on display+mutation alignment but isn't enforced server-side.
- **Fix:** Added an early-return 400 to both stage and discard handlers when `hunkIndex` is present AND the request body carries a non-null `base`. Error message documents the divergence and suggests staging/discarding the whole file instead. The UI can still surface base= views as read-only at the UI level; this guard exists purely as belt-and-braces so a misbehaving client (current or future) can't trip the mismatch silently.
- **Commit:** _(see git log for the round-1 fix commit)_
