# VIM-327 Whole-Changelist Delegated Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Request-review dispatch from the single active file to the entire changelist (all file-strip entries: staged + unstaged + untracked), with findings anchoring across all reviewed files.

**Architecture:** Per-file `staged` moves into `ReviewedFile` (the request-level axis dies); a new `changelistSnapshot` service fetches N diffs via the existing `get_git_diff` IPC (concurrency-capped, TODO(VIM-341) for the batch endpoint); `useRequestReview` gains a scope + a keyed prefetch started at popover open (clipboard gesture); the prompt stays paths-only but groups by half; ingestion resolves dual-half paths by range-match with an unstaged tie-break. Two prerequisites: the Rust diff parser must stop mis-parsing combined (`@@@`) conflict diffs, and the vite dev middleware must gain status/diff parity.

**Tech Stack:** React 19 + TypeScript (vitest/jsdom/testing-library), Rust sidecar (`crates/backend`), vite dev middleware (node).

**Spec:** `docs/superpowers/specs/2026-07-13-vim-327-changelist-review-design.md` (codex-reviewed). Read it first; section numbers below refer to it.

---

## Executor rules (apply to every task)

- Worktree: `/Users/winoooops/projects/vimeflow/.claude/worktrees/vim-327-changelist-review`, branch `feature/vim-327`. Never work in the main checkout.
- NEVER commit with `--no-verify`. If the pre-commit hook is KILLED (OOM), run `npx lint-staged --concurrent false` and commit again.
- Before every commit run, scoped to your changes: `npx prettier --check <files>` + `npx eslint <files>` for TS/TSX/MD files, `cargo fmt --manifest-path crates/backend/Cargo.toml -- --check` for Rust, and `npm run type-check`. Do not rely on the hook alone. (Prettier has no Rust parser — never point it at `.rs` files.)
- Run the full test file you touched, not just the new test: `npx vitest run <file>`.
- Commit trailers: these implementation commits are not codex-assisted — do NOT add the `Co-Authored-By: codex` trailer (`rules/common/git-workflow.md` scopes it to commits codex participated in).
- `test()` not `it()`; no semicolons; single quotes; explicit return types on exported functions; no hardcoded colors outside `src/theme/**`; cspell is enforced (add genuinely new words to `cspell.config.yaml` only if needed).
- Known pre-existing local failures (do NOT chase): ~11 Rust tests on macOS (`/bin/true`, `/proc`), `editorFileLifecycleStatus` home-path casing, `src/theme/service.test.ts` StorageEvent jsdom flake.
- `cargo test` regenerates `src/bindings/*.ts` unformatted — bindings are gitignored, so ignore the noise; never commit `src/bindings`.

## File map

| File                                                            | Change                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `crates/backend/src/git/mod.rs`                                 | Task 1: combined-diff guard in `parse_git_diff` + tests                                                                   |
| `vite.config.ts`                                                | Task 2: dev middleware parity (untracked status value, zero-hunk empty untracked, uncommitted-only status scope)          |
| `src/features/diff/services/pendingReviewRequests.ts` (+test)   | Task 3: `ReviewedFile.staged`, `buildDiffSnapshot(fileDiff, staged): ReviewedFile`, `PendingReviewRequest` drops `staged` |
| `src/features/diff/hooks/useRequestReview.ts` (+test)           | Task 3 (mechanical adaptation), Task 6 (scope, async arm, prefetch)                                                       |
| `src/features/diff/hooks/useAgentReview.ts` (+test)             | Task 3 (mechanical adaptation), Task 7 (`resolveFindingEntry`)                                                            |
| `src/features/diff/services/feedbackDispatch.ts` (+test)        | Task 4: grouped prompt, signature changes, `ReviewRequestFile.untracked`                                                  |
| `src/features/diff/services/changelistSnapshot.ts` (NEW, +test) | Task 5: concurrency pool + snapshot/request pairing                                                                       |
| `src/features/diff/components/RequestReviewPopover.tsx` (+test) | Task 8: SegmentedControl scope + `f`/`a` hotkeys                                                                          |
| `src/features/diff/components/Notifier.tsx` (+test)             | Task 8: `RequestReviewState.scopeControl` pass-through                                                                    |
| `src/features/diff/Panel.tsx` (+`Panel.test.tsx`)               | Task 9: wiring (changedFiles, fetchFileDiff, statusRevision, repoRoot fallback, per-scope scopeLabel)                     |
| `CHANGELOG.md`, `CHANGELOG.zh-CN.md`                            | Task 10: entries                                                                                                          |

---

### Task 1: Rust — combined-diff guard in `parse_git_diff` (spec §2 prerequisite)

`git diff` on an unmerged path (`UU` etc.) emits the combined format (`diff --cc`, `@@@` headers). `parse_git_diff` (`crates/backend/src/git/mod.rs:908`) matches `line.starts_with("@@")`, which `@@@` satisfies, so a second-parent range is parsed as the new-file range — garbage anchors. Fix: detect combined diffs and emit **zero hunks** (file-level degrade downstream).

**Files:**

- Modify: `crates/backend/src/git/mod.rs` (`parse_git_diff`, ~line 908; tests near line 2364)

- [ ] **Step 1: Write the failing tests** (in the existing `#[cfg(test)]` module that already calls `parse_git_diff` directly, near `test_parse_git_diff…` tests at ~line 2364):

```rust
#[test]
fn test_parse_combined_diff_emits_zero_hunks() {
    // `git diff` output for an unmerged (UU) path — combined format.
    let diff = "diff --cc src/conflicted.rs\n\
index 1111111,2222222..0000000\n\
--- a/src/conflicted.rs\n\
+++ b/src/conflicted.rs\n\
@@@ -1,4 -1,4 +1,8 @@@\n\
++<<<<<<< HEAD\n\
 +fn ours() {}\n\
++=======\n\
+ fn theirs() {}\n\
++>>>>>>> feature\n\
  fn shared() {}\n";

    let file_diff = parse_git_diff(diff, "src/conflicted.rs");

    assert_eq!(file_diff.file_path, "src/conflicted.rs");
    assert!(
        file_diff.hunks.is_empty(),
        "combined diffs must not be parsed as two-way hunks, got {:?}",
        file_diff.hunks
    );
}

#[test]
fn test_parse_combined_header_without_cc_line_emits_zero_hunks() {
    // Defensive: an `@@@` hunk header alone (no `diff --cc` line) must also bail.
    let diff = "--- a/x.txt\n+++ b/x.txt\n@@@ -1,2 -1,2 +1,3 @@@\n  line\n";

    let file_diff = parse_git_diff(diff, "x.txt");

    assert!(file_diff.hunks.is_empty());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path crates/backend/Cargo.toml test_parse_combined -- --nocapture`
