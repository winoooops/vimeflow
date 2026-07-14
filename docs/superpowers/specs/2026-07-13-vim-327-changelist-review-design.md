# VIM-327 — Whole-Changelist Delegated Review (Multi-File Dispatch)

**Issue:** [VIM-327](https://linear.app/vimeflow/issue/VIM-327/featdiff-request-delegated-review-over-the-whole-changelist-multi-file) (parent: VIM-284 Inline Agent Q&A)
**Date:** 2026-07-13
**Upgrade-path issue:** [VIM-341](https://linear.app/vimeflow/issue/VIM-341/perfgit-batch-changelist-hunk-range-command-for-review-snapshots-drop) (batch hunk-range endpoint, deferred)

## 1. Problem & Goals

### Problem

The Request-review affordance (VIM-304 PR-2) delegates a review of only the **currently active file**: `useRequestReview.arm()` returns `null` unless the active file's parsed diff is present (`fileDiff === undefined → null`, `src/features/diff/hooks/useRequestReview.ts:80`) and builds the snapshot with `buildDiffSnapshot(fileDiff)` — a one-element array by construction (`src/features/diff/services/pendingReviewRequests.ts:33-49`). A real review request is almost always about the **whole changelist**: the reviewer should see every changed file, not the one that happens to be open.

### What carries over (verified in code) vs what changes

- **The dispatch prompt is already paths-only and plural-phrased.** `formatReviewRequest` (`src/features/diff/services/feedbackDispatch.ts:196-224`) sends `Delegate a code review of the ${mode} diff of these ${N} files:` followed by one `path (absolutePath)` line per file — **no diff text is inlined**; the delegated reviewer reads diffs locally. The issue's prompt-size options (a/b/c) collapse to (b): more files = more path lines. The formatter itself still changes: it takes one request-wide `staged` flag today, so Section 4 adds per-half grouping and an untracked annotation (untracked files never appear in `git diff`; the reviewer must read them directly).
- **The `VIMEFLOW_REVIEW` contract is per-finding self-anchoring** — each finding carries `path` + `scope` (`line`: `side` + `line`; `range`: `side` + `startLine`/`endLine`; `file`: path only, per `crates/backend/src/agent/review.rs:169-184`), and ingestion (`src/features/diff/hooks/useAgentReview.ts`) already resolves per path against the snapshot with the line → range → file fallback. Unknown paths spill to review-level notes — subject to the existing 50-finding ingest cap, which truncates before path resolution and keeps an aggregate omitted-count note (`useAgentReview.ts:163-164, 220-225`); Section 6 revisits the cap for changelist-sized reviews. The routing loop is path-keyed, but the staged axis it stamps is request-level today — Section 2 moves it per-file.
- **Nonce gating and owner routing are scope-independent** — one nonce covers a snapshot of any size; the finding-thread record keyed `(ptyId, nonce)` maps finding ordinals regardless of file count.

### Goals

1. The user can request a delegated review of the **entire pending changelist** — all file-strip entries: staged + unstaged + untracked. A partially-staged file contributes the halves the strip already shows: the status parser splits `MM`/`AM`/rename+worktree combos into two rows (`crates/backend/src/git/mod.rs:734-859`); other two-sided porcelain states (`MD`, `AD`) render as their single row today and are reviewed as such — extending the parser is out of scope.
2. Findings ingest and anchor across all reviewed files; a path present in **both halves** resolves deterministically (Section 2).
3. The per-file experience is unchanged when scope = this file; the existing popover gains the scope choice (Section 5).
4. Snapshot acquisition reuses the existing per-file `get_git_diff` IPC (N parallel, concurrency-capped) — the lean batch endpoint is deliberately deferred to **VIM-341**, cited by a `TODO` at the fetch site.

### Non-goals

- No new Rust/IPC surface (VIM-341 is the upgrade path).
- No `VIMEFLOW_REVIEW` contract change (findings stay path-anchored; no `staged` field added).
- No multi-request fan-out — one nonce, one request, one reviewer covers the changelist.
- No prompt inlining of diff text or size budgeting.
- No immutable review input (temp-index snapshot, inlined diffs): the reviewer reads the live diff, so dispatch-to-read drift is best-effort — identical to the single-file flow today (Section 3, drift semantics).

## 2. Scope Semantics & Snapshot Model

### The changelist is the file strip's entry list

Changelist scope covers **every `ChangedFile` entry** `useGitStatus` returns at arm time — the exact list the strip renders. Entries are already per-half: the Rust status parser emits two entries for an `MM`/`AM` file (staged + unstaged, `crates/backend/src/git/mod.rs:763-779`) and untracked files as unstaged entries. No re-derivation, no filtering: what you see in the strip is what gets reviewed. Empty strip → changelist scope unavailable.

### Conflicted entries (merge in progress) ride the zero-hunk path

`UU`/`AA`/`AU`/`UA` conflict rows reach the frontend as plain unstaged-modified entries (`crates/backend/src/git/mod.rs:871-881` — deliberately, "until the UI grows conflict-specific state"), so the changelist cannot exclude them. But `git diff` emits the combined format (`diff --cc`, `@@@` headers) for unmerged paths, and `parse_git_diff` mis-parses those today: `line.starts_with("@@")` matches `@@@` (`mod.rs:927`), so a second-parent range is read as the new-file range — garbage anchors. This is a latent bug in the single-file view already; the changelist sweep would just hit it systematically.

**Prerequisite fix at the parser**: `parse_git_diff` detects a combined diff (`@@@` header or `diff --cc` line) and emits the file with **zero hunks**. Conflicted entries then flow through the existing zero-hunk path (Section 3): listed in the prompt, empty ranges, findings degrade to file-level — visible, never mis-anchored. No exclusion logic, no new status value, and the single-file view stops rendering garbage ranges for conflicts as a side effect. The dev vite middleware mirrors the guard (combined-diff / `* Unmerged path` output → zero-hunk 200) and reports conflict rows unstaged, since an unmerged path has no servable `--cached` diff.

### `ReviewedFile` gains the half it came from

```ts
// pendingReviewRequests.ts
export interface ReviewedFile {
  path: string
  staged: boolean // NEW — which half this entry snapshots
  additions: HunkRange[] // new-file line spans (unchanged)
  deletions: HunkRange[] // old-file line spans (unchanged)
}
```

`PendingReviewRequest.staged` (the request-level axis, `pendingReviewRequests.ts:63`) is **removed** — with per-file `staged` there is no single request axis anymore, and keeping both invites drift. The single-file path becomes a 1-element snapshot carrying the selected row's half; every consumer (ingestion placement, prompt formatting) reads the per-file flag. The store is in-memory only (not persisted), so this is a free model change.

`buildDiffSnapshot(fileDiff)` becomes `buildDiffSnapshot(fileDiff, staged): ReviewedFile` (singular — the array assembly moves to the callers, which is where "a snapshot is a list of files" now actually lives).

### Dual-half finding resolution (the one new ambiguity)

A `VIMEFLOW_REVIEW` finding carries `path` but no half — deliberate non-goal (no contract change). When the snapshot has the path in **both halves**:

1. Collect both candidate entries for `finding.path`.
2. `scope: "line" | "range"` → **range-match**: anchor to the half whose `side` ranges contain the finding's line/range. Exactly one half matches → that half.
3. Both match, neither matches, or `scope: "file"` → **prefer unstaged** (the working tree is where the user acts on findings; deterministic tie-break).
4. Neither matches under `line`/`range` also still degrades to file-level on the preferred half — the existing line → range → file fallback is unchanged, it just picks a half first.

Wrong-half placement is low-cost by design: same path, same file content lineage, and the file-level fallback keeps every finding visible.

### What placement inherits

An anchored annotation is keyed `(cwd, filePath, staged)` exactly as today — `staged` now comes from the matched snapshot entry instead of the request. Review-level notes (path not in snapshot at all) are untouched.

## 3. Snapshot Acquisition (N parallel `get_git_diff`)

### `arm` becomes async, scoped

`arm()` is synchronous today because the single file's parsed diff is already in memory (the `fileDiff` prop). Changelist scope must fetch N diffs at arm time, so `arm(scope: 'file' | 'changelist')` becomes **async**; the single-file branch resolves immediately (no fetch, current behavior verbatim), the changelist branch fetches. `requestReview()` already runs its dispatch inside an async IIFE — the awaited arm folds into it. Interaction order is unchanged: popover closes immediately, the paste lands when the snapshot is ready.

### The fetch

For each `ChangedFile` entry: `getDiff(entry.path, entry.staged, entry.status === 'untracked')` → keep only `response.fileDiff` and build the **pair** the entry contributes: the snapshot entry `buildDiffSnapshot(fileDiff, entry.staged)` **and** its prompt-side `ReviewRequestFile` (`{ ...snapshotEntry, promptPath, untracked: entry.status === 'untracked' }`) — the `ChangedFile` is consulted at pairing time, not discarded before it (the untracked annotation in Section 4 depends on it). `oldText`/`newText`/`rawDiff` are dropped — rendering payload (Shiki/Pierre), not snapshot input.

`repoRoot` for `promptPath` comes from **`useGitStatus`** (`GitStatusResponse.repoRoot`, `useGitStatus.ts:29`) — populated whenever the strip is, unlike Panel's current diff-response-derived value (`Panel.tsx:1222`), which is `undefined` on the new no-file-open path (Section 5 gating). The diff-response value stays as fallback.

- **Parallel with a small concurrency cap** (8) via a ~10-line local pool helper — no dependency.
- The fetch site carries `// TODO(VIM-341): replace N get_git_diff round-trips with the batch hunk-range command` — the pre-agreed upgrade path.
- `useRequestReview` gains `changedFiles: ChangedFile[]` and a `fetchFileDiff(path, staged, untracked): Promise<FileDiff>` callback (Panel passes a thin wrapper over the existing `gitService.getDiff`), keeping the hook unit-testable with a mock callback.
- **Dev git-service parity is a prerequisite**, in two parts. (1) _Untracked_: the vite dev middleware maps untracked (`?`) entries to status `'A'` (`vite.config.ts:404-408`) — `entry.status === 'untracked'` never holds there, `getDiff(..., untracked: false)` 404s, and the atomic abort kills the whole changelist review in dev-browser mode. The middleware is updated to emit `'untracked'` (the serde-lowercase value the `GitStatus` type documents) and to serve a zero-hunk `FileDiff` for empty untracked files instead of 404. (2) _Status/diff axis coherence_: the middleware's status endpoint reports committed branch-vs-main files as `staged: true` entries (`vite.config.ts:352-381`) while its diff endpoint serves staged requests from `git diff --cached` only (`vite.config.ts:436-523`) — on a clean committed feature branch every such entry 404s and aborts the changelist. **Invariant: every entry the status endpoint reports must be fetchable from the diff endpoint on the axis it claims.** Serving those entries a branch-diff basis would make the prompt lie (it names `git diff --cached`, which is empty for them) — so the resolution is to **stop emitting the branch-vs-main section by default**: those entries are committed work, not part of the uncommitted changelist. The section stays reachable behind an explicit `?base=<branch>` query param (the frontend never sends one), aligning dev status with desktop semantics: uncommitted changes only. Verification is a runnable dev-server curl script (the middleware has no test harness and sits outside every tsc project): clean committed feature branch reports no entries; touched/untracked/empty-untracked files each report fetchable entries. Desktop (Rust) already conforms on both counts.

### Prefetch on popover open (clipboard gesture)

`openPopover()` kicks off the changelist snapshot fetch immediately when the strip is non-empty. The controller holds **one in-flight promise ref, keyed by its inputs, that never rejects** — failure resolves to `null`, so a discarded or never-consumed prefetch cannot surface as an unhandled rejection (and no `.then`/`.catch` chain is needed under the repo's `promise/prefer-await-to-then` rule). The key is `(cwd, useGitStatus revision)` captured when the fetch starts. `arm('changelist')` consumes the prefetch **only if its key still matches the current values** — `Panel` stays mounted across cwd switches (terminal OSC 7 sync), so an unresolved repo-A fetch must never arm a request in repo B; on key mismatch, arm starts a fresh fetch (the rare case pays the latency, correctness doesn't). Re-opening while an unresolved same-key fetch exists **reuses** it (no second 8-worker pool); a settled or stale-keyed promise is dropped so the next open refetches. Closing the popover or picking file scope merely stops consuming it. Failure surfaces only when `arm('changelist')` consumes the promise and finds `null` — the atomic-abort notify above.

`arm('changelist')` awaits that prefetch instead of starting a fetch — by the time the user presses `Y`/`c` it has usually resolved, so **Copy's clipboard write stays inside the user-activation window** (awaiting a resolved promise is a microtask continuation; transient activation survives it, but not a multi-hundred-ms fetch). When the prefetch is still unresolved at copy time, the existing `writeClipboardText` boolean-failure path already notifies "Could not copy the review request." (`useRequestReview.ts:146-150`) — degraded, visible, retryable. The delegate path is gesture-insensitive (pty write) and simply gains the lower latency.

### Failure is atomic; emptiness is not failure

- **Any fetch rejection aborts the whole arm**: no nonce minted, nothing stored, `notify('Could not snapshot the changelist; review request not sent.')`. Same atomicity contract as the VIM-298 follow-up dispatch — a half-armed request is worse than a retry.
- **Zero-hunk responses are included, not errors** (binary files, mode-only changes): the entry snapshots with empty ranges, so any line finding on it degrades to file-level — graceful, visible.
- **Drift semantics are best-effort, unchanged from the single-file flow.** Two clocks exist and only one is frozen: _placement_ is deterministic against the armed hunk ranges (`PendingReviewRequest.diffSnapshot`), but the _reviewer_ reads the live diff whenever it gets around to it — the prompt is paths-only, so edits (or a delayed copy/paste) between dispatch and read mean the reviewer can describe content the armed ranges predate. That is exactly how VIM-304 single-file requests ship today; the line → range → file fallback keeps drifted findings visible rather than lost, and an immutable review input (temp index, inlined diffs) is an explicit non-goal (Section 1). No re-validation at ingest.

## 4. Dispatch Prompt (grouped, still paths-only)

### One shape, grouped by half

`formatReviewRequest(files, staged, nonce)` → **`formatReviewRequest(files: ReviewRequestFile[], nonce: string)`** — the request-wide `staged` param dies with the per-file model, **and so does the rest of the call chain's**: `dispatchReviewRequest(ptyId, files, staged, nonce, writePty)` (`feedbackDispatch.ts:227`) becomes `dispatchReviewRequest(ptyId, files: ReviewRequestFile[], nonce, writePty)` (its `files` param also narrows from `ReviewedFile[]` to `ReviewRequestFile[]`), and the hook call site (`useRequestReview.ts:117-123`) drops the argument. `ReviewRequestFile` (extends `ReviewedFile`, so it now carries `staged`) gains `untracked?: boolean` — a prompt-side concern only; placement never reads it. The formatter always emits the grouped shape (non-empty groups only), replacing the two-phrasing branch a special single-file case would need. Counts say **"changes"**, not "files" — `files.length` is an entry count and a dual-half path contributes two entries (consistent with Section 5's label):

```
> Delegate a code review of these 4 changes:
> unstaged diff (`git diff`):
> ─ src/a.ts (/repo/src/a.ts)
> ─ src/b.ts (/repo/src/b.ts) (untracked — not in git diff; read the file, all lines are additions)
> staged diff (`git diff --cached`):
> ─ src/a.ts (/repo/src/a.ts)
> ─ src/c.ts (/repo/src/c.ts)
>
> Anchor each finding with diff-side line numbers: "additions" uses new-file lines, "deletions" uses old-file lines.
> In the JSON block, use the repo-relative path before the parentheses as each finding path.
> category is one of: "bug", "suggestion", "change", "question". scope is "line", "range", or "file".
> When done, end your reply with this exact block — echo the nonce verbatim and self-report the reviewer name.
> Also give a one-line overview in your normal reply (not in the block), especially if there is little to report.
> <<<VIMEFLOW_REVIEW ... VIMEFLOW_REVIEW>>>   (contract lines byte-identical to today)
```

- **Group headers name the exact git command** — the reviewer knows precisely which diff to read for which list; a path appearing in both groups is reviewed in both.
- **Untracked annotation** tells the reviewer the file is invisible to `git diff` and how to treat it (whole file = additions), keeping line anchors meaningful.
- The single-file request becomes a one-group instance of the same shape (existing prompt tests update; the prompt text is not a parsed contract — only the `VIMEFLOW_REVIEW` block is, and it is untouched).

### Copy path follows

`copyReviewRequest()` awaits the same async `arm(scope)` and feeds the same formatter — delegate and copy stay byte-identical for a given scope, as today.

## 5. UI: Scope Choice in the Existing Popover

### Controller owns scope; popover stays a dumb chooser

`useRequestReview` gains `scope: 'file' | 'changelist'` + `setScope` state; `RequestReviewPopover` renders it with the shared **`SegmentedControl`** primitive (`src/components/SegmentedControl.tsx` — `role="group"` + `aria-pressed` buttons, the canonical grouped-control contract per `docs/design/UNIFIED.md` §5.13; no bespoke radiogroup) above the existing delegate/copy row, and only reports changes (`onScopeChange`) — build/send logic stays in the controller, per the component's existing contract (`RequestReviewPopover.tsx:36-38`).

```
┌─ Request review ────────────────────┐
│  Scope:  [ This file ]  [ All changes (7) ]   ← SegmentedControl, tonal selected chip
│  Delegate a code review of 7 changes to
│  claude (Claude Code)?
│        Copy (c)   Cancel (n)   Delegate (Y)
└─────────────────────────────────────┘
```

- **Hotkeys**: `f` → This file, `a` → All changes, handled in the popover's existing capture-phase keydown alongside `Y`/`c`/`n` (`RequestReviewPopover.tsx:58-92`). The shared `SegmentedControl` API has no per-option `aria-keyshortcuts` passthrough — the group's `aria-label` names the keys (`Review scope (f/a)`) instead of extending the primitive.
- **`scopeLabel` becomes per-scope**: file → `src/auth.ts (unstaged)` (today's string, `Panel.tsx:418`); changelist → `7 changes` (entry count — a dual-half file counts twice, so "changes", not "files").

### Defaults & gating

- **Default scope = `changelist` when the strip has >1 entry**, else `file` — the issue's whole motivation is that real review requests are about the changelist; single-entry strips behave exactly as today.
- **The choice resets each open**: `openPopover()` clears any prior selection back to the computed default, so a stale changelist choice cannot survive strip/file state transitions between opens.
- **Selector hidden when the choice is degenerate**: exactly one strip entry and it is the active file (both scopes identical) — today's popover, unchanged.
- **No active file** (`fileDiff === undefined`): scope forced `changelist`, "This file" chip disabled with the existing disabled treatment.
- **Empty strip while a diff is still open** (transient — e.g. everything just committed): scope forced `file`, "All changes" chip disabled — the UI mirror of Section 2's "empty strip → changelist scope unavailable".
- **Toolbar button gating loosens**: `canRequest = ownerKey !== undefined && (fileDiff !== undefined || changedFiles.length > 0)` — the button (`DiffChipToolbar.tsx:767`) now appears with a populated strip even before any file is opened.

### What doesn't change

Delegate-target resolution (`ResolveResult` one-agent fast path vs copy-fallback), `Y`/`c`/`n` keys, popover width/styling, the Notifier mounting seam — all untouched.

## 6. Ingestion, Cap Decision & Testing

### Resolution folds half-selection into target-matching

`handleReview` changes are surgical (`useAgentReview.ts:137-242`):

- Line 148: `staged` leaves the destructure — it's per-entry now.
- `findFile(diffSnapshot, finding.path)` (first-match, line 173) becomes `resolveFindingEntry(diffSnapshot, finding): { entry: ReviewedFile; targetInHunk: boolean } | undefined` — it collects the path's candidate entries (1 or 2), runs the existing side-range check (`lineInRanges`/`rangeInSameHunk`) **per candidate**, and applies Section 2's rule: exactly one half contains the target → that half with `targetInHunk: true`; both/neither/`scope:"file"` → unstaged-preferred half, `targetInHunk` as computed for it. The separate lines 188-197 check dissolves into the helper — selection and in-hunk determination are one question for dual-half paths.
- `undefined` (path not in snapshot) → review-level note, unchanged.
- Lines 204, 208-216: `addAnnotationForOwner(..., entry.staged, ...)` and the thread handle stamp `entry.staged` — replies and threads (VIM-298) inherit the right half with no further changes.

### Cap decision: keep 50, unchanged

`REVIEWER_FINDING_SOFT_CAP = 50` stays. It is a display-sanity cap, and a changelist review that exceeds it is a reviewer-prioritization smell, not a routing problem; the aggregate omitted-count note (lines 220-227) already tells the user exactly what happened. No per-file cap, no raise. (Resolves the Section 1 deferral.)

### Testing

- **`pendingReviewRequests`**: `buildDiffSnapshot(fileDiff, staged)` singular return; `ReviewedFile.staged`.
- **`feedbackDispatch`**: grouped prompt — two groups, one-group collapse, untracked annotation, signature change; `VIMEFLOW_REVIEW` block byte-identical.
- **`useRequestReview`**: async `arm('changelist')` with mocked `fetchFileDiff`; atomic failure (one rejection → no nonce minted, notify fired); zero-hunk entry included; prefetch lifecycle (open starts it, arm consumes the same promise, close discards); scope default/forcing; loosened `canRequest`.
- **`useAgentReview`**: dual-half table — target in staged ranges only → staged; in both → unstaged; `scope:"file"` → unstaged; path absent → review-level; cap note on 51 findings.
- **Popover**: scope `SegmentedControl` renders, `f`/`a` hotkeys, degenerate hide, disabled "This file" without an active diff.
- **Rust `parse_git_diff`**: combined-diff input (`diff --cc` / `@@@` headers) yields zero hunks — no two-way misreads.
- **Panel integration**: changelist request through dispatch — grouped payload + stored snapshot shape (per-entry `(path, staged)`) asserted in `Panel.test.tsx`; the snapshot-shape → placement half lives in `useAgentReview.test.ts` (dual-half table) with the shared `HunkRange` shape pinned by `pendingReviewRequests.test.ts`, so the two halves meet on a tested contract (`useAgentReview` mounts in `WorkspaceView`, not `Panel`, so a single mounted round-trip is not constructible in `Panel.test.tsx`).

### Rollout

In-memory stores only — no persistence or migration. Single PR on `feature/vim-327` (auto-review/auto-approve), body `Closes VIM-327` + `Part of VIM-284`. v2 escape hatch pre-filed as VIM-341.

<!-- codex-reviewed: 2026-07-13T17:32:58Z -->
