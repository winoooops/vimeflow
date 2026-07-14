---
id: git-operations
category: correctness
created: 2026-04-09
last_updated: 2026-07-14
ref_count: 13
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

### 15. Defensive guard's "value present" check rejects sentinel values the producer treats as absent

- **Source:** github-claude | PR #130 round 2 | 2026-05-02
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** Round-1 added a guard `hunkIndex !== undefined && base !== undefined && base !== null` to reject hunk-level mutations against branch-comparison views. But the consumer of `base` — `buildGitDiffArgs` — uses `baseBranch?.trim()` and falsy-checks the result, so empty strings and whitespace-only strings are treated as "no base" and produce a working-tree diff. The guard's stricter "any non-undefined non-null" check disagreed: a client sending `{ base: "" }` gets a 400 even though the server-side diff would have aligned with the working-tree mutation source. Same finding-class as the round-1 #14 issue itself — a contract that depends on alignment but isn't enforced consistently across the participating call sites.
- **Fix:** Tightened both guards to `typeof base === 'string' && base.trim() !== ''` so they share `buildGitDiffArgs`'s trim-then-falsy sentinel for "no base in effect". Empty/whitespace strings now consistently mean "no base"; only a meaningful branch-comparison value triggers the rejection. (A shared `isActiveBranch(b: unknown): b is string` helper would centralize this further; deferred as a small follow-up.)
- **Commit:** _(see git log for the round-2 fix commit)_