Expected: both FAIL (hunks non-empty — the `@@@` header was parsed as a two-way `@@` header).

- [ ] **Step 3: Implement the guard.** In `parse_git_diff`: add `let mut is_combined = false;` next to the existing locals. Insert a new branch **before** the existing `line.starts_with("@@")` branch (order matters — `@@@` also starts with `@@`):

```rust
} else if line.starts_with("@@@") || line.starts_with("diff --cc") || line.starts_with("diff --combined") {
    // Combined diff (merge conflict): parent ranges don't fit the two-way
    // FileDiff model — emit zero hunks so findings degrade to file-level
    // instead of anchoring against garbage ranges (VIM-327 spec §2).
    is_combined = true;
    current_hunk = None;
} else if line.starts_with("@@") {
```

At the end of the function, before constructing the returned `FileDiff`, clear any hunks accumulated before the marker line was seen:

```rust
if is_combined {
    hunks.clear();
}
```

(Keep `file_path`/`old_path`/`new_path` handling untouched.)

- [ ] **Step 4: Run to verify pass, plus the surrounding parser tests and Rust formatting**

Run: `cargo test --manifest-path crates/backend/Cargo.toml parse_git_diff && cargo test --manifest-path crates/backend/Cargo.toml test_parse_combined && cargo fmt --manifest-path crates/backend/Cargo.toml -- --check`
Expected: PASS + clean fmt (macOS-known-failing tests excepted — they're in other modules).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/git/mod.rs
git commit -m "fix(git): parse combined conflict diffs as zero-hunk files"
```

---

### Task 2: vite dev middleware parity (spec §3 prerequisite)

Two dev-only gaps abort a changelist review in browser/dev mode: (1) untracked files are reported as status `'A'`, so the frontend passes `untracked: false`, which **disables** the middleware's untracked fallback (`!diff && untracked !== false`, `vite.config.ts:~489`) → 404; (2) the status endpoint reports committed branch-vs-main files as `staged: true` (`vite.config.ts:~353-381`) — entries no prompt-named basis can serve (`git diff --cached` is empty for them), so per spec §3 the branch-vs-main section **stops being emitted by default** and stays reachable only behind an explicit `?base=<branch>` query param (the frontend never sends one). Invariant (spec §3): **every entry the status endpoint reports must be fetchable from the diff endpoint on the axis it claims.**

No vitest coverage exists for `vite.config.ts` middleware (and `npm run type-check` does not cover it) — verification is the runnable dev-server script in Step 3. Keep the changes minimal.

**Files:**

- Modify: `vite.config.ts` (status handler ~line 340-430; diff handler ~line 436-523)

- [ ] **Step 1: Status endpoint — emit `'untracked'`.** In the working-tree status loop (~line 400-414), the mapping currently folds `?` into `'A'`. Change the status type unions used in this file from `'M' | 'A' | 'D' | 'U'` to `'M' | 'A' | 'D' | 'U' | 'untracked'` and map index/working-dir `'?'` to `'untracked'` **before** the `'A'` check:

```ts
let gitStatus: 'M' | 'A' | 'D' | 'U' | 'untracked'

if (file.index === '?' || file.working_dir === '?') {
  gitStatus = 'untracked'
} else if (file.index === 'D' || file.working_dir === 'D') {
  gitStatus = 'D'
} else if (file.index === 'A' || file.working_dir === 'A') {
  gitStatus = 'A'
} else if (file.index === 'M' || file.working_dir === 'M') {
  gitStatus = 'M'
} else {
  gitStatus = 'U'
}
```

(The desktop serde value is lowercase `'untracked'` — `src/features/diff/types/index.ts:9` documents the contract.)

- [ ] **Step 2: Status endpoint — gate the branch-vs-main section; diff endpoint — zero-hunk empty untracked.**

  a. **Gate the branch section.** Wrap the "files changed on this branch vs base" block (`const branchDiffSummary = await git.diffSummary([baseBranch])` and its loop, ~line 353-381) in an explicit opt-in — committed work is not part of the uncommitted changelist and no prompt-named basis serves it:

```ts
// Branch-vs-main entries are committed work — not fetchable on any axis the
// review prompt names (VIM-327 spec §3). Emit them only when explicitly
// requested; the app frontend never sends `base`.
const explicitBase = url.searchParams.get('base')

if (explicitBase !== null) {
  const branchDiffSummary = await git.diffSummary([
    normalizeBranch(explicitBase),
  ])
  // …existing loop unchanged…
}
```

(Reuse whatever branch-name sanitizer the file already applies to `base`; if none exists for this handler, validate with the same pattern the diff handler uses. Delete the `?? 'main'` default.)

b. **Empty untracked file → zero-hunk 200, not 404.** The untracked fallback (`git diff --no-index -- /dev/null <path>`) produces empty stdout for an empty file. Where `if (!diff) { 404 }` currently sits, return an empty-diff success when the untracked fallback path was taken (or requested) but produced no text:

```ts
if (!diff && (untracked === true || usedUntrackedFallback)) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      fileDiff: { filePath: safePath, hunks: [] },
      oldText: '',
      newText: '',
      rawDiff: '',
      repoRoot,
    })
  )

  return
}
```

Keep the final `if (!diff) { 404 }` for genuinely unknown files.

- [ ] **Step 3: Verify against the dev server** — runnable script (from the worktree root; plain `npx vite` serves the middleware, no display needed):

```bash
printf 'hello dev parity\n' > scratch-vim327.txt
: > scratch-vim327-empty.txt
npx vite --port 5197 > /tmp/vim327-vite.log 2>&1 &
VITE_PID=$!
sleep 4
# 1) untracked status value (expect: "untracked", twice)
curl -s 'http://localhost:5197/api/git/status' | python3 -c 'import json,sys; fs=json.load(sys.stdin)["files"]; print([f["status"] for f in fs if f["path"].startswith("scratch-vim327")])'
# 2) untracked diff serves hunks (expect: hunk count >= 1)
curl -s 'http://localhost:5197/api/git/diff?file=scratch-vim327.txt&staged=false&untracked=true' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["fileDiff"]["hunks"]))'
# 3) EMPTY untracked file → 200 zero-hunk, not 404 (expect: 0)
curl -s 'http://localhost:5197/api/git/diff?file=scratch-vim327-empty.txt&staged=false&untracked=true' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["fileDiff"]["hunks"]))'
# 4) no committed branch-vs-main entries by default (expect: 0 — this branch has committed docs)
curl -s 'http://localhost:5197/api/git/status' | python3 -c 'import json,sys; fs=json.load(sys.stdin)["files"]; print(sum(1 for f in fs if f["path"].startswith("docs/")))'
kill $VITE_PID
rm scratch-vim327.txt scratch-vim327-empty.txt
```

If the execution environment cannot run a dev server, say so explicitly in the commit body — there is no compiler safety net for `vite.config.ts`.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "fix(dev): git middleware untracked parity and uncommitted-only status scope"
```

