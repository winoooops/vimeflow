# 2026-05-24 — Pierre Diffs integration design

## 1. Summary

The in-app git diff renderer at `src/features/diff/components/` (`DiffViewer.tsx`, `SplitDiffView.tsx`, `UnifiedDiffView.tsx`, `DiffLine.tsx`, `DiffHunkHeader.tsx` — ~900 LOC of components, ~7.7 k LOC across the whole feature including tests) is hand-rolled. Rust parses (`crates/backend/src/git/mod.rs:459` `parse_git_diff()`) and React renders. It is missing two diff-renderer table stakes — Shiki syntax highlighting and a word-level intra-line diff producer — and it ships UI scaffolding for hunk stage / unstage / discard that is wired to `Promise.reject('not implemented')` stubs (buttons exist in `src/features/diff/components/DiffToolbar.tsx`, `gitService.stageFile()` exists at `src/features/diff/services/gitService.ts:161–171`, but no Rust handler grows them under `crates/backend/src/git/`).

This spec describes a **three-PR integration** that replaces the rendering layer with [`@pierre/diffs@^1.2.2`](https://www.npmjs.com/package/@pierre/diffs) (Apache-2.0; see [`docs/decisions/2026-05-23-pierre-diffs-renderer.md`](../../decisions/2026-05-23-pierre-diffs-renderer.md) for the library-choice rationale) while keeping the Rust git source, `ChangedFilesList` sidebar, and `CommitInfoPanel` chrome.

- **PR1 — Renderer replacement.** Ship `<MultiFileDiff>` from `@pierre/diffs/react` driven by an extended Rust `get_git_diff` IPC that returns raw `oldText` / `newText` alongside the parsed `FileDiff`. The Vite dev-mode middleware `gitApiPlugin` in `vite.config.ts` is updated to return the same `oldText` / `newText` payload (via `simple-git.show()` for the indexed/HEAD version plus a filesystem read of the working tree) so PR1 is independently shippable in both Electron production and Vite dev modes. Introduce the chip-style toolbar (PriorityPlus + Dropdown + Segmented + Toggle primitives under `src/features/diff/components/toolbar/`) as the replacement for `DiffToolbar.tsx`. Mount Pierre's `<WorkerPoolContextProvider>` so Shiki tokenization runs off-main-thread from day one. Tear down all spike scaffolding (`src/spikes/`, the `SPIKE_PIERRE_DIFFS` flag in `DiffPanelContent.tsx`, the `?spike=pierre-diffs` gate in `src/App.tsx`).
- **PR2 — Hunk staging IPC + wiring.** Grow three new Rust IPC handlers — `stage_file(path, hunkPatch?)`, `unstage_file(path, hunkPatch?)`, `discard_file(path, hunkPatch?)` — each accepting an optional unified-diff hunk patch so the same handler covers whole-file (omit `hunkPatch`) and per-hunk (provide `hunkPatch`) operations. The whole-file branch mirrors the existing `gitService` contract at `src/features/diff/services/gitService.ts:161–171`. Land them per the 4-file IPC checklist (`mod.rs` + `runtime/state.rs` + `runtime/ipc.rs` + `electron/backend-methods.ts`). Unstub the matching frontend `gitService` methods and reuse the existing `extractHunkPatch()` utility at `src/features/diff/services/gitPatch.ts:56–77` to derive the hunk patch at the call site. **v1 ships refresh-on-success only** (click → IPC → `useFileDiff` / `useGitStatus` refetch → `<MultiFileDiff>` re-renders). Optimistic UI via Pierre's `diffAcceptRejectHunk` requires switching to `<FileDiff>` with controlled `FileDiffMetadata` and is deferred to a v2 follow-up listed in Section 9. The "Discard All" chip dispatches `discard_file(path)` with no `hunkPatch`. Section 5.3 details the full click-to-IPC flow + the Pierre→raw-diff hunk-index mapping (identity, since both produce hunks in source order).
- **PR3 — Inline review comments → active agent panel.** Capture per-line user comments through Pierre's `DiffLineAnnotation<T>` + `renderAnnotation`. Hold them in a per-workspace feedback batch with a "Finish feedback" action that ships the batch to the currently-active coding agent's terminal session **by reusing the existing `write_pty` IPC** — no new agent-bridge IPC is added, because Vimeflow agents are CLI processes whose stdin is already exposed. No receiver UI is added on the agent-status side; the formatted feedback message appears in the existing terminal scrollback and the agent reacts via its usual reply path. Section 6 details the active-agent resolution rule, the message format, and the v1 scope limits.

The visual language is anchored on `pierre-dark` as the default Shiki theme (closest fit to the Obsidian Lens out of the box; long-term we register a custom theme derived from `tailwind.config.js` Catppuccin tokens — see Section 7). The new chip toolbar collapses to a single visible row at any width: Priority+ overflow folds chips into a trailing `…` portal-rendered menu via `@floating-ui/react` (same primitive as our `Tooltip` per [`docs/decisions/2026-04-22-tooltip-library.md`](../../decisions/2026-04-22-tooltip-library.md)). Below `DIFF_MIN_WIDTH_PX = 360` the diff body is replaced with a "pane too narrow" placeholder while the toolbar stays interactive. Between `DIFF_MIN_WIDTH_PX` and `SPLIT_MIN_WIDTH_PX = 720` the `diffStyle: 'split'` preference is silently coerced to `'unified'` without overwriting the saved preference, so widening the pane back restores split.

No persistence is introduced for v1 — every toolbar knob (theme / highlight / indicators / overflow / line numbers / background tint / file header / sticky header) lives in component state. A future settings-dialog spec ([#252](https://github.com/winoooops/vimeflow/issues/252)) can persist these per-workspace.

## 2. Background & current state

### 2.1 What exists today

The diff feature lives under `src/features/diff/` (40 files, ~7.7 k LOC; ~50 % tests) and `crates/backend/src/git/` (~1.15 k LOC; no external diff-parsing crate). The orchestration shell is `src/features/diff/components/DiffPanelContent.tsx:46`. It holds the `ChangedFilesList` sidebar (`src/features/diff/components/ChangedFilesList.tsx:34`) bound by `useGitStatus()` (`src/features/diff/hooks/useGitStatus.ts`), a `useFileDiff()` data layer (`src/features/diff/hooks/useFileDiff.ts:18–79`) returning `{ diff, loading, error }`, and a right-pane conditional ladder (lines 254–281) that dispatches to `<DiffViewer fileDiff={diff} viewMode="unified" />`.

`DiffViewer.tsx:14` is a thin router that loads `SplitDiffView.tsx:12` (side-by-side with synchronized scroll) or `UnifiedDiffView.tsx:12` (single column). Both delegate row rendering to `DiffLine.tsx:10–112` — the only place word-level highlights would render. The schema `LineHighlight = { start: number, end: number }` lives at `src/features/diff/types/index.ts`, the rendering loop is wired at `DiffLine.tsx:32–77`, but **no producer ever populates `highlights[]`**.

The toolbar `DiffToolbar.tsx:16` ships:

- A split / unified pill (the spike's `<Segmented>` replaces this).
- Prev / next hunk arrow buttons.
- A `X HUNKS` counter (Pierre derives this from the diff metadata).
- Stage / Discard / Discard All buttons (Pierre's `diffAcceptRejectHunk` covers Stage / Discard; "Discard All" stays as a single chip on the new toolbar).

The Rust backend is reachable in two ways:

- **Production (Electron).** `DesktopGitService.getDiff()` in `src/features/diff/services/gitService.ts:87–123` invokes `get_git_diff` over the preload IPC bridge. The inner `get_git_diff_inner()` at `crates/backend/src/git/mod.rs:915–1004` shells out to `git diff [--cached] -- <file>` (with `git diff --no-index /dev/null <file>` fallback for untracked files at `mod.rs:998–1001`) and parses the unified-diff output line-by-line in `parse_git_diff()` at `mod.rs:459–565`, tracking line numbers manually.
- **`npm run dev`.** `HttpGitService` hits the Vite middleware `gitApiPlugin` in `vite.config.ts` which runs `simple-git` + `diff2html` to produce the same `FileDiff` shape.

Both paths return the same `FileDiff` shape declared at `src/features/diff/types/index.ts:1–61`:

```ts
interface FileDiff {
  filePath: string
  oldPath?: string
  newPath?: string
  hunks: DiffHunk[]
}
interface DiffHunk {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}
interface DiffLine {
  type: 'added' | 'removed' | 'context'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
  highlights?: LineHighlight[]
}
```

Pierre's `<MultiFileDiff>` consumes a different shape — raw `oldFile: FileContents` and `newFile: FileContents` (where `FileContents = { name, contents, lang?, header?, cacheKey? }`) — and computes the diff itself via the bundled `diff` package. Section 4.2 / 4.3 / 4.4 cover the IPC + bindings + service-layer changes that bridge the two.

### 2.2 What is missing

| Capability                                 | Status today                       | Why                                                                       |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| Shiki / language-aware syntax highlighting | ❌ Absent                          | Rust parser emits raw text; React renderer has no Shiki integration.      |
| Word-level intra-line diff producer        | ❌ Schema present, never populated | `LineHighlight[]` exists in types and renderer, but no producer fills it. |
| Hunk stage / unstage / discard             | ❌ UI present, backend stubbed     | Buttons render; `gitService.stageFile()` exists; no Rust handler.         |
| Large-file virtualization                  | ❌ Absent                          | Full DOM render of every line.                                            |
| Merge-conflict resolver UI                 | ❌ Absent                          | Hand-rolled parser does not surface conflict regions.                     |
| Inline reviewer comments / annotations     | ❌ Absent                          | No annotation surface exists.                                             |

PR1 closes the first two via Pierre's defaults. PR2 closes the third by growing the missing Rust IPC. PR3 closes the last one. Virtualization and merge-conflict UI remain explicit non-goals for v1 (Section 3.2).

### 2.3 Spike-validated direction

A spike on this branch (`feat/pierre-diffs-integration`) validated `@pierre/diffs/react`'s `<MultiFileDiff>` rendering inside the actual `DiffPanelContent` right slot. The spike uses machine-local fixtures under `docs/spikes/pierre-diffs/` (excluded from git via the worktree's common-dir `info/exclude`) and a `SPIKE_PIERRE_DIFFS` env-gated branch in `DiffPanelContent.tsx:21` that swaps `<PierreDiffsDemo />` in for the real `<DiffViewer />`. The spike also produced the chip-style toolbar prototype (PriorityPlus overflow with single-row `maxRows`, floating-ui Dropdown / Segmented / Toggle primitives, responsive width bands at 720 / 360 px) that this spec promotes to feature-local primitives under `src/features/diff/components/toolbar/`. All spike scaffolding is deleted in PR1 (Section 4.9).

The decision record [`docs/decisions/2026-05-23-pierre-diffs-renderer.md`](../../decisions/2026-05-23-pierre-diffs-renderer.md) captures every option considered (in-house build, `modem-dev/hunk` CLI in a terminal pane, `@pierre/diffs` lib), why Pierre wins (library not CLI; Bootstrap-creator maintainers; multiple independent adopters in the wild; Apache-2.0 compatible; unlocks Shiki + word-diff + virtualization + merge-conflict + annotation framework in one move), and the locked design choices (default option states, responsive bands, toolbar priority order, primitive selection). This spec executes that decision and adds inline-review-comments as PR3 — a feature not contemplated in the decision record but landing on the same renderer.

## 3. Goals & non-goals

### 3.1 Goals

1. **Replace the React rendering layer** at `src/features/diff/components/` (`DiffViewer.tsx`, `SplitDiffView.tsx`, `UnifiedDiffView.tsx`, `DiffLine.tsx`, `DiffHunkHeader.tsx`) with `@pierre/diffs/react`'s `<MultiFileDiff>`. Restore feature parity for split / unified rendering and gain Shiki syntax highlighting + word-level intra-line diff + sticky file headers + theme integration with zero net loss against current behavior.
2. **Run Pierre's Shiki tokenization off the main thread from day one** via `<WorkerPoolContextProvider>`. Target: a ≥ 1 000-line diff opens without blocking the main thread for the 100–500 ms tokenize window.
3. **Ship the chip-style toolbar** (PriorityPlus overflow, single visible row at any width, portal-rendered dropdowns) as the replacement for `DiffToolbar.tsx`. Promote the spike's `PriorityPlus` / `Dropdown` / `Segmented` / `Toggle` primitives to feature-local files under `src/features/diff/components/toolbar/` (decision: feature-local rather than `src/components/` until a second consumer appears). Preserve the spike's responsive width bands: `SPLIT_MIN_WIDTH_PX = 720` silently coerces split → unified; `DIFF_MIN_WIDTH_PX = 360` replaces the diff body with a placeholder while the toolbar remains interactive.
4. **Wire the missing Rust IPC handlers** in PR2 — `stage_file` / `unstage_file` / `discard_file`, each accepting an optional unified-diff hunk patch so the same handler serves whole-file and per-hunk operations. Land per the 4-file IPC checklist (`mod.rs` + `runtime/state.rs` + `runtime/ipc.rs` + `electron/backend-methods.ts`). v1 dispatches the IPC on chip click and refreshes the diff + git-status on success — no Pierre-side optimistic UI in v1 (deferred to v2 per Section 9). The `hunkPatch` string is extracted at the consumer (`DiffPanelContent` holds `response.rawDiff`) via the existing `extractHunkPatch()` utility at `src/features/diff/services/gitPatch.ts:56–77` and passed to the service. The "Discard All" chip stays as a whole-file operation (`discard_file` with no `hunkPatch`).
5. **Add inline review comments** in PR3: per-line annotations via Pierre's `DiffLineAnnotation<T>`, a per-workspace feedback batch, a "Finish feedback" action that surfaces the batch into the currently-focused coding agent's terminal session by **reusing the existing `write_pty` IPC** (no new agent-bridge IPC, no receiver UI — the formatted message appears in the agent's terminal scrollback and the agent reacts via its usual reply path).
6. **Each PR is independently reviewable and shippable.** A merged PR1 is a strict improvement on what we ship today even if PR2 / PR3 never land.

### 3.2 Non-goals

1. **Theme drift.** v1 ships with `pierre-dark` as the default theme. Registering a custom Shiki theme derived from `tailwind.config.js` Catppuccin tokens is a separate follow-up (Section 7); this spec does not block on theme-token plumbing.
2. **Virtualization.** Pierre offers virtualization in React by wrapping `<MultiFileDiff>` in a `<Virtualizer>` context provider (the core-side `VirtualizedFileDiff` class is not exported from `@pierre/diffs/react` as a JSX component). v1 renders without the `<Virtualizer>` wrapper. We add it only when a measured frame-budget regression or a concrete large-file complaint appears.
3. **Replacing `ChangedFilesList`.** Pierre's sister library `@pierre/trees` is a future possible swap for the file-list sidebar; that is a separate decision and out of scope here.
4. **Persisting toolbar preferences.** Theme / highlight / split-vs-unified / boolean toggles all live in component state for v1. Persisting to settings ([#252](https://github.com/winoooops/vimeflow/issues/252)) is a separate spec.
5. **CLI launcher to `modem-dev/hunk`.** The decision record's Path C ("open in hunk" power-user shortcut) is explicitly deferred and not part of this integration.
6. **Settings dialog integration.** The new chip toolbar is the only surface for these options in v1. A future settings-dialog page that mirrors or overrides them is out of scope.
7. **i18n.** Chinese strings for the new toolbar / placeholder / feedback UI are deferred to a sweep; English-only for v1.
8. **PR3 v2 niceties.** Inline-review v1 captures plain-text comments only — no attachments, no threaded replies, no rich-text formatting, no batch-size cap UI. Soft cap of 50 comments per batch is enforced silently; UI for that comes in a future spec if needed.

## 4. PR1 — Renderer replacement

PR1 is the single largest unit of work. It replaces the React rendering layer end-to-end, extends the Rust git source so Pierre has what it needs, ships the new chip toolbar, and tears down the spike. After PR1 lands, the diff pane renders with Shiki syntax highlighting and word-level intra-line diffs; the toolbar collapses responsively into a Priority+ overflow menu; the spike scaffolding is gone. Stage / Discard chips are visible but no-op (placeholders for PR2). Inline annotations are not present (PR3).

### 4.1 Pierre setup: `WorkerPoolContextProvider` mount + Vite worker asset

`@pierre/diffs@^1.2.2` is already in `package.json` from the spike commit `60a02dc chore(diff): add @pierre/diffs dependency for renderer replacement`. PR1 adds two production wires.

**Provider mount.** Wrap the React tree in `<WorkerPoolContextProvider>` at the root so all Pierre instances share one pool. The provider's destructured props in `@pierre/diffs@^1.2.2` are `{ children, poolOptions, highlighterOptions }` (see `node_modules/@pierre/diffs/dist/react/WorkerPoolContext.d.ts`); both `poolOptions` and `highlighterOptions` are required at the type level. `src/App.tsx` becomes:

```tsx
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { ReactElement } from 'react'
import { WorkspaceView } from './features/workspace/WorkspaceView'

// Singleton Worker factory. Pierre's worker entry is exposed as a
// dedicated package export so Vite can bundle it via `new Worker(url, ...)`
// without us hand-stitching a path. Using `import.meta.url` + Vite's
// new-Worker transform produces a hashed asset that resolves under both
// dev and production builds.
const workerFactory = (): Worker =>
  new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
    type: 'module',
  })

const poolOptions = {
  workerFactory,
  // `poolSize` defaults to 8 per `WorkerPoolOptions` in
  // `node_modules/@pierre/diffs/dist/worker/types.d.ts`. Override here
  // only if profiling shows we need fewer (low-core machines) or more
  // (large-diff burst load).
}

const highlighterOptions = {
  // Singular `theme` per `WorkerRenderingOptions` (NOT plural `themes`).
  // Accepts `DiffsThemeNames | ThemesType` — `ThemesType` is the
  // `{ dark, light }` pair when we want auto light/dark switching.
  theme: 'pierre-dark' as const,
  // Optional knobs from `WorkerRenderingOptions`:
  //   useTokenTransformer, tokenizeMaxLineLength, lineDiffType,
  //   maxLineDiffLength — use library defaults in v1. `langs` is on the
  //   parent `WorkerInitializationRenderOptions` and stays empty so
  //   Pierre lazy-loads per filename.
}

const App = (): ReactElement => (
  <WorkerPoolContextProvider
    poolOptions={poolOptions}
    highlighterOptions={highlighterOptions}
  >
    <WorkspaceView />
  </WorkerPoolContextProvider>
)

export default App
```

The exact prop names and acceptable shapes are pinned by `WorkerPoolContextProps extends SetupWorkerPoolProps` — verify the planner-time implementation against `node_modules/@pierre/diffs/dist/worker/getOrCreateWorkerPoolSingleton.d.ts` for the full `SetupWorkerPoolProps` field list (sizing, recycling, error handling). The provider is dev-mode-safe (its singleton handles HMR without leaking workers).

**Vite worker asset.** Pierre's worker entry lives at `@pierre/diffs/worker/worker.js` and must be served by Vite as a separate bundle (not concatenated into the main app chunk). Vite's `worker` field in `vite.config.ts` controls this. The provider already knows the worker URL via package `exports` — no manual `new Worker(...)` plumbing needed — but Vite's production build must keep the worker file resolvable. Add to `vite.config.ts`:

```ts
worker: {
  format: 'es',
  rollupOptions: {
    output: {
      // Keep Pierre's worker out of the main chunk hash so Pierre can resolve it
      // via its own package exports without us hand-wiring the URL.
      entryFileNames: 'assets/pierre-worker-[hash].js',
    },
  },
},
```

Verify with `npm run build` that `dist/assets/pierre-worker-*.js` exists and is referenced from the worker provider, not inlined into the renderer bundle. Bundle-size impact is tracked under the risks table in Section 9.

### 4.2 Rust: extend `get_git_diff` with `oldText` / `newText`

`crates/backend/src/git/mod.rs` currently returns a `FileDiff` from `get_git_diff_inner()` (`mod.rs:915–1004`). PR1 extends the return type to carry the raw "before" and "after" file contents that Pierre needs.

**New response type** co-located with the existing `FileDiff` in `crates/backend/src/git/mod.rs`. Use the project's canonical derive-and-rename pattern (matches `CostMetrics` at `crates/backend/src/agent/types.rs:85–91`):

```rust
/// Response payload for `get_git_diff` — parsed FileDiff plus the raw
/// before/after file contents that Pierre needs to render via Shiki.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GetGitDiffResponse {
    pub file_diff: FileDiff,
    /// Old file contents at the diff's base (HEAD or index, depending on
    /// `staged`). Empty string when the file is untracked.
    pub old_text: String,
    /// New file contents at the diff's tip (index or working tree). Empty
    /// string when the file has been deleted.
    pub new_text: String,
    /// The raw unified-diff text. Reused by PR2's `extractHunkPatch()`
    /// for stage/unstage operations.
    pub raw_diff: String,
}
```

`#[derive]` is `Serialize`-only — nested types (`FileDiff` / `DiffHunk` / `DiffLine` / `DiffLineType` in `mod.rs`) already derive only `Serialize`, so adding `Deserialize` to the wrapper would fail to compile against their existing derive sets. **PR1 must also add the `#[cfg_attr(test, derive(ts_rs::TS))]` + `#[cfg_attr(test, ts(export))]` pair to all four nested types** — `ts_rs` requires every transitively-referenced type to derive `TS` so the binding generator can walk the shape. Without that, `cargo test --features=ts-export` (or whatever the project uses to emit bindings) fails on `FileDiff` not implementing `TS`. The four nested types get the same `#[serde(rename_all = "camelCase")]` if they don't already (verify per the actual existing decorators at planner-time implementation; the diff/parser file is mostly serde-shaped today). Rust never deserializes its own response payload — IPC flows one direction here. The `#[serde(rename_all = "camelCase")]` is load-bearing — the frontend consumes `response.fileDiff` / `response.oldText` / `response.newText` / `response.rawDiff`. The `#[cfg_attr(test, derive(ts_rs::TS))]` + `#[cfg_attr(test, ts(export))]` pair matches the existing pattern that gates ts-rs binding generation behind the test build profile. The existing `FileDiff` shape is preserved so callers that only need parsed hunks keep working — `raw_diff` is the unified-diff text we already produce internally, exposing it is the bridge that PR2's `extractHunkPatch()` will reuse.

**Producer changes** inside `get_git_diff_inner()`. The semantics mirror what each `git diff` invocation actually compares:

| Caller mode                                                                               | What `git diff` compares | `old_text` source                                             | `new_text` source                     |
| ----------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- | ------------------------------------- |
| `staged=false`, tracked file                                                              | index → working tree     | `git show :<oldPath>` (index version)                         | filesystem read of `<cwd>/<newPath>`  |
| `staged=true`, tracked file                                                               | HEAD → index             | `git show HEAD:<oldPath>` (HEAD version)                      | `git show :<newPath>` (index version) |
| `staged=true`, newly-added file (no HEAD version)                                         | nothing → index          | `""` (no prior version exists at HEAD)                        | `git show :<newPath>` (index version) |
| Untracked file (the `git diff --no-index /dev/null <path>` fallback at `mod.rs:998–1001`) | nothing → working tree   | `""` (no prior version exists)                                | filesystem read of `<cwd>/<newPath>`  |
| Deleted file (diff shows deletion)                                                        | prior → nothing          | `git show <ref>:<oldPath>` per the staged/unstaged rule above | `""` (file no longer exists)          |

Rename-aware path selection is **critical**. For renames (and copies) the working-tree path differs from the path at the diff's base; using the new path for a HEAD/index lookup raises `fatal: path '<newPath>' does not exist`. Pull both paths from the parsed `FileDiff`:

- `<oldPath>` = `file_diff.old_path.unwrap_or(file_diff.file_path)` — feed to `git show`.
- `<newPath>` = `file_diff.new_path.unwrap_or(file_diff.file_path)` — feed to the filesystem read or the index-side `git show :<newPath>`.

`raw_diff` is the unified-diff stdout we already capture before parsing — stash and return untouched.

The three operations are wrapped in the same `tokio::time::timeout(Duration::from_secs(30), ...)` budget that the existing diff call uses.

**Error policy.** Distinguish _expected-empty_ from _unexpected-failure_ cases so the frontend gets accurate state and the toolbar's loading/error/data branches stay sharp:

- **Expected-empty** (return `Ok` with the empty string):
  - Untracked file's `old_text` (no prior version exists by definition).
  - Newly-added staged file's `old_text` (no version exists at HEAD).
  - Deleted file's `new_text` (file is gone from the working tree by definition).
  - **Detection rules** (the current Rust parser's `new_path` is `None` for _both_ renames and ordinary modifications, so it cannot be used as a deletion signal):
    - Untracked: the `--no-index /dev/null <path>` fallback at `mod.rs:998–1001` was taken — already a distinguishable code path in the producer.
    - Newly-added (staged): the raw unified-diff header contains `--- /dev/null` (git's canonical "no prior version" marker) AND `staged=true`. Equivalent runtime check: probe `git rev-parse HEAD:<oldPath>` and treat non-zero exit as "no prior version" rather than letting `git show` raise the error case.
    - Deletion: the raw unified-diff header contains the `+++ /dev/null` line (git's canonical deletion marker) OR the working-tree filesystem check (`std::fs::metadata(<cwd>/<newPath>).is_err()`) confirms the file is gone. Use the header check primarily — it is cheap, deterministic, and avoids racing with concurrent filesystem changes.
- **Unexpected failure** (return `Err`, surface to the frontend's existing error card):
  - `git show <ref>:<path>` failing with anything other than the rename-induced "path does not exist" (covered by the `oldPath`/`newPath` rule above).
  - Filesystem read of a tracked, non-deleted file failing (disk error, permission denied).
  - `git diff` itself timing out or returning non-zero.

This rule applies identically to the Vite dev middleware below — divergence between the two paths is the bug Section 4.2's earlier draft risked.

**Existing tests** under `crates/backend/tests/` need updates wherever they assert on `FileDiff` directly; the response shape changes from `FileDiff` to `GetGitDiffResponse { file_diff: FileDiff, ... }`. Add at least one new integration test that asserts `old_text` / `new_text` are non-empty for a tracked-file modification and empty for an untracked file's `old_text`.

**Vite dev parity.** Per the Chunk 1 codex review, the `gitApiPlugin` middleware in `vite.config.ts` must produce the same `GetGitDiffResponse` shape _and_ apply the same staged-vs-unstaged / rename / expected-empty / unexpected-failure rules so dev and production cannot drift. Update its `/api/git/diff` route to (sketch — final implementation must mirror the Rust error policy above):

```ts
const rawDiff = await git.diff(buildGitDiffArgs({ safePath, staged, baseBranch }))
const parsed = parseDiff(rawDiff, safePath)
const oldPath = parsed.oldPath ?? safePath
const newPath = parsed.newPath ?? safePath
const isUntracked = /* detected from rawDiff being a --no-index fallback or empty */
const isDeleted = /* detected from parsed.hunks containing only removed lines AND no working-tree file */

let oldText = ''
if (!isUntracked) {
  // staged → HEAD; unstaged → index. Expected-empty stays empty; any other
  // failure throws and produces a 500 the frontend surfaces as an error card.
  const ref = staged ? `HEAD:${oldPath}` : `:${oldPath}`
  oldText = await git.show([ref])
}

let newText = ''
if (!isDeleted) {
  if (staged) {
    // tip of a staged diff is the index version, not the working tree.
    newText = await git.show([`:${newPath}`])
  } else {
    newText = await fs.readFile(path.join(repoRoot, newPath), 'utf-8')
  }
}

res.end(JSON.stringify({ fileDiff: parsed, oldText, newText, rawDiff }))
```

The `isUntracked` / `isDeleted` flags are derived from inspecting `rawDiff` and (for deletion) checking the filesystem; they are NOT silent catch-all `try/catch` blocks — unexpected failures still propagate per the policy above.

### 4.3 TS bindings + `gitService.getDiff()` signature

The Rust→TS bindings under `src/bindings/` are generated by `ts-rs` (the `#[derive(TS)] #[ts(export)]` macro on Rust structs). PR1 regenerates them by running the existing `cargo test --features=ts-export` (or whichever command the project uses — verify by reading `crates/backend/Cargo.toml`'s `[features]` section and the existing binding files' timestamps vs. their source Rust structs). New file: `src/bindings/GetGitDiffResponse.ts`.

**`gitService.getDiff()`** return type changes from `Promise<FileDiff>` to `Promise<GetGitDiffResponse>`. All three implementations (`MockGitService`, `HttpGitService`, `DesktopGitService` at `src/features/diff/services/gitService.ts:7–171`) update in lockstep. The mock service synthesizes `oldText` / `newText` from its fixture content.

**`useFileDiff` hook** at `src/features/diff/hooks/useFileDiff.ts:18–79` widens its return shape from `{ diff: FileDiff | null, loading, error }` to `{ response: GetGitDiffResponse | null, loading, error }`. The `diff` field becomes a derived getter (`response?.fileDiff`) so any caller that only needs the parsed `FileDiff` keeps working with one extra `?.` dereference. PR1 grep-and-update each call site (today there are two: `DiffPanelContent.tsx` and one test).

### 4.4 `DiffPanelContent` → `<MultiFileDiff>` render

`src/features/diff/components/DiffPanelContent.tsx:254–281` currently dispatches the right pane to `<DiffViewer fileDiff={diff} viewMode="unified" />`. PR1 replaces the entire conditional ladder with `<MultiFileDiff>` plus a small adapter, gated by the responsive width-band logic from Section 4.8.

**Adapter** lives at `src/features/diff/services/pierreAdapter.ts` (new file). One function:

```ts
import type { FileContents } from '@pierre/diffs'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface PierreFileInputs {
  oldFile: FileContents
  newFile: FileContents
}

export const toPierreInputs = (
  response: GetGitDiffResponse
): PierreFileInputs => {
  const { fileDiff, oldText, newText } = response
  // Filename drives Pierre's Shiki language inference. oldPath/newPath
  // may differ on rename — pick newPath when present so the language
  // matches what the user sees today.
  const newName = fileDiff.newPath ?? fileDiff.filePath
  const oldName = fileDiff.oldPath ?? newName
  return {
    oldFile: { name: oldName, contents: oldText },
    newFile: { name: newName, contents: newText },
  }
}
```

**`DiffPanelContent` render** becomes (replacing lines 249–281):

```tsx
const inputs = response ? toPierreInputs(response) : null
// ... existing toolbar state (diffStyle, theme, etc.) lives in `DiffChipToolbar` —
//     hoisted here as a controlled prop pair for the render.

<div className="flex min-w-0 flex-1 overflow-auto">
  {error ? (
    <ErrorCard message={error.message} />
  ) : loading ? (
    <LoadingCard />
  ) : inputs ? (
    tooNarrow ? (
      <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
    ) : (
      <MultiFileDiff
        oldFile={inputs.oldFile}
        newFile={inputs.newFile}
        options={{
          diffStyle: effectiveDiffStyle,
          theme,
          diffIndicators,
          lineDiffType,
          overflow,
          disableLineNumbers,
          disableBackground,
          disableFileHeader,
          stickyHeader,
        }}
        style={{ display: 'block', width: '100%' }}
      />
    )
  ) : null}
</div>
```

`<ErrorCard>` and `<LoadingCard>` extract the existing inline JSX at `DiffPanelContent.tsx:255–272` into named components inside the same file (or under `components/`). `<DiffNarrowPlaceholder>` is described in Section 4.8.

The deleted files — `DiffViewer.tsx`, `SplitDiffView.tsx`, `UnifiedDiffView.tsx`, `DiffLine.tsx`, `DiffHunkHeader.tsx` — are removed in the same PR. Their imports come out; their tests are addressed in Section 4.10.

### 4.5 New toolbar primitives: `src/features/diff/components/toolbar/`

The spike's in-file `PriorityPlus`, `Dropdown`, `Segmented`, `Toggle` get promoted to feature-local files. Decision: feature-local (under `src/features/diff/components/toolbar/`) rather than truly shared (`src/components/`) until a second consumer appears — re-evaluate when the next feature reaches for one of them. Per the established split, files are:

```
src/features/diff/components/toolbar/
├── PriorityPlus.tsx              # generic overflow wrapper
├── PriorityPlus.test.tsx
├── Dropdown.tsx                  # floating-ui-portal popover dropdown
├── Dropdown.test.tsx
├── Segmented.tsx                 # pill segmented control
├── Segmented.test.tsx
├── Toggle.tsx                    # pill toggle (boolean)
├── Toggle.test.tsx
├── DiffChipToolbar.tsx           # the composed toolbar (Section 4.6)
├── DiffChipToolbar.test.tsx
└── index.ts                      # public exports
```

Each primitive is copied verbatim from `PierreDiffsDemo.tsx` (the spike already validated the public API), trimmed of fixture references, and given a test file. The `OverflowMenu` helper currently inside `PriorityPlus` stays a private component within `PriorityPlus.tsx`.

**`Dropdown` generic constraint.** Spike uses `<T extends string>`. Production widens to `<T extends string | number>` so the same primitive can drive non-string enums later (e.g. an integer "context lines" picker) without forking. Same change for `Segmented`.

**`PriorityPlus` measurement.** The spike's two-phase Phase A → Phase B logic ships unchanged. The chip-space reservation constant (`44 px`) and gap (`gap-x-3` = 12 px) are factored into named exports `OVERFLOW_CHIP_WIDTH_PX` and `OVERFLOW_GAP_PX` so the toolbar test can assert against them.

**Test surface per primitive:**

- `PriorityPlus.test.tsx`: simulate container resize via a stubbed ResizeObserver; assert visible-vs-hidden item split for several width scenarios including the chip-space-reservation edge case.
- `Dropdown.test.tsx`: render, open via click, navigate options, select; assert portal target is `document.body`; assert outside-click closes.
- `Segmented.test.tsx`: render, click each option, assert `onChange` is called with the right value; assert active styling.
- `Toggle.test.tsx`: render, click, assert `aria-pressed` flips and `onChange` is called.

### 4.6 Pierre options chip toolbar (`DiffChipToolbar`)

`DiffChipToolbar.tsx` is the composed toolbar — the production analog of `PierreDiffsDemo.tsx`. It replaces `DiffToolbar.tsx` entirely. State for every option lives here as a controlled-component pair (`value`, `onChange`), surfaced upward to `DiffPanelContent` so the same option values drive both the toolbar UI and the `<MultiFileDiff options={...}>` props.

**Composition** uses `PriorityPlus` with `maxRows = 1`. Children in declared priority order (highest first — last to overflow into `…`):

1. `<Segmented>` `split / unified` — driven by `effectiveDiffStyle` (read) and `setDiffStyle` (write).
2. `<Dropdown label="highlight">` — `lineDiffType` (`word-alt | word | char | none`).
3. `<Dropdown label="theme">` — `DiffsThemeNames` enumeration (`pierre-dark`, `pierre-dark-soft`, `pierre-light`, `pierre-light-soft`, `catppuccin-mocha`, `dracula`, `github-dark`, `one-dark-pro`).
4. `<Dropdown label="indicators">` — `classic / bars / none`.
5. `<Dropdown label="overflow">` — `scroll / wrap`.
6. `<Toggle label="line numbers">` — `disableLineNumbers` inverted.
7. `<Toggle label="background tint">` — `disableBackground` inverted.
8. `<Toggle label="file header">` — `disableFileHeader` inverted.
9. `<Toggle label="sticky header">` — `stickyHeader`.

Hunk navigation + Stage/Discard chips (Section 4.7) interleave at fixed positions — see that section for ordering.

**Default values** (initial state on first mount; no persistence in v1):

| Option               | Default         | Note                                                                              |
| -------------------- | --------------- | --------------------------------------------------------------------------------- |
| `diffStyle`          | `'split'`       | Wider panes get two columns by default; auto-coerced to `'unified'` below 720 px. |
| `theme`              | `'pierre-dark'` | Closest fit to Obsidian Lens.                                                     |
| `lineDiffType`       | `'word'`        | Most legible intra-line highlight for code.                                       |
| `diffIndicators`     | `'classic'`     | `+` / `-` glyphs — matches CLI `git diff` output.                                 |
| `overflow`           | `'scroll'`      | Long lines horizontal-scroll; wrap opt-in.                                        |
| `disableLineNumbers` | `false`         | Line numbers on.                                                                  |
| `disableBackground`  | `false`         | Add/remove row tint on.                                                           |
| `disableFileHeader`  | `false`         | File-name header visible.                                                         |
| `stickyHeader`       | `true`          | File header pins while scrolling — helps long diffs.                              |

**Visual language.** Toolbar container, segmented control, dropdown chips, toggle pills, popover surfaces all use the Tailwind class groups documented in the decision record's "Visual language (Obsidian Lens conformance)" section. Test fixtures snapshot the relevant class strings so a stray token rename gets caught.

### 4.7 Hunk navigation + Stage / Discard chip placeholders

The existing `DiffToolbar.tsx` ships prev/next hunk arrows, a `X HUNKS` counter, and Stage / Discard / Discard All buttons. PR1 reproduces these as chips on `DiffChipToolbar` so visual parity is preserved when PR1 lands without PR2; they are non-functional placeholders until PR2 wires the IPC.

**Chips and PriorityPlus positions** (interleaved into the list from Section 4.6):

| Position | Chip          | Type                                    | PR1 behavior                                                           | PR2 behavior                                                                                                                                                                                     |
| -------- | ------------- | --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2        | `prev hunk`   | icon button (`chevron_left`)            | `disabled` (no-op)                                                     | walks `(focusedHunkIndex - 1) mod hunks.length` and updates `selectedLines` to scroll Pierre                                                                                                     |
| 3        | `hunk N/M`    | counter chip (text)                     | reads `M = fileDiff.hunks.length` from `response`, `N = 1` placeholder | `N` tracks current focused hunk                                                                                                                                                                  |
| 4        | `next hunk`   | icon button (`chevron_right`)           | `disabled`                                                             | walks `(focusedHunkIndex + 1) mod hunks.length`                                                                                                                                                  |
| 5        | `stage`       | icon button (`add_box`)                 | `disabled` + tooltip "Available in PR2"                                | dispatches `stage_file(path, hunkPatch)`                                                                                                                                                         |
| 6        | `unstage`     | icon button (`indeterminate_check_box`) | `disabled` + tooltip "Available in PR2"                                | dispatches `unstage_file(path, hunkPatch)` — visible only on the **staged** diff view; on unstaged diffs this chip is omitted entirely (the unstage operation doesn't apply to unstaged changes) |
| 7        | `discard`     | icon button (`backspace`)               | `disabled` + tooltip "Available in PR2"                                | dispatches `discard_file(path, hunkPatch, scope=Unstaged)`                                                                                                                                       |
| 8        | `discard all` | icon button (`delete_sweep`)            | `disabled` + tooltip "Available in PR2"                                | dispatches `discard_file(path, scope=Unstaged)` (no `hunkPatch`); confirmation popover required                                                                                                  |

These slot into the priority order from Section 4.6 BEFORE the option dropdowns / toggles — hunk-level controls outrank options when space is scarce. Updated full priority order:

1. `split / unified`
2. `prev hunk`
3. `hunk N/M`
4. `next hunk`
5. `stage`
6. `discard`
7. `discard all`
8. `highlight`
9. `theme`
10. `indicators`
11. `overflow`
12. `line numbers` toggle
13. `background tint` toggle
14. `file header` toggle
15. `sticky header` toggle

**Disabled chip styling.** `bg-surface-container/20 text-on-surface-variant/40 cursor-not-allowed`. Tooltip on hover (via existing `<Tooltip>`) carries the "Available in PR2" copy. This keeps the UI visually complete from PR1's first commit; users see what's coming.

### 4.8 Responsive width bands + auto split→unified coercion

The spike's three-band responsive design ships as-is. Constants live at the top of `DiffChipToolbar.tsx`:

```ts
// Below this, split's two columns get too cramped to read; the chip toolbar
// silently coerces diffStyle to 'unified'. User's saved preference is not
// overwritten — widening the pane back restores split.
const SPLIT_MIN_WIDTH_PX = 720

// Below this, even unified is too narrow to be useful. The diff body is
// replaced with a placeholder; the toolbar stays mounted and interactive
// so the user can still adjust options.
const DIFF_MIN_WIDTH_PX = 360
```

A single `ResizeObserver` mounted on `DiffPanelContent`'s right-pane wrapper drives both bands. Computed in `DiffPanelContent`:

```ts
const splitForced = diffStyle === 'split' && paneWidth < SPLIT_MIN_WIDTH_PX
const effectiveDiffStyle: DiffStyle = splitForced ? 'unified' : diffStyle
const tooNarrow = paneWidth > 0 && paneWidth < DIFF_MIN_WIDTH_PX
```

`effectiveDiffStyle` is passed BOTH to the `<Segmented>` chip's `value` prop (so the highlighted pill reflects what's actually rendering) AND to `<MultiFileDiff options.diffStyle>`. The `setDiffStyle` writer always updates `diffStyle` directly — coercion never overwrites the saved preference.

**`<DiffNarrowPlaceholder>`** is a tiny component at `src/features/diff/components/DiffNarrowPlaceholder.tsx`:

```tsx
export const DiffNarrowPlaceholder = ({
  min,
}: {
  min: number
}): ReactElement => (
  <div
    role="status"
    className="flex flex-col items-center justify-center gap-2 px-4 py-10 rounded-lg bg-surface-container-low/40 text-on-surface-variant text-center"
  >
    <span className="material-symbols-outlined text-2xl leading-none opacity-70">
      unfold_more
    </span>
    <p className="text-xs leading-snug">
      Pane is too narrow to render the diff.
    </p>
    <p className="text-[0.65rem] opacity-70 leading-snug">
      Widen to ≥ {min}px to view changes.
    </p>
  </div>
)
```

Co-located test asserts both copy lines render with the passed `min` value.

### 4.9 Spike teardown

The following code is deleted in PR1, in the same commit that lands the production renderer:

- `src/spikes/` (entire directory): `PierreDiffsSpike.tsx`, `PierreDiffsDemo.tsx`, `PierreDiffsDemo.test.tsx` if one was added.
- `src/App.tsx`: revert to the pre-spike one-liner shape (`<WorkerPoolContextProvider><WorkspaceView /></WorkerPoolContextProvider>` per Section 4.1). Remove the `Suspense + lazy` import gate and the `?spike=pierre-diffs` URL handling.
- `src/features/diff/components/DiffPanelContent.tsx`: remove the `SPIKE_PIERRE_DIFFS` constant (line 21-ish) and the `import { PierreDiffsDemo }` line. The right-pane conditional ladder is replaced by Section 4.4's `<MultiFileDiff>` block, not gated by any spike flag.
- `docs/spikes/pierre-diffs/` (fixtures): leave on disk since this directory is machine-local-excluded via `.git/info/exclude` and never tracked. No git operation needed; per-machine cleanup is optional. The decision record stays in `docs/decisions/` regardless.

Verify after teardown: `npm run type-check` clean, `npm run build` clean (production bundle includes `@pierre/diffs` + worker; no references to the spike module survive in the bundle).

### 4.10 Test migration

**Delete** (no longer exist after PR1):

- `src/features/diff/components/DiffViewer.test.tsx`
- `src/features/diff/components/SplitDiffView.test.tsx`
- `src/features/diff/components/UnifiedDiffView.test.tsx`
- `src/features/diff/components/DiffLine.test.tsx`
- `src/features/diff/components/DiffHunkHeader.test.tsx`
- `src/features/diff/components/DiffToolbar.test.tsx` (replaced by `toolbar/DiffChipToolbar.test.tsx`)

**Add**:

- Five primitive tests under `src/features/diff/components/toolbar/` (Section 4.5).
- `DiffChipToolbar.test.tsx`: render with each default; click each chip; assert `onChange` propagates; assert disabled chips are non-interactive in PR1.
- `pierreAdapter.test.ts`: assert `toPierreInputs` correctly maps `GetGitDiffResponse` to `{ oldFile, newFile }` including the rename case (`oldPath !== newPath`).
- `DiffPanelContent.test.tsx` updated: smoke test that `<MultiFileDiff>` renders when `response` is populated; placeholder renders when `paneWidth < DIFF_MIN_WIDTH_PX`; loading / error states still render.
- `DiffNarrowPlaceholder.test.tsx`: copy + accessibility role.

**Coverage target.** Each new primitive: 100% statement coverage (small files). `DiffChipToolbar` + `DiffPanelContent`: 80% (matches the existing repo target per `rules/CLAUDE.md`). `pierreAdapter`: 100% — the function is small and pure.

**E2E.** The WebdriverIO suite at `tests/e2e/` exercises the diff pane indirectly via the workspace flow. PR1 verifies the spec by hand (start `npm run electron:dev`, open a repo, click a changed file, confirm Pierre renders with Shiki highlighting) — no new E2E added. A later PR may add a diff-pane-specific spec; it is not a PR1 gate.

## 5. PR2 — Hunk staging IPC + wiring

PR2 grows the three missing Rust IPC handlers, unstubs the frontend `gitService` methods, and wires Pierre's `diffAcceptRejectHunk` into the chip toolbar so the Stage / Discard chips (placeholders in PR1) become functional. No renderer changes; no toolbar restructure beyond removing the `disabled` styling on the staging chips.

### 5.1 Rust IPC handlers: `stage_file` / `unstage_file` / `discard_file`

Three new IPC handlers, each accepting an optional unified-diff hunk patch so the same handler covers whole-file and per-hunk operations. Land per the canonical 4-file checklist for adding a backend IPC (`crates/backend/src/git/mod.rs` inner + `crates/backend/src/git/state.rs` method + `crates/backend/src/runtime/ipc.rs` match arm + `electron/backend-methods.ts` allowlist) — forgetting the `ipc.rs` arm leaves unit tests passing while the UI silently fails on invocation.

**Request types** added to `crates/backend/src/git/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct StageFileRequest {
    pub cwd: String,
    pub path: String,
    /// Unified-diff hunk patch. `None` ⇒ whole-file stage; `Some` ⇒
    /// per-hunk stage applied via `git apply --cached`.
    pub hunk_patch: Option<String>,
}

// UnstageFileRequest reuses the same fields. DiscardFileRequest adds one
// field to disambiguate whole-file scope — see below.
```

`DiscardFileRequest` is shaped slightly differently because whole-file discard has three semantically distinct scopes (unstaged, staged, both) and the chip needs to pick one. v1 defaults to "unstaged" (matches `git checkout -- <path>` semantics — the most common diff-tool default and the least destructive):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiscardFileRequest {
    pub cwd: String,
    pub path: String,
    pub hunk_patch: Option<String>,
    /// Whole-file scope. Ignored when `hunk_patch` is `Some` (per-hunk
    /// discard always targets the same diff the hunk came from — the
    /// chip is rendered per-diff so the scope is implicit).
    #[serde(default)]
    pub scope: DiscardScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum DiscardScope {
    /// `git checkout -- <path>` — discards working-tree changes only.
    /// The "Discard All" chip on an unstaged diff sends this (the v1 default).
    #[default]
    Unstaged,
    /// `git reset HEAD -- <path>` followed by `git checkout HEAD -- <path>`
    /// — unstages then discards. Sent only by the staged-diff chip.
    Both,
}
```

`DiscardScope::Both` is reserved for a future "discard a staged diff entirely" chip — v1 ships only `Unstaged` (the chip is only rendered on the unstaged diff view). Mixed-state files (both staged and unstaged changes on the same file) require two operations: discard unstaged here, plus separately unstage via the existing unstage chip. Document this in the chip tooltip.

**Inner functions** in `mod.rs` (sketch — the actual existing wrapper is `run_git_with_timeout(Command) -> Result<Output, String>` at `crates/backend/src/git/mod.rs:22`; it takes a fully-built `tokio::process::Command` rather than a `(cwd, args, stdin)` triplet, and it does NOT currently support stdin piping — patches must be piped by building the Command with `.stdin(Stdio::piped())` and writing to `child.stdin` before awaiting the output via a small new helper, OR by writing the patch to a tempfile and using `git apply --whitespace=nowarn -` semantics):

```rust
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::AsyncWriteExt;

/// New helper co-located in mod.rs. Builds a Command with stdin piped,
/// writes the patch, and reuses run_git_with_timeout for the timeout +
/// stderr capture path. Avoids the tempfile detour for hot-path
/// stage/unstage operations.
async fn run_git_apply_with_patch(
    cwd: &std::path::Path,
    args: &[&str],
    patch: &str,
) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args).stdin(Stdio::piped());
    // run_git_with_timeout consumes the Command; we need to write to
    // stdin first, so we spawn manually and feed the patch before awaiting.
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(patch.as_bytes())
            .await
            .map_err(|e| format!("stdin write failed: {e}"))?;
    }
    // Wrap the rest in the same 30s timeout pattern run_git_with_timeout uses.
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "git apply timed out after 30s".to_string())?
    .map_err(|e| format!("git apply wait failed: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(())
}

pub(crate) async fn stage_file_inner(req: StageFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;  // existing helper
    match &req.hunk_patch {
        None => {
            // Whole-file: git add <path>.
            let mut cmd = Command::new("git");
            cmd.current_dir(&cwd).args(["add", "--", &req.path]);
            run_git_with_timeout(cmd).await.map(|_| ())?;
        }
        Some(patch) => {
            run_git_apply_with_patch(&cwd, &["apply", "--cached", "--whitespace=nowarn"], patch).await?;
        }
    }
    Ok(())
}

pub(crate) async fn unstage_file_inner(req: StageFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;
    match &req.hunk_patch {
        None => {
            let mut cmd = Command::new("git");
            cmd.current_dir(&cwd).args(["reset", "HEAD", "--", &req.path]);
            run_git_with_timeout(cmd).await.map(|_| ())?;
        }
        Some(patch) => {
            run_git_apply_with_patch(&cwd, &["apply", "--cached", "--reverse", "--whitespace=nowarn"], patch).await?;
        }
    }
    Ok(())
}

pub(crate) async fn discard_file_inner(req: StageFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;
    match &req.hunk_patch {
        None => {
            // Whole-file: branch on tracked vs untracked. git checkout fails
            // for untracked files; git clean removes them.
            let is_untracked = git_status_porcelain_is_untracked(&cwd, &req.path).await?;
            let mut cmd = Command::new("git");
            cmd.current_dir(&cwd);
            if is_untracked {
                cmd.args(["clean", "-f", "--", &req.path]);
            } else {
                cmd.args(["checkout", "--", &req.path]);
            }
            run_git_with_timeout(cmd).await.map(|_| ())?;
        }
        Some(patch) => {
            run_git_apply_with_patch(&cwd, &["apply", "--reverse", "--whitespace=nowarn"], patch).await?;
        }
    }
    Ok(())
}
```

`git_status_porcelain_is_untracked` is a small helper added in this PR — runs `git status --porcelain=v1 -z -- <path>` and checks if the status code is `??`. The `--whitespace=nowarn` flag suppresses noisy warnings on patches whose context lines happen to introduce trailing-whitespace deltas (without it, applying the same patch twice in a session can spam stderr).

**Validation contract for mutating handlers.** A bad caller (a buggy renderer or a maliciously crafted IPC payload) must not be able to mutate paths outside the workspace or commit a patch that touches an unrelated file. Each handler validates BEFORE calling git:

1. **Repo-relative path.** `req.path` is run through the same canonicalize-and-confine helper used by the existing read-side `get_git_diff` (`validate_cwd` resolves the workspace; the path is then resolved relative to the workspace and rejected if it escapes via `..` traversal or symlinks).
2. **Patch-targets-the-claimed-file invariant.** When `req.hunk_patch` is `Some`, parse the patch header — `--- a/<path>` and `+++ b/<path>` lines — and assert at least one of those paths equals (or is rename-equivalent to) `req.path`. A patch that names a different file is rejected before invoking `git apply`. The invariant is loose for renames (the patch header may name `oldPath` while `req.path` is `newPath`); compare against both candidates from `file_diff.old_path` / `new_path` if needed.
3. **Single-file patch.** Reject any patch whose body contains a second `diff --git` header — multi-file patches are out of scope for hunk operations and signal a malformed caller.

These checks live in a new `validate_hunk_patch(req: &StageFileRequest) -> Result<(), String>` helper called at the top of each `*_inner`. Failure short-circuits with a clear error string the frontend surfaces.

**4-file checklist application** (each row is a required edit; missing one is the failure mode flagged in the memory record):

| File                                  | Edit                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/backend/src/git/mod.rs`       | Add `StageFileRequest` + the three `*_inner` async functions above + the small `run_git_apply_with_patch` helper + `git_status_porcelain_is_untracked` helper.                                                                                                                                                                                                       |
| `crates/backend/src/runtime/state.rs` | (Real path — `crates/backend/src/git/state.rs` does NOT exist; the project keeps the runtime/IPC state aggregator in `crates/backend/src/runtime/state.rs`.) Add three `pub async fn stage_file / unstage_file / discard_file` methods on `BackendState` that call the corresponding `_inner` from the `git` module. Match the existing `get_git_diff` method shape. |
| `crates/backend/src/runtime/ipc.rs`   | Add three match arms in the IPC router dispatching `"stage_file"` / `"unstage_file"` / `"discard_file"` to the new state methods. Deserialize the request body to `StageFileRequest`, serialize the `Result<(), String>` to the IPC response.                                                                                                                        |
| `electron/backend-methods.ts`         | Append `'stage_file'`, `'unstage_file'`, `'discard_file'` to the allowed-methods array (the preload bridge enforces this allowlist before forwarding to the Rust sidecar — missing it returns "method not allowed" at runtime even though the Rust side is wired).                                                                                                   |

### 5.2 Frontend `gitService` unstub + `extractHunkPatch` reuse

The existing stubs at `src/features/diff/services/gitService.ts:161–171` look like:

```ts
async stageFile(_file: ChangedFile, _hunkIndex?: number): Promise<void> {
  return Promise.reject(new Error('not implemented'))
}
// ... same shape for unstageFile, discardChanges
```

**Signature change.** PR2 widens the three service methods to take an already-extracted patch string (the service has no way to access `rawDiff` from the response — that lives one layer up in the consumer). New signature:

```ts
async stageFile(file: ChangedFile, hunkPatch?: string): Promise<void>
async unstageFile(file: ChangedFile, hunkPatch?: string): Promise<void>
async discardChanges(file: ChangedFile, hunkPatch?: string): Promise<void>
```

Whole-file operation = omit `hunkPatch`; per-hunk = pass the unified-diff string. This is a breaking change vs. the existing `hunkIndex?: number` signature, but the only call sites today are the (still wired-up but no-op) PR1 chip handlers, which PR2 updates in lockstep.

**Implementations:**

- `DesktopGitService` (production Electron): each calls `invoke('stage_file' | 'unstage_file' | 'discard_file', { cwd, path, hunkPatch })`. The IPC contract matches `StageFileRequest` from Section 5.1.
- `HttpGitService` (dev): each POSTs to `/api/git/stage` / `/api/git/unstage` / `/api/git/discard` with `{ path, hunkPatch }` JSON body. The routes already exist in `gitApiPlugin`'s middleware (`vite.config.ts`) and were partially implemented (`hunkIndex` plumbing); PR2 rewrites them to mirror the same `path` + `hunkPatch` contract using `simple-git`'s `git.add()` + `git.raw(['apply', '--cached', '-'], ...)` patterns.
- `MockGitService`: each resolves immediately so component tests don't hit the network.

**`hunkPatch` derivation** happens at the call site (in `DiffPanelContent` — see Section 5.3), not inside the service. The existing `extractHunkPatch()` utility at `src/features/diff/services/gitPatch.ts:56–77` takes a unified-diff text + hunk index and returns `string | null` (nullable on out-of-range index / empty diff / non-integer input). The consumer has `response.rawDiff` in hand from the `useFileDiff` hook (Section 4.3); it computes `const hunkPatch = extractHunkPatch(response.rawDiff, hunkIndex)`. **The consumer must handle `null`** — if the helper returns `null`, surface a non-fatal toast ("Could not isolate this hunk — try refreshing the diff.") and skip the IPC. Only when `hunkPatch` is a non-empty string does the consumer call `service.stageFile(file, hunkPatch)`. This keeps the service layer pure and avoids threading the raw-diff string through state that has no other use for it.

**Dev middleware `git apply` mechanics.** `simple-git.raw([...])` does NOT accept a stdin parameter; using it for `git apply` from a patch string is not possible. The dev middleware (`gitApiPlugin` in `vite.config.ts`) takes the same spawn-with-stdin approach as the Rust side: spawn `git apply --cached -` via Node's `child_process.spawn`, write the patch to the child's stdin, await the exit code, surface stderr as the error string. Tempfile fallback (write patch to a temp file, run `git apply --cached <tempfile>`, unlink) is an acceptable alternative if stdin piping ever proves flaky on Windows — pick one approach and stick with it for both stage and unstage operations.

### 5.3 Click-to-IPC flow — refresh-on-success (v1)

**No optimistic UI in v1.** Pierre's `<MultiFileDiff>` accepts `oldFile` / `newFile` as inputs and computes its own `FileDiffMetadata` internally — it does NOT accept a controlled `FileDiffMetadata` prop. (`<FileDiff>` from `@pierre/diffs/react` does, but switching from `<MultiFileDiff>` to `<FileDiff>` for the controlled-metadata path adds the burden of computing the metadata via `parseDiffFromFile` ourselves on every change.) Pierre's `diffAcceptRejectHunk(diff, hunkIndex, options)` helper at `node_modules/@pierre/diffs/dist/utils/diffAcceptRejectHunk.d.ts` returns updated metadata for the _visual_ accept/reject state — useful for an optimistic UI flow but not load-bearing for v1 correctness.

PR2 v1 uses the simpler refresh-on-success pattern: click fires the IPC, on success the existing `useFileDiff` / `useGitStatus` data layer refetches and `<MultiFileDiff>` re-renders with the new content. Perceived latency is the IPC round-trip + the git operation (~150–500 ms in profiling). The chip shows a small spinner during the await. Optimistic-UI integration (via `<FileDiff>` + `diffAcceptRejectHunk`) is a v2 enhancement listed in Section 9 risks/follow-ups.

**Flow on Stage chip click for a specific hunk:**

1. User clicks the `stage` chip while a hunk is focused (focus index tracked by `DiffChipToolbar` state, set by the prev/next chip handlers from Section 4.7).
2. **Map Pierre's hunk to a raw-diff hunk by line range, NOT by index.** Pierre internally uses the bundled `diff` package (jsdiff) to compute hunks from `oldText` / `newText`; the Rust git source produces hunks via the system `git diff` algorithm. The two engines can split the same change into a different number of hunks (different context-line grouping, different rename detection), so `pierreHunkIndex` is NOT guaranteed to equal the index into `response.fileDiff.hunks`. The mapping is by line range:
   ```ts
   const pierreHunk = /* current focused Pierre hunk; see "focused hunk tracking" below */
   const matchingIndex = response.fileDiff.hunks.findIndex(
     (h) => h.newStart === pierreHunk.newStart && h.newLines === pierreHunk.newLines
   )
   if (matchingIndex === -1) {
     // Pierre split this hunk differently from git — common when a change
     // contains an unchanged interior gap of length below git's
     // context-line threshold. v1 surfaces a toast and asks the user to
     // pick a different operation; v2 may generate the patch from the
     // pierreHunk's range directly (see Section 9.1 follow-up).
     showToast('Pierre split this hunk differently than git — cannot stage this region with the per-hunk button. Use Discard All or the file-level chip.')
     return
   }
   ```
3. **Extract the hunk patch in the consumer (`DiffPanelContent`):**
   ```ts
   const hunkPatch = extractHunkPatch(response.rawDiff, matchingIndex)
   if (hunkPatch === null) {
     showToast('Could not isolate this hunk — try refreshing the diff.')
     return
   }
   ```
4. **Fire the IPC:**
   ```ts
   try {
     setStaging(true)
     await gitService.stageFile(file, hunkPatch)
     // useFileDiff and useGitStatus both refetch on success — Pierre
     // re-renders with the new content, file list updates the modified count.
     await refetchDiff()
     await refetchGitStatus()
   } catch (error) {
     // Surface via existing error-card pattern.
   } finally {
     setStaging(false)
   }
   ```
5. The chip's pressed state is `staging` (spinner via `material-symbols-outlined progress_activity` rotating). Clicks during the await are dropped — single-flight per file is enforced by the `staging` boolean.

**Unstage** flow is identical with `gitService.unstageFile(file, hunkPatch)`.

**Discard** (per-hunk) is identical with `gitService.discardChanges(file, hunkPatch)`.

**Discard All** (whole-file) calls `gitService.discardChanges(file)` (omitting `hunkPatch`). For safety, this chip prompts a confirmation in a `<Tooltip interactive>` popover before dispatching — "Discard all changes to `<filename>`? This cannot be undone." with `Confirm` / `Cancel` buttons. The other chips have no confirmation (consistent with git's CLI behavior — `git reset`, `git apply --cached` are reversible).

**Per-hunk `prev` / `next` navigation** (the chips placeholder-disabled in PR1) becomes functional in PR2 by tracking the focused hunk index as toolbar state and driving Pierre's viewport via the **`selectedLines` controlled prop** on `<MultiFileDiff>` (Pierre does not expose an imperative `setSelectedLines` on the React `useFileDiffInstance` handle — it only returns `{ ref, getHoveredLine }` per `node_modules/@pierre/diffs/dist/react/utils/useFileDiffInstance.d.ts`). Flow:

```ts
const focusedHunk = response.fileDiff.hunks[focusedHunkIndex]
// Pick the side based on hunk type — a deletion-only hunk has no
// `additions` rows, so selecting on `additions` would land nowhere.
const side: SelectionSide =
  focusedHunk.newLines === 0 ? 'deletions' : 'additions'
const startLine =
  side === 'deletions' ? focusedHunk.oldStart : focusedHunk.newStart
const lineCount =
  side === 'deletions' ? focusedHunk.oldLines : focusedHunk.newLines

// SelectedLineRange.end is inclusive per Pierre's convention — use
// `start + lines - 1`, NOT `start + lines`.
const selectedLines: SelectedLineRange = {
  start: startLine,
  end: startLine + Math.max(lineCount - 1, 0),
  side,
}
<MultiFileDiff ... selectedLines={selectedLines} />
```

**Caveat on scroll behavior.** Pierre's `selectedLines` prop sets the selection (the row gets a highlight ring); whether the change causes a viewport scroll-into-view depends on Pierre's internal behavior, which v1 does not assume. If the selected hunk is off-screen and Pierre does not auto-scroll, PR2's manual E2E surfaces it and we add a follow-up that explicitly scrolls the diff container to the selected element via DOM `Element.scrollIntoView({ behavior: 'smooth', block: 'center' })` once Pierre's render has settled. The selection itself is the source-of-truth state for the "focused hunk"; the scroll is presentation polish.

The prev/next chips update `focusedHunkIndex` via state — `(prev + hunks.length - 1) % hunks.length` and `(prev + 1) % hunks.length`. Hunk counter chip displays `${focusedHunkIndex + 1}/${hunks.length}`.

**Unstage flow** uses the same `extractHunkPatch` → null-check → `gitService.unstageFile(file, hunkPatch)` → refetch-on-success pattern. The chip is omitted entirely on the unstaged diff view (per the chip table above — there is nothing to "unstage" on an unstaged change). On the staged diff view, the same prev/next/counter chips apply with `unstage` instead of `stage`; `discard` and `discard all` retain their semantics but operate against the staged side (`DiscardScope::Both` — unstage + discard — is the natural mapping; v1 specifies `Both` for the staged-diff chip).

### 5.4 Tests

- `crates/backend/tests/`: add integration tests for each of the three new IPC handlers, covering:
  - Whole-file stage of a modified tracked file.
  - Per-hunk stage with a valid patch.
  - Per-hunk stage with a stale patch (e.g. the working tree changed after the diff was captured) — assert the `Err(String)` is surfaced cleanly.
  - Discard of an untracked file (uses `git clean` branch, not `git checkout`).
  - Whole-file discard of a modified tracked file.
- `src/features/diff/services/gitService.test.ts`: unstub the existing skipped tests; assert each service method routes to the right IPC method name with the right payload shape.
- `src/features/diff/services/pierreAdapter.test.ts` (extend from PR1): add tests that verify the `HunkData.startLine → DiffHunk.newStart` mapping function handles renames, multi-hunk files, and the `rawIndex === -1` defensive path.
- `DiffChipToolbar.test.tsx` (extend): the previously-disabled Stage / Discard / Discard All chips now invoke service methods; assert dispatch happens with the expected arguments. Assert that on resolved-success the `staging` boolean clears AND `refetchDiff` / `refetchGitStatus` are called once. (No optimistic-UI assertion in v1 — Pierre re-renders after the refetch completes; the flip is data-driven not optimistic.)
- Manual E2E (no automation gate): run `npm run electron:dev`, modify a tracked file with multiple distinct hunks, stage one hunk via the chip, verify `git status --short` shows partial staging, unstage it back, discard one hunk, verify the working tree updates.

## 6. PR3 — Inline review comments → active agent panel

PR3 adds the third user-visible capability: clicking on a diff row opens a small composer; user types a comment; the comment renders inline as an annotation on Pierre's diff; user accumulates multiple comments across files; clicking "Finish feedback" sends the batch into the currently-focused coding agent's terminal session as a formatted prompt. The mechanism reuses the existing `write_pty` IPC — no new agent-bridge IPC is added, because agents in Vimeflow are CLI processes running in PTY sessions whose stdin is already exposed to the frontend.

### 6.1 Pierre `DiffLineAnnotation<T>` + `renderAnnotation` integration

Pierre's React types expose two shapes (`node_modules/@pierre/diffs/dist/types.d.ts`):

```ts
type DiffLineAnnotation<T = undefined> = {
  side: AnnotationSide // 'deletions' | 'additions'
  lineNumber: number
} & OptionalMetadata<T>

interface DiffBasePropsReact<LAnnotation> {
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode
  // ...
}
```

We pick our own `T` for the metadata payload — Pierre carries it back to us in the `renderAnnotation` callback. PR3's `T` is:

```ts
interface ReviewComment {
  /** Stable id (uuid). Used for edit + delete + batch dedup. */
  id: string
  /** Plain-text comment body. v1 has no rich-text or markdown rendering inside Vimeflow. */
  text: string
  /** Author identifier — always 'self' in v1; reserved for multi-user future. */
  author: 'self'
  /** Local creation timestamp. Used for "edited" indicators and stable sort. */
  createdAt: number
}
```

`<MultiFileDiff>` receives `lineAnnotations: DiffLineAnnotation<ReviewComment>[]` and `renderAnnotation` from the toolbar layer (state owner — Section 6.2). The callback renders a small chip below the affected line:

```tsx
const renderAnnotation = (
  annotation: DiffLineAnnotation<ReviewComment>
): ReactNode => (
  <ReviewCommentRow
    comment={annotation.metadata}
    onEdit={(text) => updateAnnotation(annotation.metadata.id, { text })}
    onDelete={() => removeAnnotation(annotation.metadata.id)}
  />
)
```

**Capturing new comments.** Pierre exposes line click events via the `InteractionManager` (per `node_modules/@pierre/diffs/dist/managers/InteractionManager.d.ts`). We attach a `onDiffLineClick` handler that opens a small popover composer anchored to the clicked line:

- User clicks any line on the additions or deletions side → popover opens with a textarea and `Add comment` button.
- Confirm → push a new `DiffLineAnnotation<ReviewComment>` onto the per-diff state (Section 6.2). Pierre re-renders with the new annotation row visible.
- Cancel → close, no state change.

`ReviewCommentRow` (a new component under `src/features/diff/components/`) renders the comment text + small `edit` / `delete` icon buttons + a faint timestamp. Edit opens the same popover composer pre-filled; Delete removes the annotation from state immediately (no confirmation — comments are pre-send, low-stakes).

### 6.2 Feedback batch state + "Finish feedback" UI

State lives at `DiffPanelContent` (it already owns `useFileDiff` and the toolbar state; annotations are per-`(cwd, file)` key just like the diff itself):

```ts
type FeedbackBatch = Map<
  /* batchKey: `${cwd}::${filePath}` */ string,
  DiffLineAnnotation<ReviewComment>[]
>

// Total count helper — never trust Map.size alone, because empty arrays
// for a previously-commented file would otherwise count as "1 file with 0
// comments" and show `Finish feedback (0)` after the user deletes the last
// comment on a file.
const totalAnnotations = (batch: FeedbackBatch): number =>
  Array.from(batch.values()).reduce((sum, list) => sum + list.length, 0)
```

The batch is **per-workspace**, not per-file — switching between changed files preserves annotations made on other files. Cleared on three triggers: explicit "Finish feedback" send, explicit "Discard feedback" button, or workspace cwd change. **Empty-list housekeeping:** when removing the last annotation for a file, delete the Map key entirely (don't leave an empty `[]`) so iterating the batch (e.g. for the "comments across M files" label) reports correct file counts.

**Toolbar chip** is inserted into `DiffChipToolbar` at priority 5 (between hunk nav and Pierre options — so it survives narrow-pane overflow). Visibility and label are both driven by `totalAnnotations(batch)`, not `batch.size`:

| State                           | Chip label                                                | Disabled? | Action                                           |
| ------------------------------- | --------------------------------------------------------- | --------- | ------------------------------------------------ |
| `totalAnnotations(batch) === 0` | —                                                         | hidden    | not in toolbar                                   |
| `totalAnnotations(batch) > 0`   | `Finish feedback (N)` where `N = totalAnnotations(batch)` | enabled   | open the send-confirmation popover (Section 6.3) |
| Sending                         | `Sending…`                                                | disabled  | spinner via `progress_activity` icon             |

A second small chip `Discard feedback` (low priority — last in toolbar, first to overflow into `…`) shows whenever `totalAnnotations(batch) > 0`. Click → confirmation popover ("Discard all N comments?") → clears the batch.

**Soft cap.** Section 3.2 #8 caps a batch at 50 comments silently. Implementation: when an "Add comment" submission would push the batch past 50, the popover's `Add` button is disabled with a tooltip "Batch limit reached — finish or discard the current feedback before adding more." The cap is per-batch (across all files), not per-file.

### 6.3 Active agent identification — which **pane** owns the diff?

The receiver is a **pane**, not a session. Vimeflow's workspace model puts cwd / agent-detection / PTY identity on panes (sessions contain a pane graph). `write_pty` targets a PTY id, which is a pane-level identifier. A session with multiple panes can host multiple agents, each on its own pane PTY — feedback must land on the right one.

**v1 rule for "the active agent panel that owns the diff"**:

```
candidate panes = panes within the current workspace's session set where:
  - pane.cwd matches diff.cwd (exact match or descendant per agentCwdHint
    — same rule as the Section 6.3 spike's session-level draft)
  - AND pane has a detected agent (Claude Code or Codex) per the per-pane
    agent watcher (`useAgentStatus` is per-pane today; verify the hook's
    actual scope at planner-time implementation)
  - AND pane.status === 'running' (the agent process is live)

if candidates is empty → "Finish feedback" dispatch fails with toast:
  "No coding agent is active in this workspace. Start `claude` or `codex` in a terminal pane."

if candidates contains exactly one → use it. silent. write_pty targets pane.ptyId.

if candidates contains multiple →
  if FocusedPaneContext.focusedPaneId is in candidates → use it.
  else → open a small picker popover listing candidates by their pane tab name
         + agent label, user picks one, batch sends to that pane's PTY.
```

The rule is stable and explainable. No new IPC is needed for resolution — both the pane graph and the focus index are already in frontend state under `src/features/sessions/` and `src/features/workspace/`.

### 6.4 Send mechanism — reuse `write_pty`, no new IPC

The terminal feature exposes `write_pty(sessionId, data)` over IPC — the same channel that user keystrokes flow through (`src/features/terminal/`). For PR3 we format the feedback batch into a markdown-shaped prompt and write it as a single chunk:

```
> Inline review feedback (3 comments across 2 files):
>
> src/features/diff/components/DiffPanelContent.tsx:124 (additions)
> ─ Should this branch handle the `isUntracked` case before checking `staged`?
>
> src/features/diff/components/DiffPanelContent.tsx:218 (deletions)
> ─ This conditional is gone — is the loading state still reachable?
>
> crates/backend/src/git/mod.rs:472 (additions)
> ─ Add a defensive timeout here. The current 30s is per-operation, not per-batch.
>
> ―
> Please address these and reply when done.
```

The framing prefix (`> ` lines) makes the message visually distinct in the terminal scrollback and signals "this is from the diff reviewer" to both the user and the agent. The trailing `―` (horizontal bar) + closing line makes it look like a coherent block rather than dribbled-out keystrokes.

**Multi-line input submission.** A naive `write_pty(paneId, message + '\n')` is wrong — most line-oriented CLIs treat each embedded `\n` as Enter (submit) so a 9-line feedback block becomes 9 separate prompts, half of which are syntactically broken. The dispatch wraps the message in **bracketed paste mode** escape sequences (`ESC [ 200 ~ … ESC [ 201 ~`), which both `claude` and `codex` REPLs honor as "paste this whole chunk as one input, no per-line Enter":

```ts
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const payload = `${PASTE_START}${formattedBatch}${PASTE_END}\n`
await writePty(paneId, payload)
```

The trailing `\n` after `PASTE_END` is the single submit. If a future agent surfaces that doesn't honor bracketed paste (untested at spec-time), the dispatch grows an adapter switch per `crates/backend/src/agent/adapter/`: the adapter declares its preferred submission encoding (`bracketed-paste` / `line-by-line` / `none`) and the dispatch picks the matching path. v1 only ships the bracketed-paste path because both supported agents (Claude Code, Codex) handle it; the manual E2E in Section 10.3 verifies both empirically before merge.

**Receiver UI.** No new UI is added on the receiver side — the message simply appears in the existing terminal scrollback. The agent reads it via the agent watcher's existing transcript-parsing path (`crates/backend/src/agent/`) and reacts in its own UI. The agent-status panel does not need a special "received feedback" view in v1 — the existing tool-call / response stream surfaces the agent's reply.

**Failure modes:**

- Session was killed between batch start and `Finish feedback` click → `write_pty` returns an error → toast "Terminal session ended; feedback not sent." Batch is preserved so user can resend after starting a new agent.
- Agent crashed but session is alive → bytes get written into the dead shell; nothing parses them. Treat as success at the IPC layer (we did write them); user sees no agent reply and figures out the agent died. This is a known v1 limitation (Section 6.5).

### 6.5 v1 scope limits

| Capability                  | v1                                                                                                  | Future                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Comment body format         | Plain text only                                                                                     | Rich text + `@`-mentions of code symbols                           |
| Comments per batch          | Soft cap 50 (silently enforced; `Add` button disabled at cap)                                       | Configurable per workspace                                         |
| Edit after send             | No (batch is sent then cleared)                                                                     | Append-only edits with a "revised" tag                             |
| Threaded replies            | No                                                                                                  | Agent reply threading + resolution state                           |
| Attachments / images        | No                                                                                                  | Drag-image-onto-line UX, base64 in payload                         |
| Cross-file batch viewer     | The send-confirmation popover lists "N comments across M files" but no full pre-send review surface | A modal that lets the user re-read / edit / delete before send     |
| Persist batch across reload | No (lives in React state)                                                                           | Persist to `app_data_dir` per workspace                            |
| Multi-agent fan-out         | No (single agent receives)                                                                          | Send the same batch to all matching candidates                     |
| Read-receipt / agent ack    | No (fire-and-forget)                                                                                | The active agent emits an acknowledgement event the panel consumes |
| Internationalization        | English-only strings                                                                                | i18n sweep (deferred per Section 3.2 #7)                           |

## 7. Theme strategy

### 7.1 v1 — `pierre-dark` everywhere

v1 ships `pierre-dark` as the only registered Shiki theme. The chip-toolbar theme dropdown still lists the Pierre + Shiki bundled themes (`pierre-dark`, `pierre-dark-soft`, `pierre-light`, `pierre-light-soft`, `catppuccin-mocha`, `dracula`, `github-dark`, `one-dark-pro`) so users can switch live, but the default and the worker pre-load only include `pierre-dark` — switching to a non-pre-loaded theme triggers Pierre's on-demand load and a brief shimmer the first time. Acceptable for v1; pre-loading all eight themes would multiply the worker initialization cost for no proven benefit.

### 7.2 Follow-up — Catppuccin-from-tokens Shiki theme

`pierre-dark` is the closest pre-built fit to the Obsidian Lens but is not the same palette. The follow-up (separate spec, not blocked on this integration) derives a custom Shiki theme JSON from the `tailwind.config.js` Catppuccin Mocha token map and registers it at provider boot via Pierre's `registerCustomTheme` (or `registerCustomCSSVariableTheme` for runtime-themeable variant). Acceptance: side-by-side comparison of the custom theme vs. `pierre-dark` on representative TS / Rust / CSS / Markdown samples shows the custom theme matches the rest of the Vimeflow UI (file explorer, agent panel, code editor) within a perceptible drift budget.

### 7.3 Light-mode handoff

Pierre's `theme` option accepts `ThemesType = { dark: DiffsThemeNames; light: DiffsThemeNames }` for paired dark/light themes. v1 hard-codes the single dark theme — there is no light theme work in this spec because Vimeflow has no light-mode toggle today. When a light mode lands (future spec), the chip-toolbar's theme dropdown gets a new "auto" option that flips to passing the `{ dark, light }` pair, and the worker pre-load grows to both themes.

## 8. License and attribution

### 8.1 License inventory for the new dependency chain

| Package                      | License      | Source                                                              |
| ---------------------------- | ------------ | ------------------------------------------------------------------- |
| `@pierre/diffs`              | Apache-2.0   | <https://github.com/pierrecomputer/pierre/tree/main/packages/diffs> |
| `@pierre/theme` (transitive) | Apache-2.0   | Same monorepo.                                                      |
| `@shikijs/transformers`      | MIT          | Shiki monorepo.                                                     |
| `shiki`                      | MIT          | Shiki monorepo.                                                     |
| `hast-util-to-html`          | MIT          | unified collective.                                                 |
| `lru_map`                    | MIT          | npm.                                                                |
| `diff`                       | BSD-3-Clause | npm.                                                                |

No copyleft anywhere. Apache-2.0 is the only non-MIT/BSD entry and it adds the standard patent-grant clause plus the NOTICE-preservation requirement on redistribution. Vimeflow's own license (verify against `LICENSE` at the repo root at planner-time implementation; the integration does not change that license) is permissive and compatible.

### 8.2 Attribution mechanics

- **Development.** `node_modules/@pierre/diffs/LICENSE.md` is preserved by `npm install` — no action needed for `npm run electron:dev` or contributor workflow.
- **Packaged AppImage release** (when the project ships a binary). PR1 adds a `THIRD_PARTY.md` at the repo root that lists the direct + transitive license-relevant deps with their copyright lines. The AppImage build pipeline copies that file into the bundle (path TBD per the existing `electron-builder` config). For Apache-2.0 packages specifically, the upstream `NOTICE` file (if present) gets included verbatim alongside.
- **Source distribution / GitHub release tarball.** Same `THIRD_PARTY.md` is part of the tracked repo; no extra build step.

### 8.3 No CLA / copyright assignment

`@pierre/diffs` is consumed via npm. There is no Contributor License Agreement to sign and no copyright assignment back to Pierre Computer Company.

## 9. Risks and mitigations

| Risk                                                                                                                                                                         | Likelihood | Impact                       | Mitigation                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pierre minor-version API change between `^1.2.2` and a future install breaks toolbar / nav code                                                                              | Medium     | Medium (compile errors)      | Pin to `~1.2.2` (only patch updates allowed) during PR1; widen to `^1` after a stable usage period. Renovate / dependabot picks up breaking updates with explicit human review.                                                                           |
| `<MultiFileDiff>` re-render on every diff refetch causes visible flicker                                                                                                     | Medium     | Low–Medium (UX polish)       | `<MultiFileDiff>` memo-stable across same-input renders. Pass `cacheKey` derived from `(filePath, gitObjectId)` in `FileContents` so Pierre can skip re-tokenization. Profile in PR1 — if perceptible, add a small fade-transition.                       |
| Worker pool cold-start adds noticeable delay on first file open                                                                                                              | Medium     | Low                          | The pool initializes once at provider mount (App boot). By the time the user clicks a file, the worker is warm. Profile cold-start; if > 500 ms, pre-warm with an empty tokenize at boot.                                                                 |
| Production bundle weight grows beyond AppImage size budget                                                                                                                   | Low–Medium | Medium                       | Pierre's worker bundle is a separate Vite asset (Section 4.1) so it doesn't bloat the main chunk. Track `dist/assets/*.js` byte size in the PR1 description; if total grows > 1 MB, escalate to a separate bundle-size optimization task.                 |
| Theme drift — `pierre-dark` looks subtly off against the rest of Vimeflow                                                                                                    | Medium     | Low (cosmetic)               | Tracked as the Section 7.2 follow-up. Not a v1 blocker.                                                                                                                                                                                                   |
| Pierre re-renders blow main-thread budget on the largest files in a real repo                                                                                                | Low        | Medium                       | Pierre offers `<Virtualizer>` (Section 3.2 #2). Add it as a small follow-up when a measured regression appears — `<MultiFileDiff>` props are the same shape, the wrapper is mechanical.                                                                   |
| Existing component tests (`DiffLine` / `SplitDiffView` / `UnifiedDiffView` / `DiffHunkHeader` / `DiffViewer` / `DiffToolbar`) deletion churn-hides bugs in their replacement | Low        | Medium                       | The new primitive tests (Section 4.5 + 4.10) cover the same behaviors at the primitive layer. Coverage report comparison in the PR1 description shows total coverage delta.                                                                               |
| `extractHunkPatch` returns `null` more often than expected with Pierre's reformulated diff                                                                                   | Low        | Low                          | The consumer's null branch (Section 5.3 step 3) surfaces a non-fatal toast; user retries by refreshing the diff. Add a Sentry-style log if we ever instrument production.                                                                                 |
| Optimistic UI is missed by users who expected an instant chip flip                                                                                                           | Low–Medium | Low (perceived sluggishness) | Section 9 follow-up: switch `<MultiFileDiff>` to `<FileDiff>` with controlled `FileDiffMetadata`, drive optimistic flips via `diffAcceptRejectHunk`, parallel-call the IPC; revert metadata on IPC failure. Estimated 1–2 days of work; not a v1 blocker. |
| Agent feedback message format is interpreted as code by the agent's REPL parser (e.g. the leading `>` lines trigger a quote-block edit mode)                                 | Low        | Medium                       | Test with both Claude Code and Codex; if either interprets `> ` as a special prefix, switch to a different framing (e.g. `[REVIEW]` lines). Caught by the manual E2E in Section 5.4 + PR3's own E2E.                                                      |
| `write_pty` race — terminal session dies between batch open and "Finish feedback" click                                                                                      | Low        | Low                          | Section 6.4 already specifies the toast on `write_pty` error and preserves the batch for resend.                                                                                                                                                          |
| Settings / persistence will need to migrate this spec's in-memory state into the settings dialog (#252)                                                                      | Certain    | Low                          | This spec deliberately stays in component state to avoid blocking on #252. Migration is a small wrap-with-persistence task whenever #252 lands.                                                                                                           |

### 9.1 Known follow-up specs (deferred, not blocking)

1. **Optimistic UI for Stage / Discard.** Switch `<MultiFileDiff>` → `<FileDiff>` with controlled `FileDiffMetadata`. Wire `diffAcceptRejectHunk` for the flip; revert on IPC failure.
2. **Catppuccin-from-tokens Shiki theme.** Per Section 7.2.
3. **Virtualization wrapper for large files.** Per Section 3.2 #2.
4. **Settings-dialog integration.** Persist toolbar prefs (#252).
5. **Agent reply acknowledgement.** Receiver UI in agent-status panel that surfaces "agent received your feedback at HH:MM:SS" once the agent emits a known ack token.
6. **`@pierre/trees` swap** for `ChangedFilesList`. Per the decision record.

## 10. Acceptance criteria

### 10.1 PR1 — Renderer replacement

A PR1 commit is mergeable when ALL of:

- [ ] `<MultiFileDiff>` from `@pierre/diffs/react` renders against real `useFileDiff` data inside `DiffPanelContent`'s right pane (no `<DiffViewer>` / `<SplitDiffView>` / `<UnifiedDiffView>` / `<DiffLine>` / `<DiffHunkHeader>` remains in the codebase).
- [ ] Shiki syntax highlighting is visible on a TS file diff (the most common file type) — colors per the `pierre-dark` theme.
- [ ] Word-level intra-line diffs are visible on a line with renamed identifiers (`let count = useState(initial)` → `const [count, setCount] = useState(initial)` shows `let` → `const [`, `count` → `[count, setCount]` highlighted at word granularity).
- [ ] The chip toolbar (`DiffChipToolbar.tsx`) replaces `DiffToolbar.tsx` end-to-end; `DiffToolbar.tsx` is deleted from the repo.
- [ ] Priority+ overflow folds chips into `…` at narrow widths; the `…` chip never wraps to its own row (chip-space reservation works).
- [ ] At width < 720 px, split mode auto-coerces to unified silently; saved preference returns at ≥ 720 px.
- [ ] At width < 360 px, the diff body is replaced with `<DiffNarrowPlaceholder>`; the toolbar stays interactive.
- [ ] `<WorkerPoolContextProvider>` is mounted at `App.tsx`; `npm run build` produces a separate `dist/assets/pierre-worker-*.js` asset.
- [ ] Stage / Discard / Discard All chips are visible on the toolbar (per Section 4.7) but rendered `disabled` with a tooltip "Available in PR2".
- [ ] Spike scaffolding deleted: `src/spikes/` is gone; `SPIKE_PIERRE_DIFFS` is gone from `DiffPanelContent.tsx`; `App.tsx` has no `?spike=pierre-diffs` URL gate or `Suspense + lazy` for the spike.
- [ ] Rust `GetGitDiffResponse` returns correct `oldText` / `newText` / `rawDiff` for all five Section-4.2 caller modes (covered by new integration tests).
- [ ] Vite dev middleware produces the identical `GetGitDiffResponse` shape; spot-checked manually by running `npm run dev` and confirming `<MultiFileDiff>` renders.
- [ ] All five deleted-component tests gone; new primitive + adapter + placeholder tests in place; total feature coverage ≥ existing baseline.
- [ ] `npm run type-check`, `npm run lint`, `npm run test`, `npm run build` all green.
- [ ] Manual E2E: open a repo with at least one renamed file in the diff; confirm Pierre renders it correctly using the rename-aware `oldPath` → `git show HEAD:<oldPath>` lookup.
- [ ] No production-build regression — `nvim` / `htop` still render in the terminal pane (sanity-check that PR1 didn't undo PR [#249](https://github.com/winoooops/vimeflow/pull/249)).

### 10.2 PR2 — Hunk staging IPC + wiring

- [ ] Three new Rust IPC handlers (`stage_file` / `unstage_file` / `discard_file`) per the 4-file checklist; integration tests assert correct behavior for whole-file + per-hunk + untracked + deleted + rename scenarios.
- [ ] Frontend `gitService.stageFile / unstageFile / discardChanges` unstubbed; signature changed to `(file, hunkPatch?: string)`; existing call sites updated; new tests cover dispatch with both shapes.
- [ ] Chip toolbar's `disabled` styling lifts on Stage / Discard / Discard All / prev hunk / next hunk / hunk counter. All five become functional.
- [ ] `extractHunkPatch` null-branch is exercised (test fakes a returned `null`; consumer surfaces toast; no IPC call).
- [ ] Manual E2E: modify a tracked TS file with 3 distinct hunks; stage hunk #2 via the chip; `git status --short` shows partial staging; unstage; discard hunk #1; working tree updates.
- [ ] Discard All chip prompts the confirmation popover; cancel preserves the working tree; confirm dispatches `discard_file(path, scope=Unstaged)`.
- [ ] `npm run type-check`, `lint`, `test`, `build` green.

### 10.3 PR3 — Inline review comments → active agent panel

- [ ] Clicking a diff row opens the inline composer; submitting adds a `ReviewComment` annotation that renders below the row.
- [ ] Edit / delete on an existing annotation works inline.
- [ ] Toolbar "Finish feedback (N)" chip appears when `totalAnnotations(batch) > 0`, hides when 0, shows correct `N`.
- [ ] "Finish feedback" send-confirmation popover shows "N comments across M files" with the correct counts (M never includes empty-list keys).
- [ ] Active-agent identification rule (Section 6.3) resolves correctly across the three cases: no candidates → toast; one candidate → silent; multiple → picker.
- [ ] Send dispatches `write_pty` with the formatted message + trailing `\n`. Manual E2E: run `claude` in a terminal, add comments, finish feedback, confirm message appears in scrollback and Claude responds.
- [ ] Failure mode: kill the agent terminal between batch and send; chip surfaces "Terminal session ended; feedback not sent." and the batch is preserved.
- [ ] Soft cap: 50th comment can be added; 51st attempt has `Add` disabled with the explanatory tooltip.
- [ ] `npm run type-check`, `lint`, `test`, `build` green.

## 11. References

- Decision record: [`docs/decisions/2026-05-23-pierre-diffs-renderer.md`](../../decisions/2026-05-23-pierre-diffs-renderer.md) — library choice, options rejected, locked design.
- Tracking issue: [#255](https://github.com/winoooops/vimeflow/issues/255) — original integration ticket.
- Tooltip primitive: [`docs/decisions/2026-04-22-tooltip-library.md`](../../decisions/2026-04-22-tooltip-library.md) — same `@floating-ui/react` pattern as the toolbar dropdowns.
- Recent terser fix: [#249](https://github.com/winoooops/vimeflow/pull/249) — production-build sanity check for PR1.
- Library docs + live examples: <https://diffs.com>
- Source: <https://github.com/pierrecomputer/pierre/tree/main/packages/diffs>
- Pierre Computer Company: <https://pierre.computer>
- Hunk (alternative considered): <https://github.com/modem-dev/hunk>
- IPC 4-file checklist memory: `~/.claude/projects/-home-will-projects-vimeflow/memory/reference_new_ipc_checklist.md`
- Agent CWD detection memory: `~/.claude/projects/-home-will-projects-vimeflow/memory/feedback_widen_detection_over_changing_third_party.md`

<!-- codex-reviewed: 2026-05-24T11:14:38Z -->