### 16. Rename/copy status drops worktree-modified half

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** `parse_git_status` treated all `R*`/`C*` porcelain entries as a single staged rename/copy, so `RM` and `CM` omitted the unstaged modification on the destination path.
- **Fix:** Preserve the staged rename/copy entry and add a second unstaged modified entry when the porcelain worktree status is `M`, with regression tests for `RM` and `CM`.
- **Commit:** _(see git log for the PR #214 review-fix commit)_

### 17. Rename/copy status drops worktree-deleted/copied half

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** The first `RM`/`CM` fix only emitted a second entry when the porcelain worktree status was `M`. `RD` still showed only the staged rename and omitted the unstaged delete on the destination path; `RC` similarly lost the worktree copy half.
- **Fix:** Dispatch rename/copy worktree status bytes into second unstaged entries for modified, deleted, added, renamed, and copied states. Added regression tests for `RD` and `RC`.
- **Commit:** _(see git log for the PR #214 rename worktree-status review-fix commit)_

### 18. Delete-style merge conflicts mapped to modified files

- **Source:** github-claude | PR #214 | 2026-05-17
- **Severity:** LOW
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** `parse_git_status` mapped every merge-conflict XY code to `Modified`/unstaged. Delete-style conflict codes (`DD`, `DU`, `UD`) can point at files missing from the worktree, so the diff sidebar showed a modified file and the viewer could try to open a path that no longer exists.
- **Fix:** Split `DD`/`DU`/`UD` into `Deleted`/unstaged while keeping non-delete conflict codes as `Modified`. Added regression coverage for the deleted conflict mapping and a control case for `UU`.
- **Commit:** _(see git log for the PR #214 merge-conflict status review-fix commit)_

### 19. Synthetic raw diffs missed new/deleted file sentinels

- **Source:** github-claude | PR #263 | 2026-05-25
- **Severity:** MEDIUM
- **File:** `src/features/diff/services/gitService.ts`
- **Finding:** Mock-synthesized `rawDiff` relied on optional path fields to carry `/dev/null`, so all-added or all-removed mock fixtures without those sentinels emitted ordinary `--- a/<path>` / `+++ b/<path>` headers that future `git apply` consumers would reject for new or deleted files.
- **Fix:** Infer synthetic added/deleted file status from explicit sentinels or all-added/all-removed hunks, emit the correct `/dev/null` side in `---` / `+++`, and include the matching `new file mode` / `deleted file mode` line. A later follow-up corrected the separate `diff --git` header convention; see finding 22.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. Rename probes must stay in the active diff scope

- **Source:** github-claude | PR #263 | 2026-05-25
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** The dev diff middleware ran its rename-source probe against the staged/unstaged scope even when the request was a `base=<branch>` comparison, allowing unrelated local rename state to change the path list for a branch-comparison diff.
- **Fix:** Skip the staged/unstaged rename probe when a normalized base branch is active so branch-comparison diffs use only the branch-scoped `git diff` arguments.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Git patch-format paths must be decoded before blob refs are built

- **Source:** github-codex-connector | PR #263 | 2026-05-25
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** `parse_git_diff` stored quoted `rename from` / `rename to` paths verbatim. Filenames containing tabs, newlines, quotes, or octal-escaped UTF-8 bytes therefore produced `oldPath` / `newPath` values like `"old\tname.txt"`, and later blob refs such as `HEAD:"old\tname.txt"` failed to resolve.
- **Fix:** Decode Git's patch-format quoted paths before storing rename/copy metadata, including common C escapes and octal byte escapes. Added parser-level coverage for quoted tabs/newlines and octal UTF-8, plus an end-to-end staged rename test proving `oldText` / `newText` resolve for a tab-containing filename.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. Synthetic `diff --git` headers must keep real paths for new/deleted files

- **Source:** github-claude | PR #263 follow-up | 2026-05-25
- **Severity:** MEDIUM
- **File:** `src/features/diff/services/gitService.ts`
- **Finding:** The mock `rawDiff` synthesizer used `a/dev/null` or `b/dev/null` in the leading `diff --git` header for added/deleted files. Git uses the real file path on both sides of that header and reserves `/dev/null` for the subsequent `---` / `+++` patch-side lines, so future `git apply` consumers would interpret `dev/null` as a literal path.
- **Fix:** Build `diff --git` sides from the real non-null path for added/deleted files while preserving `/dev/null` only in `---` / `+++`. Regression tests cover explicit `/dev/null` fixture metadata and inferred all-added/all-removed hunks.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. ensureWorktree: bot remote config skipped for reused worktrees

- **Source:** github-claude | PR #320 | 2026-05-31
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/run.mjs`
- **Finding:** The guard `if (bot && live && !existing)` skips HTTPS remote + credential helper setup for reused worktrees. A worktree created without a bot identity retains its original remote; the bot's `GH_TOKEN` is injected into env but git pushes over the old remote, breaking the author≠approver invariant.
- **Fix:** Remove the `!existing` guard so remote config runs unconditionally when `bot && live`.
- **Commit:** `7644ec4` + cycle-2 fix

### 24. Orphaned qa-pr-N worktrees accumulate after merge

- **Source:** github-claude | PR #320 round 1 | 2026-05-31
- **Severity:** LOW
- **File:** `scripts/qa-runner/watch.mjs`
- **Finding:** `ensureWorktree()` created `.claude/worktrees/qa-pr-N` per PR, but `approve()` never cleaned them up after squash-merge. Over many PRs the worktrees accumulated, holding git references that prevented GC.
- **Fix:** Added `git worktree remove --force` in `approve()\'s` success path, right after remote branch deletion.
- **Commit:** same commit as this entry

### 25. Fork PR branch deletion targets base repo instead of contributor repo

- **Source:** github-codex-connector | PR #320 round 3 | 2026-05-31
- **Severity:** P1 / HIGH
- **File:** `scripts/qa-runner/watch.mjs`
- **Finding:** `approve()` unconditionally deleted the remote branch via base-repo API after merge. For fork PRs, `headRefName` is the contributor's branch name; the deletion would remove a same-named base-repo branch instead.
- **Fix:** Fetched `isCrossRepository` from `gh pr view\' and gated the remote ref-delete on `!isCrossRepository`.
- **Commit:** same commit as this entry

### 26. Diff path computed relative to activeCwd instead of repo root

- **Source:** github-codex-connector | PR #444 round 1 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleFileViewDiff` computed `relativePath` from `activeCwd`, but the git backend normalizes status and diff to the repository top level. For terminals in a subdirectory, this produced a repo-root-relative path that missed the nested prefix and targeted the wrong file.
- **Fix:** Extended `git_status_inner` to return the repository root (`repoRoot`) and updated `useGitStatus` / `WorkspaceView` to compute diff paths relative to `repoRoot` when available, falling back to `activeCwd`.
- **Commit:** see `git blame` / `git log` on this line

### 27. Test git helper hid QA shim bypass rationale

- **Source:** github-claude | PR #647 round 4 | 2026-07-03
- **Severity:** LOW
- **File:** `crates/backend/src/git/mod.rs`
- **Finding:** The test helper filtered PATH entries containing
  `.qa-runner/bin` without documenting that the external review harness installs
  a push-intercepting git shim there.
- **Fix:** Added a focused comment explaining that fixture repositories need
  the real git binary so local push tests bypass the QA runner shim.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 28. Dev git status must preserve staged and unstaged halves

- **Source:** github-codex-connector | PR #694 round 1 | 2026-07-14
- **Severity:** P2 / MEDIUM
- **File:** `vite.config.ts`
- **Finding:** The Vite dev git-status middleware collapsed partially staged
  files into one `ChangedFile` row keyed only by path. Changelist review treats
  `(path, staged)` rows as the complete review scope, so a file with both index
  and working-tree edits only requested the staged diff and omitted the
  unstaged half.
- **Fix:** Mirrored the Rust status parser by emitting separate staged and
  unstaged rows for index-plus-working-tree states. Staged rows now read
  `git diff --cached --numstat`, while unstaged rows keep using the working-tree
  diff summary.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