---

### Task 3: Snapshot model — per-file `staged` (spec §2)

**Files:**

- Modify: `src/features/diff/services/pendingReviewRequests.ts` (+ `pendingReviewRequests.test.ts`)
- Modify (mechanical): `src/features/diff/hooks/useRequestReview.ts`, `src/features/diff/hooks/useAgentReview.ts` (+ their tests' fixtures)

- [ ] **Step 1: Write/adjust failing tests** in `pendingReviewRequests.test.ts`:

```ts
test('buildDiffSnapshot returns a single ReviewedFile carrying the staged axis', () => {
  const fileDiff: FileDiff = {
    filePath: 'src/a.ts',
    hunks: [
      {
        id: 'hunk-1-1',
        header: '@@ -1,2 +1,3 @@',
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [],
      },
    ],
  }

  const entry = buildDiffSnapshot(fileDiff, true)

  expect(entry).toEqual({
    path: 'src/a.ts',
    staged: true,
    additions: [{ start: 1, end: 3 }],
    deletions: [{ start: 1, end: 2 }],
  })
})
```

Also update every existing fixture that builds a `ReviewedFile`, `ReviewRequestFile`, or `PendingReviewRequest` — in this file AND in `useAgentReview.test.ts`, `useRequestReview.test.ts`, and `feedbackDispatch.test.ts` (`ReviewRequestFile extends ReviewedFile`, so its literals need `staged` too, in THIS task, or `npm run type-check` fails at this commit boundary): `ReviewedFile`-shaped objects gain `staged`, `PendingReviewRequest` literals lose their top-level `staged`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/services/pendingReviewRequests.test.ts`
Expected: FAIL (signature/type mismatch).

- [ ] **Step 3: Implement the model change** in `pendingReviewRequests.ts`:

```ts
/** One reviewed file's hunk line ranges, per side, captured at dispatch. */
export interface ReviewedFile {
  path: string
  /** Which half (staged index vs working tree) this entry snapshots. */
  staged: boolean
  additions: HunkRange[]
  deletions: HunkRange[]
}

export const buildDiffSnapshot = (
  fileDiff: FileDiff,
  staged: boolean
): ReviewedFile => ({
  path: fileDiff.filePath,
  staged,
  additions: fileDiff.hunks
    .filter((hunk) => hunk.newLines > 0)
    .map((hunk) => ({
      start: hunk.newStart,
      end: hunk.newStart + hunk.newLines - 1,
    })),
  deletions: fileDiff.hunks
    .filter((hunk) => hunk.oldLines > 0)
    .map((hunk) => ({
      start: hunk.oldStart,
      end: hunk.oldStart + hunk.oldLines - 1,
    })),
})
```

Remove `staged: boolean` from `PendingReviewRequest` (delete the field and its doc comment at ~line 62-63). Update the `buildDiffSnapshot` doc comment: it returns ONE entry; callers assemble the list.

- [ ] **Step 4: Mechanical consumer adaptation** (keeps the repo compiling; behavior identical for single-file):
  - `useRequestReview.ts` `arm()`: `const files = [buildDiffSnapshot(fileDiff, staged)]` and delete `staged,` from the `setPendingReviewRequest({...})` literal.
  - `useAgentReview.ts` `handleReview`: change the destructure at line 148 to `const { ownerKey, cwd, diffSnapshot, nonce } = request`, and replace the two uses of `staged` (lines 204 and 211) with `file.staged` (the entry `findFile` matched). Dual-half resolution comes in Task 7 — first-match stays for now.

- [ ] **Step 5: Run the touched test files**

Run: `npx vitest run src/features/diff/services/pendingReviewRequests.test.ts src/features/diff/services/feedbackDispatch.test.ts src/features/diff/hooks/useRequestReview.test.ts src/features/diff/hooks/useAgentReview.test.ts`
Expected: PASS. Then `npm run type-check` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/services/pendingReviewRequests.ts src/features/diff/services/pendingReviewRequests.test.ts src/features/diff/services/feedbackDispatch.test.ts src/features/diff/hooks/useRequestReview.ts src/features/diff/hooks/useAgentReview.ts src/features/diff/hooks/useAgentReview.test.ts src/features/diff/hooks/useRequestReview.test.ts
git commit -m "refactor(diff): move review-snapshot staged axis onto ReviewedFile"
```

---

### Task 4: Grouped paths-only prompt (spec §4)

**Files:**

- Modify: `src/features/diff/services/feedbackDispatch.ts` (+ `feedbackDispatch.test.ts`)
- Touch call site: `src/features/diff/hooks/useRequestReview.ts`

- [ ] **Step 1: Write failing tests** in `feedbackDispatch.test.ts`:

```ts
test('formatReviewRequest groups entries by half and annotates untracked', () => {
  const files: ReviewRequestFile[] = [
    {
      path: 'src/a.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
    {
      path: 'src/new.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/new.ts',
      untracked: true,
    },
    {
      path: 'src/a.ts',
      staged: true,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
    {
      path: 'src/c.ts',
      staged: true,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/c.ts',
    },
  ]

  const prompt = formatReviewRequest(files, 'n0nce1')

  expect(prompt).toContain('> Delegate a code review of these 4 changes:')
  const unstagedIndex = prompt.indexOf('> unstaged diff (`git diff`):')
  const stagedIndex = prompt.indexOf('> staged diff (`git diff --cached`):')
  expect(unstagedIndex).toBeGreaterThan(-1)
  expect(stagedIndex).toBeGreaterThan(unstagedIndex)
  expect(prompt).toContain(
    '> ─ src/new.ts (/repo/src/new.ts) (untracked — not in git diff; read the file, all lines are additions)'
  )
  // contract block untouched
  expect(prompt).toContain('<<<VIMEFLOW_REVIEW')
  expect(prompt).toContain('"nonce":"n0nce1"')
})

test('formatReviewRequest with a single half emits only that group', () => {
  const files: ReviewRequestFile[] = [
    {
      path: 'src/a.ts',
      staged: false,
      additions: [],
      deletions: [],
      promptPath: '/repo/src/a.ts',
    },
  ]

  const prompt = formatReviewRequest(files, 'n0nce2')

  expect(prompt).toContain('> Delegate a code review of these 1 change:')
  expect(prompt).toContain('> unstaged diff (`git diff`):')
  expect(prompt).not.toContain('staged diff (`git diff --cached`)')
})
```

Update existing `formatReviewRequest`/`dispatchReviewRequest` tests in this file for the new signatures (drop the `staged` argument; fixtures gain `staged` per file).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/services/feedbackDispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** in `feedbackDispatch.ts` (replacing the current `formatReviewRequest` at ~line 196 and `dispatchReviewRequest` at ~line 227):

```ts
export interface ReviewRequestFile extends ReviewedFile {
  promptPath?: string
  /** Prompt-side only: the reviewer must read the file directly (no git diff). */
  untracked?: boolean
}

const reviewRequestLine = (file: ReviewRequestFile): string => {
  const path = stripControls(file.path)
  const promptPath =
    file.promptPath === undefined ? '' : stripControls(file.promptPath)
  const base =
    promptPath.length > 0 ? `> ─ ${path} (${promptPath})` : `> ─ ${path}`

  return file.untracked === true
    ? `${base} (untracked — not in git diff; read the file, all lines are additions)`
    : base
}

export const formatReviewRequest = (
  files: ReviewRequestFile[],
  nonce: string
): string => {
  const unstaged = files.filter((file) => !file.staged)
  const staged = files.filter((file) => file.staged)

  const groups = [
    ...(unstaged.length > 0
      ? ['> unstaged diff (`git diff`):', ...unstaged.map(reviewRequestLine)]
      : []),
    ...(staged.length > 0
      ? [
          '> staged diff (`git diff --cached`):',
          ...staged.map(reviewRequestLine),
        ]
      : []),
  ]

  return [
    `> Delegate a code review of these ${files.length} change${files.length === 1 ? '' : 's'}:`,
    ...groups,
    '>',
    '> Anchor each finding with diff-side line numbers: "additions" uses new-file lines, "deletions" uses old-file lines.',
    '> In the JSON block, use the repo-relative path before the parentheses as each finding path.',
    '> category is one of: "bug", "suggestion", "change", "question". scope is "line", "range", or "file".',
    '> When done, end your reply with this exact block — echo the nonce verbatim and self-report the reviewer name.',
    '> Also give a one-line overview in your normal reply (not in the block), especially if there is little to report.',
    '> <<<VIMEFLOW_REVIEW',
    `> {"v":1,"nonce":"${nonce}","reviewer":"<your name>","findings":[{"path":"<file>","scope":"line","side":"additions","line":1,"category":"bug","text":"..."}]}`,
    '> VIMEFLOW_REVIEW>>>',
  ].join('\n')
}

export const dispatchReviewRequest = async (
  ptyId: string,
  files: ReviewRequestFile[],
  nonce: string,
  writePty: (ptyId: string, data: string) => Promise<void>
): Promise<void> => {
  const formatted = formatReviewRequest(files, nonce)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\r`

  await writePty(ptyId, payload)
}
```

Update the two call sites in `useRequestReview.ts` (`dispatchReviewRequest(pane.ptyId, armed.requestFiles, armed.nonce, writePty)` and `formatReviewRequest(armed.requestFiles, armed.nonce)`) — drop `staged` from both dependency arrays too.

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/services/feedbackDispatch.test.ts src/features/diff/hooks/useRequestReview.test.ts && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/feedbackDispatch.ts src/features/diff/services/feedbackDispatch.test.ts src/features/diff/hooks/useRequestReview.ts src/features/diff/hooks/useRequestReview.test.ts
git commit -m "feat(diff): group review-request prompt by staged half with untracked annotation"
```

---

### Task 5: `changelistSnapshot` service (spec §3)

**Files:**

- Create: `src/features/diff/services/changelistSnapshot.ts`
- Create: `src/features/diff/services/changelistSnapshot.test.ts`

- [ ] **Step 1: Write failing tests** (`changelistSnapshot.test.ts`):

```ts
import { describe, expect, test, vi } from 'vitest'
import { fetchChangelistSnapshot } from './changelistSnapshot'
import type { ChangedFile, FileDiff } from '../types'

const entry = (
  path: string,
  staged: boolean,
  status: ChangedFile['status'] = 'modified'
): ChangedFile => ({
  path,
  status,
  staged,
})

const diffOf = (path: string): FileDiff => ({
  filePath: path,
  hunks: [
    {
      id: 'hunk-1-1',
      header: '@@ -1,1 +1,2 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [],
    },
  ],
})

describe('fetchChangelistSnapshot', () => {
  test('pairs a snapshot entry and a request file per ChangedFile', async () => {
    const fetchFileDiff = vi.fn(
      (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
    )

    const result = await fetchChangelistSnapshot(
      [
        entry('src/a.ts', false),
        entry('src/a.ts', true),
        entry('new.ts', false, 'untracked'),
      ],
      fetchFileDiff,
      '/repo/'
    )

    expect(result.files).toHaveLength(3)
    expect(result.files[0]).toMatchObject({ path: 'src/a.ts', staged: false })
    expect(result.files[1]).toMatchObject({ path: 'src/a.ts', staged: true })
    expect(result.requestFiles[2]).toMatchObject({
      path: 'new.ts',
      untracked: true,
      promptPath: '/repo/new.ts',
    })
    expect(fetchFileDiff).toHaveBeenCalledWith('new.ts', false, true)
  })

  test('rejects atomically when any fetch fails', async () => {
    const fetchFileDiff = vi.fn(
      (path: string): Promise<FileDiff> =>
        path === 'bad.ts'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(diffOf(path))
    )

    await expect(
      fetchChangelistSnapshot(
        [entry('a.ts', false), entry('bad.ts', false)],
        fetchFileDiff,
        ''
      )
    ).rejects.toThrow('boom')
  })

  test('caps concurrency at 8', async () => {
    let active = 0
    let maxActive = 0
    const fetchFileDiff = vi.fn(async (path: string): Promise<FileDiff> => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1

      return diffOf(path)
    })

    const entries = Array.from({ length: 20 }, (_, i) =>
      entry(`f${i}.ts`, false)
    )
    await fetchChangelistSnapshot(entries, fetchFileDiff, '')

    expect(maxActive).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/services/changelistSnapshot.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`changelistSnapshot.ts`):

```ts
/**
 * Builds the whole-changelist review snapshot (VIM-327): for every file-strip
 * entry, fetch its parsed diff and pair the placement entry (hunk ranges) with
 * its prompt-side request file. Paths-only prompt — diff text is never sent.
 */
import type { ChangedFile, FileDiff } from '../types'
import type { ReviewRequestFile } from './feedbackDispatch'
import { buildDiffSnapshot, type ReviewedFile } from './pendingReviewRequests'

export interface ChangelistSnapshot {
  files: ReviewedFile[]
  requestFiles: ReviewRequestFile[]
}

export type FetchFileDiff = (
  path: string,
  staged: boolean,
  untracked: boolean
) => Promise<FileDiff>

const SNAPSHOT_CONCURRENCY = 8

// ponytail: minimal promise pool; results keep input order.
const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )

  return results
}

export const fetchChangelistSnapshot = async (
  entries: readonly ChangedFile[],
  fetchFileDiff: FetchFileDiff,
  repoRoot: string
): Promise<ChangelistSnapshot> => {
  const normalizedRoot = repoRoot.replace(/[\\/]+$/, '')

  // TODO(VIM-341): replace N get_git_diff round-trips with the batch
  // hunk-range command — each response ships full file texts we discard.
  const paired = await mapWithConcurrency(
    entries,
    SNAPSHOT_CONCURRENCY,
    async (entry) => {
      const untracked = entry.status === 'untracked'
      const fileDiff = await fetchFileDiff(entry.path, entry.staged, untracked)
      const snapshot = buildDiffSnapshot(fileDiff, entry.staged)

      const requestFile: ReviewRequestFile = {
        ...snapshot,
        ...(normalizedRoot.length > 0
          ? { promptPath: `${normalizedRoot}/${snapshot.path}` }
          : {}),
        ...(untracked ? { untracked: true } : {}),
      }

      return { snapshot, requestFile }
    }
  )

  return {
    files: paired.map((pair) => pair.snapshot),
    requestFiles: paired.map((pair) => pair.requestFile),
  }
}
```

Note: `mapWithConcurrency` rejects on first failure while other workers may still settle — that is the atomic-abort contract (spec §3); no partial snapshot escapes because the whole promise rejects.

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/services/changelistSnapshot.test.ts && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/changelistSnapshot.ts src/features/diff/services/changelistSnapshot.test.ts
git commit -m "feat(diff): changelist snapshot service with capped parallel diff fetch"
```

---

### Task 6: `useRequestReview` — scope, async arm, keyed prefetch (spec §3, §5)

**Files:**

- Modify: `src/features/diff/hooks/useRequestReview.ts` (+ `useRequestReview.test.ts`)

- [ ] **Step 1: Write failing tests** (add to `useRequestReview.test.ts`; follow the file's existing `renderHook` harness and mock style):

```ts
// NOTE: this test file already mocks the feedbackDispatch module — its
// dispatchReviewRequest mock is a resolved no-op. Assert on the MOCK's
// arguments, not on writePty (which the mock never calls); prompt CONTENT
// is Task 4's formatReviewRequest tests' job.
const changedFiles: ChangedFile[] = [
  { path: 'src/a.ts', status: 'modified', staged: false },
  { path: 'src/a.ts', status: 'modified', staged: true },
  { path: 'new.ts', status: 'untracked', staged: false },
]

test('changelist delegate arms all entries under one nonce and dispatches all request files', async () => {
  const fetchFileDiff = vi.fn(
    (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
  )

  const { result } = renderHook(() =>
    useRequestReview({
      fileDiff: diffOf('src/a.ts'),
      ownerKey: 'session:pane',
      cwd: '/repo',
      staged: false,
      repoRoot: '/repo',
      changedFiles,
      statusRevision: 1,
      fetchFileDiff,
      writePty: vi.fn((): Promise<void> => Promise.resolve()),
      notify: vi.fn(),
    })
  )

  act(() => result.current.setScope('changelist'))
  await act(async () => {
    result.current.requestReview({
      ptyId: 'pty-1',
      tabName: 't',
      agentLabel: 'claude',
    } as PaneCandidate)
    await vi.waitFor(() => expect(dispatchReviewRequest).toHaveBeenCalled())
  })

  const mocked = vi.mocked(dispatchReviewRequest)
  const [ptyId, requestFiles, nonce] = mocked.mock.calls[0]
  expect(ptyId).toBe('pty-1')
  expect(requestFiles).toHaveLength(3)
  expect(requestFiles[2]).toMatchObject({
    path: 'new.ts',
    staged: false,
    untracked: true,
    promptPath: '/repo/new.ts',
  })

  const request = getPendingReviewRequest(nonce)
  expect(request?.diffSnapshot).toHaveLength(3)
  expect(request?.diffSnapshot[1]).toMatchObject({
    path: 'src/a.ts',
    staged: true,
  })
})

test('changelist arm failure is atomic: no request stored, notify fired', async () => {
  const notify = vi.fn()
  const fetchFileDiff = vi.fn(
    (): Promise<FileDiff> => Promise.reject(new Error('boom'))
  )
  // render with changedFiles + notify, scope changelist, then requestReview(...)
  // assert writePty NOT called, notify called with
  // 'Could not snapshot the changelist; review request not sent.'
  // and no pending request was added for any nonce minted during the test.
})

test('prefetch is keyed: openPopover starts one fetch, arm reuses it; stale cwd forces a fresh fetch', async () => {
  const fetchFileDiff = vi.fn(
    (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
  )
  const { result, rerender } = renderHook((props) => useRequestReview(props), {
    initialProps: baseProps,
  })

  act(() => result.current.openPopover())
  await vi.waitFor(() =>
    expect(fetchFileDiff).toHaveBeenCalledTimes(changedFiles.length)
  )

  // same key: arm must not refetch
  await act(async () => {
    result.current.copyReviewRequest()
    await Promise.resolve()
  })
  expect(fetchFileDiff).toHaveBeenCalledTimes(changedFiles.length)

  // key change (cwd swap): arm refetches
  rerender({ ...baseProps, cwd: '/other-repo' })
  await act(async () => {
    result.current.requestReview(paneCandidate)
    await vi.waitFor(() =>
      expect(fetchFileDiff.mock.calls.length).toBeGreaterThan(
        changedFiles.length
      )
    )
  })
})

test('canRequest is true with a populated strip and no active fileDiff, and scope is forced to changelist', () => {
  const { result } = renderHook(() =>
    useRequestReview({ ...baseProps, fileDiff: undefined })
  )

  expect(result.current.canRequest).toBe(true)
  expect(result.current.scope).toBe('changelist')
})
```

(Flesh the second/third tests out fully in the test file — the harness pieces `diffOf`, `baseProps`, `paneCandidate` are shared module-level helpers; `getPendingReviewRequest` imports from the service. Clear the module-singleton store between tests with `clearPendingReviewRequest` on any nonce you observed, or reset via `prunePendingReviewRequestOwners(new Set())`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/hooks/useRequestReview.test.ts`
Expected: FAIL (no `setScope`, sync arm, missing options).

- [ ] **Step 3: Implement.** New/changed parts of `useRequestReview.ts`:

```ts
export type ReviewScope = 'file' | 'changelist'

export interface UseRequestReviewOptions {
  fileDiff: FileDiff | undefined
  ownerKey: string | undefined
  cwd: string
  /** The active row's staged axis — the single-file scope inherits it. */
  staged: boolean
  /** All file-strip entries; the changelist scope reviews exactly this list. */
  changedFiles?: readonly ChangedFile[]
  /** useGitStatus revision — part of the prefetch key (spec §3). */
  statusRevision?: number
  /** Fetch one file's parsed diff (Panel wraps gitService.getDiff). */
  fetchFileDiff?: FetchFileDiff
  writePty?: (ptyId: string, data: string) => Promise<void>
  focusTerminal?: () => void
  notify: (message: string) => void
  repoRoot?: string
}

export interface RequestReviewController {
  open: boolean
  canRequest: boolean
  scope: ReviewScope
  setScope: (scope: ReviewScope) => void
  /** Entry count backing the "All changes (N)" label; 0 hides the choice. */
  changeCount: number
  openPopover: () => void
  closePopover: () => void
  requestReview: (pane: PaneCandidate) => void
  copyReviewRequest: () => void
}
```

Controller internals:

```ts
const entries = changedFiles ?? []
const changeCount = entries.length

const canRequestFile = fileDiff !== undefined
const canRequestChangelist = changeCount > 0 && fetchFileDiff !== undefined
const canRequest =
  ownerKey !== undefined && (canRequestFile || canRequestChangelist)

// Scope state with forcing (spec §5): no active diff → changelist; empty
// strip → file. User choice wins otherwise; default = changelist when >1
// entry. openPopover resets the choice to null so a stale selection never
// survives strip/file transitions between opens (spec §5).
const [scopeChoice, setScopeChoice] = useState<ReviewScope | null>(null)
const defaultScope: ReviewScope = !canRequestFile
  ? 'changelist'
  : !canRequestChangelist
    ? 'file'
    : changeCount > 1
      ? 'changelist'
      : 'file'
const scope: ReviewScope = !canRequestFile
  ? 'changelist'
  : !canRequestChangelist
    ? 'file'
    : (scopeChoice ?? defaultScope)

// Keyed prefetch (spec §3): one in-flight promise, .catch attached at creation.
const prefetchRef = useRef<{
  key: string
  promise: Promise<ChangelistSnapshot>
  settled: boolean
} | null>(null)

const prefetchKey = `${cwd}\u0000${statusRevision ?? 0}`

const startPrefetch = useCallback((): void => {
  if (!canRequestChangelist || fetchFileDiff === undefined) {
    return
  }
  const existing = prefetchRef.current
  if (existing !== null && existing.key === prefetchKey && !existing.settled) {
    return
  }
  const holder = {
    key: prefetchKey,
    promise: fetchChangelistSnapshot(entries, fetchFileDiff, repoRoot ?? ''),
    settled: false,
  }
  // Swallow here so a discarded prefetch never surfaces as unhandled; the
  // rejection re-surfaces when arm() awaits the same promise. Chain ends in
  // catch for the promise/catch-or-return lint gate; void for no-floating.
  void holder.promise
    .then((): void => {
      holder.settled = true
    })
    .catch((): void => {
      holder.settled = true
    })
  prefetchRef.current = holder
}, [canRequestChangelist, fetchFileDiff, prefetchKey, entries, repoRoot])
```

`arm` becomes async and scoped (single-file branch is the existing body wrapped in the array assembly from Task 3):

```ts
const arm = useCallback(
  async (
    armScope: ReviewScope
  ): Promise<{
    nonce: string
    requestFiles: ReviewRequestFile[]
  } | null> => {
    if (ownerKey === undefined) {
      return null
    }

    if (armScope === 'file') {
      if (fileDiff === undefined) {
        return null
      }
      // …existing single-file body: files = [buildDiffSnapshot(fileDiff, staged)],
      // promptPath mapping, mint nonce, setPendingReviewRequest — unchanged.
    }

    if (!canRequestChangelist || fetchFileDiff === undefined) {
      return null
    }

    const existing = prefetchRef.current
    const snapshotPromise =
      existing !== null && existing.key === prefetchKey
        ? existing.promise
        : (startPrefetch(), prefetchRef.current?.promise)
    if (snapshotPromise === undefined) {
      return null
    }

    let snapshot: ChangelistSnapshot
    try {
      snapshot = await snapshotPromise
    } catch {
      notify('Could not snapshot the changelist; review request not sent.')

      return null
    }

    const nonce = makeDispatchNonce()
    setPendingReviewRequest({
      nonce,
      ownerKey,
      cwd,
      diffSnapshot: snapshot.files,
      dispatchedAt: Date.now(),
    })

    return { nonce, requestFiles: snapshot.requestFiles }
  },
  [
    ownerKey,
    fileDiff,
    staged,
    cwd,
    repoRoot,
    canRequestChangelist,
    fetchFileDiff,
    prefetchKey,
    startPrefetch,
    notify,
  ]
)
```

`requestReview` / `copyReviewRequest` await `arm(scope)` inside their existing async IIFEs (popover closes first, exactly as today); `openPopover` resets the choice (`setScopeChoice(null)`) and calls `startPrefetch()` when `canRequest`. Return `{ scope, setScope: setScopeChoice, changeCount }` from the controller.

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/hooks/useRequestReview.test.ts && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useRequestReview.ts src/features/diff/hooks/useRequestReview.test.ts
git commit -m "feat(diff): changelist scope with keyed snapshot prefetch in useRequestReview"
```

---

### Task 7: Dual-half finding resolution (spec §2, §6)

**Files:**

- Modify: `src/features/diff/hooks/useAgentReview.ts` (+ `useAgentReview.test.ts`)

- [ ] **Step 1: Write failing tests** (the file's existing harness fires `agent-review` events through the mocked `listen`; add a dual-half snapshot fixture — same path in both halves with disjoint addition ranges):

```ts
// snapshot fixture: src/a.ts unstaged additions 10-19, staged additions 30-39
test('line finding matching only the staged half anchors staged', ...)   // line: 35 → addAnnotationForOwner(..., staged: true, ...)
test('line finding matching both halves prefers unstaged', ...)          // overlapping ranges → staged: false
test('line finding matching neither half degrades file-level on unstaged', ...) // line: 99 → staged: false + FILE_COMMENT_LINE_NUMBER
test('scope:file finding on a dual-half path lands unstaged', ...)       // staged: false
```

Each asserts the `staged` argument (4th param) of `addAnnotationForOwner` and, for the degrade case, the annotation's `lineNumber === FILE_COMMENT_LINE_NUMBER`. The staged-half test ALSO asserts the thread handle inherited the resolved half — follow-up routing depends on it:

```ts
const record = getFindingThreadRecord('session-1', nonce)
const target = record?.byOrdinal.get(1)
expect(target?.kind).toBe('anchored')
expect(target?.kind === 'anchored' ? target.handle.staged : undefined).toBe(
  true
)
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/hooks/useAgentReview.test.ts`
Expected: the staged-half test FAILS (first-match `findFile` returns whichever entry is first).

- [ ] **Step 3: Implement.** Replace `findFile` (line ~72) with:

```ts
const findingInRanges = (
  finding: AgentReviewFinding,
  file: ReviewedFile
): boolean => {
  const ranges = finding.side === 'deletions' ? file.deletions : file.additions

  return finding.scope === 'range'
    ? finding.startLine !== null &&
        finding.endLine !== null &&
        rangeInSameHunk(finding.startLine, finding.endLine, ranges)
    : finding.line !== null && lineInRanges(finding.line, ranges)
}

/**
 * Picks which snapshot entry a finding belongs to (VIM-327 spec §2): with the
 * path in both halves, the half whose ranges contain the target wins; both,
 * neither, or scope:"file" prefer unstaged (the working tree is where the
 * user acts). Selection and in-hunk determination are one question.
 */
const resolveFindingEntry = (
  snapshot: ReviewedFile[],
  finding: AgentReviewFinding
): { entry: ReviewedFile; targetInHunk: boolean } | undefined => {
  const candidates = snapshot.filter((file) => file.path === finding.path)
  if (candidates.length === 0) {
    return undefined
  }

  if (finding.scope !== 'file') {
    const matches = candidates.filter((file) => findingInRanges(finding, file))
    if (matches.length === 1) {
      return { entry: matches[0], targetInHunk: true }
    }
  }

  const preferred = candidates.find((file) => !file.staged) ?? candidates[0]

  return {
    entry: preferred,
    targetInHunk:
      finding.scope !== 'file' && findingInRanges(finding, preferred),
  }
}
```

In `handleReview`: replace the `findFile` call and the inline `ranges`/`targetInHunk` computation (lines ~173-197) with:

```ts
const resolved = resolveFindingEntry(diffSnapshot, finding)

if (resolved === undefined) {
  // …existing review-level note branch, unchanged
}

const downgradeToFile = finding.scope !== 'file' && !resolved.targetInHunk
```

and use `resolved.entry.staged` at the `addAnnotationForOwner` call and in the thread handle (`staged: resolved.entry.staged`).

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/hooks/useAgentReview.test.ts && npm run type-check`
Expected: PASS (including the pre-existing single-file placement tests — single candidate flows through `matches.length === 1` or `preferred`).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useAgentReview.ts src/features/diff/hooks/useAgentReview.test.ts
git commit -m "feat(diff): resolve dual-half finding placement with unstaged tie-break"
```

---

### Task 8: Popover scope control (spec §5)

**Files:**

- Modify: `src/features/diff/components/RequestReviewPopover.tsx` (+ `RequestReviewPopover.test.tsx`)
- Modify: `src/features/diff/components/Notifier.tsx` (+ `Notifier.test.tsx`)

- [ ] **Step 1: Write failing tests** (`RequestReviewPopover.test.tsx`, following its existing render helpers):

```ts
const scopeControl = {
  scope: 'changelist' as const,
  changeCount: 7,
  fileDisabled: false,
  changelistDisabled: false,
  onScopeChange: vi.fn(),
}

test('renders the scope control with both options when provided', ...)
  // getByRole('group', { name: 'Review scope (f/a)' }); buttons 'This file' and
  // 'All changes (7)'; the active option has aria-pressed=true

test('f and a hotkeys switch scope', ...)
  // fireEvent.keyDown(document, { key: 'f' }) → onScopeChange('file')
  // fireEvent.keyDown(document, { key: 'a' }) → onScopeChange('changelist')

test('scope control absent when scopeControl is undefined', ...)
  // queryByRole('group', { name: 'Review scope (f/a)' }) === null (degenerate case)

test('This file option is disabled without an active diff', ...)
  // fileDisabled: true → the 'This file' button has aria-disabled='true'
  // and pressing f does NOT call onScopeChange

test('All changes option is disabled on an empty strip', ...)
  // changelistDisabled: true → 'All changes (0)' has aria-disabled='true'
  // and pressing a does NOT call onScopeChange (spec §5 transient empty-strip state)
```

Add to `Notifier.test.tsx`: the `requestReview.scopeControl` prop reaches `RequestReviewPopover` (extend the existing pass-through test).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/components/RequestReviewPopover.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `RequestReviewPopover.tsx`:

```tsx
import { SegmentedControl } from '@/components/SegmentedControl'
import type { ReviewScope } from '../hooks/useRequestReview'

export interface RequestReviewScopeControl {
  scope: ReviewScope
  changeCount: number
  /** True when no active diff exists — the file option is unavailable. */
  fileDisabled: boolean
  /** True on a transient empty strip — the changelist option is unavailable. */
  changelistDisabled: boolean
  onScopeChange: (scope: ReviewScope) => void
}

interface RequestReviewPopoverProps {
  anchor: HTMLElement
  result: ResolveResult
  scopeLabel: string
  /** Scope choice (spec §5); undefined hides the control (degenerate case). */
  scopeControl?: RequestReviewScopeControl
  onSubmit: (pane: PaneCandidate) => void
  onCopy: () => void
  onCancel: () => void
}
```

Render the control at the top of the `<Popover>`, above both `result.kind` branches:

```tsx
{
  scopeControl !== undefined && (
    <div className="flex items-center gap-2 px-4 pt-3">
      <span className="text-xs text-on-surface-variant">Scope</span>
      <SegmentedControl<ReviewScope>
        aria-label="Review scope (f/a)"
        value={scopeControl.scope}
        onChange={scopeControl.onScopeChange}
        options={[
          {
            value: 'file',
            label: 'This file',
            disabled: scopeControl.fileDisabled,
            ariaLabel: 'This file',
          },
          {
            value: 'changelist',
            label: `All changes (${scopeControl.changeCount})`,
            disabled: scopeControl.changelistDisabled,
            ariaLabel: 'All changes',
          },
        ]}
      />
    </div>
  )
}
```

Extend the existing capture-phase keydown handler (lines ~58-92) — after the `'c'` branch:

```ts
if (
  event.key === 'f' &&
  scopeControl !== undefined &&
  !scopeControl.fileDisabled
) {
  event.preventDefault()
  event.stopPropagation()
  scopeControl.onScopeChange('file')

  return
}

if (
  event.key === 'a' &&
  scopeControl !== undefined &&
  !scopeControl.changelistDisabled
) {
  event.preventDefault()
  event.stopPropagation()
  scopeControl.onScopeChange('changelist')

  return
}
```

Add `scopeControl` to the effect dependency array. In `Notifier.tsx`, add `scopeControl?: RequestReviewScopeControl` to `RequestReviewState` (line ~23) and pass it through to `<RequestReviewPopover scopeControl={requestReview.scopeControl} …>`.

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/components/RequestReviewPopover.test.tsx src/features/diff/components/Notifier.test.tsx && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/components/RequestReviewPopover.tsx src/features/diff/components/RequestReviewPopover.test.tsx src/features/diff/components/Notifier.tsx src/features/diff/components/Notifier.test.tsx
git commit -m "feat(diff): scope segmented control in the request-review popover"
```

---

### Task 9: Panel wiring (spec §3, §5)

**Files:**

- Modify: `src/features/diff/Panel.tsx` (+ `Panel.test.tsx`)

Panel already destructures `useGitStatus` (search `statusRevision` and `filesCwd`) and derives `selectedFileUntracked` — reuse those locals; do not re-invoke the hook.

- [ ] **Step 1: Write failing tests** (add to `Panel.test.tsx`, reusing its harness — the file already mocks `gitService`, `writePty`, and drives the request-review popover for the single-file flow):

```ts
test('changelist review lands findings across files and halves end-to-end', ...)
  // Harness: git status returns [a.ts unstaged, a.ts staged, new.ts untracked];
  // open the request-review popover, press 'a' (scope=changelist), Delegate (Y);
  // assert the written payload contains 'these 3 changes', both group headers,
  // and the untracked annotation for new.ts; capture the nonce from the payload.
  // THEN complete the loop (spec §6 proof): emit the 'agent-review' event through
  // the harness's captured listen callback (same pattern as
  // src/features/diff/agentReplyThread.integration.test.tsx) with three findings —
  // one in a.ts's staged-half ranges, one in a.ts's unstaged-half ranges, one
  // scope:"file" on new.ts — and assert three annotations landed with the right
  // (path, staged) pairs and that getFindingThreadRecord(sessionId, nonce)
  // maps all three ordinals with handle.staged matching the resolved halves.

test('request review button appears with a populated strip and no selected file', ...)
  // No file selected → toolbar still renders diff-toolbar-request-review-button;
  // opening it shows the popover with 'This file' disabled.
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/diff/Panel.test.tsx -t 'changelist'`
Expected: FAIL.

- [ ] **Step 3: Wire.** At the `useRequestReview` call (line ~1220):

```ts
const review = useRequestReview({
  fileDiff: activeResponse?.fileDiff,
  ownerKey: feedbackOwnerKey,
  cwd,
  staged: selectedFileStaged,
  // Status repoRoot is populated whenever the strip is (spec §3); the diff
  // response only exists once a file has been opened.
  repoRoot: statusRepoRoot ?? response?.repoRoot ?? repoRootRef.current,
  changedFiles: files,
  statusRevision,
  fetchFileDiff: fetchFileDiffForReview,
  writePty: feedbackDispatch?.writePty,
  focusTerminal: feedbackDispatch?.focusTerminal,
  notify: notifyInfo,
})
```

where `statusRepoRoot` is the `repoRoot` returned by the existing `useGitStatus` destructure (rename on destructure: `repoRoot: statusRepoRoot`), `files` is its file list local, and:

```ts
const fetchFileDiffForReview = useCallback(
  async (
    path: string,
    staged: boolean,
    untracked: boolean
  ): Promise<FileDiff> => {
    const result = await createGitService(cwd).getDiff(path, staged, untracked)

    return result.fileDiff
  },
  [cwd]
)
```

(Match `gitService.getDiff`'s actual parameter order/signature — see `src/features/diff/services/gitService.ts:16-20` — and reuse an existing service instance if Panel already holds one.)

At the `requestReview` state object (line ~2434-2450): scopeLabel becomes per-scope and the scope control is threaded:

```ts
scopeLabel:
  review.scope === 'changelist'
    ? `${review.changeCount} change${review.changeCount === 1 ? '' : 's'}`
    : /* existing single-file label expression, unchanged */,
scopeControl:
  review.changeCount === 1 &&
  files[0]?.path === selectedFilePath &&
  files[0]?.staged === selectedFileStaged
    ? undefined
    : {
        scope: review.scope,
        changeCount: review.changeCount,
        fileDisabled: activeResponse?.fileDiff === undefined,
        changelistDisabled: review.changeCount === 0,
        onScopeChange: review.setScope,
      },
```

(`undefined` is the degenerate hide — exactly one entry and it is the active row, spec §5. An empty strip with an open diff keeps the control visible with "All changes (0)" disabled — the spec's transient state.)

- [ ] **Step 4: Run**

Run: `npx vitest run src/features/diff/Panel.test.tsx && npm run type-check`
Expected: PASS (all pre-existing Panel tests included).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/Panel.tsx src/features/diff/Panel.test.tsx
git commit -m "feat(diff): wire whole-changelist review scope through the diff panel"
```

---

### Task 10: Changelog + repo-wide gate

**Files:**

- Modify: `CHANGELOG.md`, `CHANGELOG.zh-CN.md` (new entry at top, matching the existing entry format — cite VIM-327 and the PR number placeholder to fill at PR time)

- [ ] **Step 1: Add both changelog entries** (mirror wording; zh-CN in Chinese), e.g.: "feat(diff): request delegated review over the whole changelist — scope toggle in the Request-review popover, grouped paths-only dispatch, findings anchor across all changed files (VIM-327)".

- [ ] **Step 2: Repo-wide gate** (CI parity — the Code Quality check is repo-wide):

```bash
npm run lint && npm run format:check && npm run type-check && npx vitest run
```

Expected: all green except the three known local flakes listed in Executor rules. Fix anything your diff introduced.

- [ ] **Step 3: Rust gate**

```bash
cargo test --manifest-path crates/backend/Cargo.toml git::
```

Expected: green except the known macOS-local failures.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CHANGELOG.zh-CN.md
git commit -m "docs(changelog): vim-327 whole-changelist delegated review"
```

---

## Self-review checklist (run after Task 10)

- Spec §1-§6 each map to a task (1: §2-parser, 2: §3-parity, 3: §2, 4: §4, 5-6: §3+§5, 7: §2+§6, 8-9: §5, 10: rollout).
- No `PendingReviewRequest.staged` reference survives: `grep -n "staged" src/features/diff/services/pendingReviewRequests.ts` and eyeball — the only `staged` members must be on `ReviewedFile`; the `PendingReviewRequest` interface body has none. Also `grep -rn "request\.staged" src/features/diff` returns nothing.
- `formatReviewRequest`/`dispatchReviewRequest` have no remaining 3-arg/5-arg callers (`grep -rn "formatReviewRequest(\|dispatchReviewRequest(" src`).
- The `TODO(VIM-341)` comment exists at the fetch site.
- PR: `Closes VIM-327` + `Part of VIM-284`, labels `auto-review` + `auto-approve`, branch `feature/vim-327`.

<!-- codex-reviewed: 2026-07-13T17:33:11Z -->
