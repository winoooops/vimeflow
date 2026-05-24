# Pierre Diffs Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-app diff renderer (`src/features/diff/components/DiffViewer.tsx` + its split / unified / line / hunk-header subtree) with `@pierre/diffs/react`'s `<MultiFileDiff>`, grow the missing Rust hunk-staging IPC, and add an inline review-comment loop that ships per-line user feedback to the focused agent pane's PTY via bracketed-paste.

**Architecture:** Three sequential PRs on the `feat/pierre-diffs-integration` branch. PR1 swaps the renderer + introduces the chip toolbar + tears down the spike. PR2 wires the three new Rust IPC handlers + activates the staging chips. PR3 layers annotations on Pierre and routes the batch to the focused agent pane. Each PR is independently shippable. The spec at `docs/superpowers/specs/2026-05-24-pierre-diffs-integration-design.md` is the single source of truth for design decisions — this plan implements it.

**Tech Stack:** React 19 + TypeScript + Vite (frontend), Electron 42 + Rust sidecar via tokio (backend), `@pierre/diffs@^1.2.2` (Apache-2.0) for diff rendering, `@floating-ui/react` (already a project dep) for dropdown popovers, `ts-rs` (test-gated) for Rust→TS bindings, `simple-git` for the Vite dev middleware.

**Spec:** `docs/superpowers/specs/2026-05-24-pierre-diffs-integration-design.md` (codex-reviewed 2026-05-24)

**Decision record:** `docs/decisions/2026-05-23-pierre-diffs-renderer.md`

**Tracking issue:** [#255](https://github.com/winoooops/vimeflow/issues/255)

---

## Scope and PR strategy

Three PRs, **sequential** — PR2 depends on PR1's response shape changes; PR3 depends on PR1's `<MultiFileDiff>` mount. Each PR opens against `main`, lands its own commits on `feat/pierre-diffs-integration` (or a fresh branch off `main` per PR if reviewers prefer cleaner history), and is reviewable in isolation. A merged PR1 is a strict UX improvement even if PR2 / PR3 never land — Stage / Discard chips are visible but `disabled` with tooltips noting "Available in PR2".

After all three PRs merge, the spike scaffolding currently on this branch (`src/spikes/`, the `SPIKE_PIERRE_DIFFS` flag in `DiffPanelContent.tsx`, the `?spike=pierre-diffs` URL gate in `App.tsx`) is gone — it is torn down inside PR1.

## File structure

### PR1 — Renderer replacement

**Create:**

- `src/features/diff/components/toolbar/PriorityPlus.tsx` — overflow wrapper (promoted from spike, single-row only)
- `src/features/diff/components/toolbar/PriorityPlus.test.tsx`
- `src/features/diff/components/toolbar/Dropdown.tsx` — floating-ui portal-rendered popover dropdown
- `src/features/diff/components/toolbar/Dropdown.test.tsx`
- `src/features/diff/components/toolbar/Segmented.tsx` — pill segmented control
- `src/features/diff/components/toolbar/Segmented.test.tsx`
- `src/features/diff/components/toolbar/Toggle.tsx` — chip-style boolean toggle
- `src/features/diff/components/toolbar/Toggle.test.tsx`
- `src/features/diff/components/toolbar/DiffChipToolbar.tsx` — composed toolbar (replaces `DiffToolbar.tsx`)
- `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx`
- `src/features/diff/components/toolbar/index.ts` — public exports + named constants (`SPLIT_MIN_WIDTH_PX`, `DIFF_MIN_WIDTH_PX`, `OVERFLOW_CHIP_WIDTH_PX`, `OVERFLOW_GAP_PX`)
- `src/features/diff/components/DiffNarrowPlaceholder.tsx` — "pane too narrow" placeholder
- `src/features/diff/components/DiffNarrowPlaceholder.test.tsx`
- `src/features/diff/services/pierreAdapter.ts` — `toPierreInputs(response)` converter
- `src/features/diff/services/pierreAdapter.test.ts`
- `src/bindings/GetGitDiffResponse.ts` — generated ts-rs binding
- `THIRD_PARTY.md` — Apache-2.0 NOTICE inventory at repo root

**Modify:**

- `crates/backend/src/git/mod.rs` — extend `get_git_diff_inner` with `oldText` / `newText` / `rawDiff`; add `GetGitDiffResponse` struct; add ts-rs derives to `FileDiff` / `DiffHunk` / `DiffLine` / `DiffLineType`
- `src/bindings/FileDiff.ts`, `src/bindings/DiffHunk.ts`, `src/bindings/DiffLine.ts`, `src/bindings/DiffLineType.ts` — regenerated bindings (existing files; ts-rs overwrites)
- `src/features/diff/services/gitService.ts` — `getDiff()` returns `Promise<GetGitDiffResponse>`; all 3 implementations update (`DesktopGitService`, `HttpGitService`, `MockGitService`)
- `src/features/diff/hooks/useFileDiff.ts` — widen return shape to `{ response, loading, error }` with derived `diff` getter
- `src/features/diff/components/DiffPanelContent.tsx` — replace conditional ladder with `<MultiFileDiff>` + `<DiffNarrowPlaceholder>` + new toolbar mount; remove `SPIKE_PIERRE_DIFFS` flag and `PierreDiffsDemo` import
- `src/App.tsx` — mount `<WorkerPoolContextProvider>`; remove `?spike=pierre-diffs` URL gate, `Suspense + lazy` for the spike
- `vite.config.ts` — extend `gitApiPlugin` `/api/git/diff` to return new shape; add `worker.format` + `worker.rollupOptions` for Pierre's worker bundle

**Delete:**

- `src/features/diff/components/DiffViewer.tsx` + `DiffViewer.test.tsx`
- `src/features/diff/components/SplitDiffView.tsx` + `SplitDiffView.test.tsx`
- `src/features/diff/components/UnifiedDiffView.tsx` + `UnifiedDiffView.test.tsx`
- `src/features/diff/components/DiffLine.tsx` + `DiffLine.test.tsx`
- `src/features/diff/components/DiffHunkHeader.tsx` + `DiffHunkHeader.test.tsx`
- `src/features/diff/components/DiffToolbar.tsx` + `DiffToolbar.test.tsx`
- `src/spikes/` (entire directory)

### PR2 — Hunk staging IPC + wiring

**Create:**

- `src/bindings/StageFileRequest.ts`, `src/bindings/DiscardFileRequest.ts`, `src/bindings/DiscardScope.ts` — generated bindings
- `crates/backend/tests/git_staging.rs` — Rust integration tests for the three IPC handlers

**Modify:**

- `crates/backend/src/git/mod.rs` — add `StageFileRequest` + `DiscardFileRequest` + `DiscardScope`; add `stage_file_inner` / `unstage_file_inner` / `discard_file_inner`; add `run_git_apply_with_patch` helper + `git_status_porcelain_is_untracked` helper + `validate_hunk_patch` helper
- `crates/backend/src/runtime/state.rs` — three new methods on `BackendState`
- `crates/backend/src/runtime/ipc.rs` — three new match arms in the IPC router
- `electron/backend-methods.ts` — append `'stage_file'` / `'unstage_file'` / `'discard_file'` to the allowlist
- `src/features/diff/services/gitService.ts` — unstub all three methods; signature changes to `(file, hunkPatch?: string)`
- `src/features/diff/services/gitService.test.ts` — unstub the skipped tests
- `src/features/diff/services/pierreAdapter.ts` — add `findRawDiffHunkIndex(response, pierreHunk)` helper for the line-range match
- `src/features/diff/services/pierreAdapter.test.ts` — extend with mapping tests
- `src/features/diff/components/DiffPanelContent.tsx` — wire chip click handlers (extract patch → null check → IPC → refetch)
- `src/features/diff/components/toolbar/DiffChipToolbar.tsx` — lift `disabled` styling on staging chips; add `staging` boolean per-file state for single-flight; add unstage chip (staged view only); add Discard All confirmation popover
- `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx` — extend with dispatch + refetch assertions
- `vite.config.ts` — finish the `gitApiPlugin` `/api/git/stage` / `/api/git/unstage` / `/api/git/discard` routes via `child_process.spawn` + stdin

### PR3 — Inline review comments

**Create:**

- `src/features/diff/components/ReviewCommentRow.tsx` — inline comment renderer
- `src/features/diff/components/ReviewCommentRow.test.tsx`
- `src/features/diff/components/ReviewCommentComposer.tsx` — popover composer (anchored to clicked line)
- `src/features/diff/components/ReviewCommentComposer.test.tsx`
- `src/features/diff/components/FinishFeedbackPopover.tsx` — pre-send confirmation + active-pane picker
- `src/features/diff/components/FinishFeedbackPopover.test.tsx`
- `src/features/diff/hooks/useFeedbackBatch.ts` — per-workspace feedback batch state
- `src/features/diff/hooks/useFeedbackBatch.test.ts`
- `src/features/diff/services/feedbackDispatch.ts` — `dispatchFeedbackBatch(batch, paneId)` formatter + write_pty caller
- `src/features/diff/services/feedbackDispatch.test.ts`
- `src/features/diff/services/activePanePicker.ts` — `resolveCandidatePanes(workspace, cwd, focusedPaneId)` per Section 6.3 rule
- `src/features/diff/services/activePanePicker.test.ts`

**Modify:**

- `src/features/diff/components/DiffPanelContent.tsx` — mount feedback batch state; pass `lineAnnotations` + `renderAnnotation` to `<MultiFileDiff>`; attach `onDiffLineClick` to open the composer
- `src/features/diff/components/toolbar/DiffChipToolbar.tsx` — add `Finish feedback (N)` + `Discard feedback` chips (visibility driven by `totalAnnotations(batch)`)
- `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx` — extend with feedback-chip assertions

---

## PR1 — Renderer Replacement

### Task 1.1 — Verify the spike's expectations against real installed APIs

Read-only checks confirming the spec's API claims hold against what's actually in `node_modules` on the implementer's machine. These will catch a Pierre version drift before any code touches the repo.

**Files:** read-only — no edits.

- [ ] **Step 1: Confirm Pierre version + exports**

Run: `node -p "JSON.parse(require('fs').readFileSync('node_modules/@pierre/diffs/package.json','utf8')).version"`

Expected: `1.2.2` (or any `^1.2` patch). If a newer minor surfaced, re-run the verification commands below before assuming the spec's API claims hold.

- [ ] **Step 2: Confirm `WorkerPoolContextProvider` shape**

Run: `grep -A 10 'declare function WorkerPoolContextProvider' node_modules/@pierre/diffs/dist/react/WorkerPoolContext.d.ts`

Expected: signature destructures `{ children, poolOptions, highlighterOptions }`.

- [ ] **Step 3: Confirm `MultiFileDiff` accepts `oldFile` / `newFile`**

Run: `grep -B 2 -A 8 'interface MultiFileDiffProps' node_modules/@pierre/diffs/dist/react/MultiFileDiff.d.ts`

Expected: `oldFile: FileContents`, `newFile: FileContents`, optional `options: FileDiffOptions<LAnnotation>`.

- [ ] **Step 4: Confirm `HunkData.hunkIndex` exists (NOT `startLine`)**

Run: `grep -A 6 'interface HunkData' node_modules/@pierre/diffs/dist/types.d.ts`

Expected: `hunkIndex: number`. Does NOT contain `startLine`.

- [ ] **Step 5: Confirm `extractHunkPatch` returns `string | null`**

Run: `grep -A 3 'export const extractHunkPatch' src/features/diff/services/gitPatch.ts`

Expected: return type `string | null`.

- [ ] **Step 6: Confirm canonical project ts-rs decorator pattern**

Run: `sed -n '85,92p' crates/backend/src/agent/types.rs`

Expected: shows the `#[derive(Debug, Clone, Serialize, Deserialize)]` + `#[cfg_attr(test, derive(ts_rs::TS))]` + `#[cfg_attr(test, ts(export))]` + `#[serde(rename_all = "camelCase")]` stack on `CostMetrics`. Copy this exact stack for the new types in Tasks 1.4 and 2.1.

If any of the above checks fail, STOP and update the spec before continuing — the planner can re-run codex against the spec to surface what changed.

### Task 1.2 — Add `THIRD_PARTY.md` and `@pierre/diffs` attribution

Land the Apache-2.0 NOTICE preservation up front (Section 8.2 of the spec) so license review can happen in parallel with the rest of PR1.

**Files:**

- Create: `THIRD_PARTY.md`

- [ ] **Step 1: Write `THIRD_PARTY.md`**

```markdown
# Third-Party Notices

This file inventories the licenses of third-party packages bundled into
the Vimeflow desktop application (the AppImage produced by
`npm run electron:build`).

## NPM dependencies

| Package                          | License      | Notes                                                                       |
| -------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `@pierre/diffs`                  | Apache-2.0   | Diff rendering library. © Pierre Computer Company.                          |
| `@pierre/theme`                  | Apache-2.0   | Transitive theme assets used by `@pierre/diffs`. © Pierre Computer Company. |
| `@floating-ui/react`             | MIT          | Tooltip / popover positioning.                                              |
| `shiki`, `@shikijs/transformers` | MIT          | Syntax-highlight tokenizer used by `@pierre/diffs`.                         |
| `hast-util-to-html`              | MIT          | HAST → HTML serializer.                                                     |
| `lru_map`                        | MIT          | LRU cache used by `@pierre/diffs`.                                          |
| `diff`                           | BSD-3-Clause | jsdiff — diff algorithm used by `@pierre/diffs`.                            |

For the full transitive list, see `package-lock.json`. Apache-2.0 packages
preserve their LICENSE / NOTICE files inside `node_modules/<package>/`
during normal `npm install`; the AppImage build copies the relevant
LICENSE files into the bundle.

## Rust dependencies

For the Rust sidecar (`vimeflow-backend`), see `Cargo.lock` and the
`LICENSE` files in each crate's source. The sidecar depends only on
MIT / Apache-2.0 / BSD-3-Clause crates as of this release.
```

- [ ] **Step 2: Commit**

```bash
git add THIRD_PARTY.md
git commit -m "docs: add THIRD_PARTY.md attribution inventory"
```

### Task 1.3 — Mount `<WorkerPoolContextProvider>` in `App.tsx` and configure Vite worker bundling

Per spec Section 4.1. Pierre's Shiki tokenization moves off the main thread from day one.

**Files:**

- Modify: `src/App.tsx`
- Modify: `vite.config.ts` (top-level `worker` field)

- [ ] **Step 1: Write a failing smoke test for the provider mount**

Create `src/App.test.tsx` (or extend if it already exists):

```tsx
import { render } from '@testing-library/react'
import App from './App'

test('App mounts inside WorkerPoolContextProvider', () => {
  const { container } = render(<App />)
  // Provider is a context provider — no visible DOM, but App should
  // mount without throwing the "WorkerPoolContextProvider missing"
  // error that Pierre raises when consumed outside the provider.
  expect(container).toBeTruthy()
})
```

Run: `npx vitest run src/App.test.tsx`

Expected: PASS today (App is a one-liner that just renders WorkspaceView). After Step 2 + 3, still PASS.

- [ ] **Step 2: Add Vite worker config**

Edit `vite.config.ts` — find the existing `defineConfig` object and add the `worker` field at the same level as `plugins` and `build`:

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

- [ ] **Step 3: Rewrite `src/App.tsx` to mount the provider**

```tsx
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { ReactElement } from 'react'
import { WorkspaceView } from './features/workspace/WorkspaceView'

// Singleton Worker factory. Pierre's worker entry is exposed as a
// dedicated package export so Vite can bundle it via `new Worker(url, ...)`.
const workerFactory = (): Worker =>
  new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
    type: 'module',
  })

const poolOptions = {
  workerFactory,
  // poolSize defaults to 8 inside Pierre — leave it unless profiling
  // shows we need different.
} as const

const highlighterOptions = {
  // Singular `theme` per WorkerRenderingOptions.
  theme: 'pierre-dark' as const,
} as const

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

- [ ] **Step 4: Type-check + smoke build**

Run: `npm run type-check && npm run build`

Expected: type-check passes; build emits `dist/assets/pierre-worker-*.js` as a separate asset (verify with `ls dist/assets | grep pierre-worker`).

- [ ] **Step 5: Confirm test still passes**

Run: `npx vitest run src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx vite.config.ts
git commit -m "feat(diff): mount Pierre WorkerPoolContextProvider in App"
```

### Task 1.4 — Extend Rust `get_git_diff` with `oldText` / `newText` / `rawDiff`

Per spec Section 4.2. The biggest single piece of work in PR1 — adds a new response type, rewrites the producer to compute the new fields with rename-aware + staged-added + deletion handling, and adds ts-rs derives to the nested types so bindings compile.

**Files:**

- Modify: `crates/backend/src/git/mod.rs`
- Modify: `crates/backend/src/runtime/state.rs` (widen the existing `get_git_diff` method's return type from `Result<FileDiff, String>` to `Result<GetGitDiffResponse, String>`)
- Modify: `crates/backend/src/runtime/ipc.rs` (verify the existing `"get_git_diff"` arm still compiles against the widened return type)
- Create: `src/bindings/GetGitDiffResponse.ts` (ts-rs generates)
- Modify: `src/bindings/FileDiff.ts`, `src/bindings/DiffHunk.ts`, `src/bindings/DiffLine.ts`, `src/bindings/DiffLineType.ts` (ts-rs regenerates)

- [ ] **Step 1: Add ts-rs derives to nested types**

In `crates/backend/src/git/mod.rs`, find the existing `FileDiff` / `DiffHunk` / `DiffLine` / `DiffLineType` struct declarations. Add the canonical decorator stack to each (copy from `crates/backend/src/agent/types.rs:85–91`):

```rust
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileDiff { /* existing fields */ }

// Same stack on DiffHunk, DiffLine, DiffLineType.
```

If any of those structs already have `#[serde(rename_all = "camelCase")]` (some do), don't double it. If they only have `#[derive(Serialize)]`, widen to `#[derive(Debug, Clone, Serialize)]`.

- [ ] **Step 2: Add the new `GetGitDiffResponse` struct**

In `crates/backend/src/git/mod.rs`, near the other public types:

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
    /// `staged`). Empty string when the file is untracked or newly added.
    pub old_text: String,
    /// New file contents at the diff's tip (index or working tree).
    /// Empty string when the file has been deleted.
    pub new_text: String,
    /// The raw unified-diff text. Reused by PR2's `extractHunkPatch()`.
    pub raw_diff: String,
}
```

- [ ] **Step 3: Add a deletion-detection helper**

```rust
/// Heuristic: the raw unified-diff header contains `+++ /dev/null` when
/// git encoded a deletion. Cheaper and more deterministic than racing
/// the filesystem.
fn raw_diff_is_deletion(raw_diff: &str) -> bool {
    raw_diff.lines().any(|line| line.starts_with("+++ /dev/null"))
}

/// Same heuristic for "no prior version at HEAD" — `--- /dev/null`.
fn raw_diff_is_new_at_base(raw_diff: &str) -> bool {
    raw_diff.lines().any(|line| line.starts_with("--- /dev/null"))
}
```

- [ ] **Step 4: Rewrite `get_git_diff_inner` to produce the new shape**

Find `get_git_diff_inner()` at `mod.rs:915–1004`. The current shape returns `Result<FileDiff, String>`; rewrite to return `Result<GetGitDiffResponse, String>`. The producer logic now also runs `git show` and reads the filesystem per the table in spec Section 4.2:

```rust
pub(crate) async fn get_git_diff_inner(req: GetGitDiffRequest) -> Result<GetGitDiffResponse, String> {
    let cwd = validate_cwd(&req.cwd)?;

    // 1. Run git diff (existing logic). Stash the raw output.
    let raw_diff = /* existing: run `git diff [--cached] -- <path>` or
                     fall back to `git diff --no-index /dev/null <path>` */;

    // 2. Parse the FileDiff (existing logic).
    let file_diff: FileDiff = parse_git_diff(&raw_diff)?;

    // 3. Resolve old/new paths with rename awareness.
    let new_path = file_diff.new_path.as_deref().unwrap_or(&file_diff.file_path);
    let old_path = file_diff.old_path.as_deref().unwrap_or(new_path);

    // 4. Compute old_text per the four-case table:
    //    - Untracked (used --no-index branch) → ""
    //    - Newly-added staged file (--- /dev/null in header AND staged=true) → ""
    //    - staged=true → `git show HEAD:<old_path>`
    //    - staged=false → `git show :<old_path>` (index version)
    let is_untracked = /* whether the --no-index fallback was taken in step 1 */;
    let is_new_at_base = raw_diff_is_new_at_base(&raw_diff);
    let old_text = if is_untracked || (req.staged && is_new_at_base) {
        String::new()
    } else {
        let ref_spec = if req.staged {
            format!("HEAD:{}", old_path)
        } else {
            format!(":{}", old_path)
        };
        let mut cmd = Command::new("git");
        cmd.current_dir(&cwd).args(["show", &ref_spec]);
        let out = run_git_with_timeout(cmd).await?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    };

    // 5. Compute new_text:
    //    - Deleted file (+++ /dev/null in header) → ""
    //    - staged=true → `git show :<new_path>` (index version)
    //    - else → filesystem read of `<cwd>/<new_path>`
    let is_deletion = raw_diff_is_deletion(&raw_diff);
    let new_text = if is_deletion {
        String::new()
    } else if req.staged {
        let mut cmd = Command::new("git");
        cmd.current_dir(&cwd).args(["show", &format!(":{}", new_path)]);
        let out = run_git_with_timeout(cmd).await?;
        String::from_utf8_lossy(&out.stdout).into_owned()
    } else {
        let abs_path = cwd.join(new_path);
        std::fs::read_to_string(&abs_path)
            .map_err(|e| format!("read {}: {}", abs_path.display(), e))?
    };

    Ok(GetGitDiffResponse {
        file_diff,
        old_text,
        new_text,
        raw_diff,
    })
}
```

The matching state-layer method in `crates/backend/src/runtime/state.rs` (whatever currently calls `get_git_diff_inner`) widens its return type from `FileDiff` → `GetGitDiffResponse`. The IPC route in `runtime/ipc.rs` propagates the new type through `serde_json::to_value`; no match-arm name change needed (the IPC method is still `"get_git_diff"`).

- [ ] **Step 5: Add Rust integration tests for the four cases**

Create `crates/backend/tests/git_diff_response.rs`. The existing in-crate `test_helpers` module at `crates/backend/src/git/test_helpers.rs` is `#[cfg(test)] mod` and `git` is private — neither is reachable from `tests/` (integration tests). Two options:

**Option A (recommended):** drive the test by spawning `git` directly via `std::process::Command` against a `tempfile::TempDir` git repo. No new public surface required; tests stay self-contained.

```rust
use tempfile::TempDir;
use std::process::Command;

fn init_repo() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let run = |args: &[&str]| {
        let status = Command::new("git").current_dir(dir.path()).args(args).status().expect("git");
        assert!(status.success(), "git {:?} failed", args);
    };
    run(&["init", "--quiet", "--initial-branch=main"]);
    run(&["config", "user.email", "test@vimeflow.test"]);
    run(&["config", "user.name", "Test"]);
    dir
}

#[tokio::test]
async fn modified_tracked_file_unstaged() {
    let dir = init_repo();
    // ... create file, commit, modify, call get_git_diff_inner, assert ...
}
```

**Option B:** promote the existing helpers to a `pub mod test_helpers` gated behind a `test-helpers` feature in `crates/backend/Cargo.toml` so integration tests can import them. Requires touching the existing module's visibility — heavier change with cross-cutting implications. Skip unless Option A's setup ergonomics become painful.

Use Option A. Cases to cover:

1. Modified tracked file, `staged=false` → `old_text` = index content, `new_text` = working-tree content (both non-empty, different).
2. Modified tracked file, `staged=true` → `old_text` = HEAD content, `new_text` = index content.
3. Newly-added staged file (`git add` for first time), `staged=true` → `old_text == ""`, `new_text` = index content.
4. Untracked file → `old_text == ""`, `new_text` = working-tree content.
5. Deleted file (`git rm` or `rm` + `git status`) → `old_text` = HEAD/index content, `new_text == ""`.
6. Renamed file (`git mv`) → `old_text` = `git show HEAD:<oldPath>`, `new_text` = working-tree at `<newPath>`.

Every case has explicit asserts on `old_text` / `new_text` / `raw_diff`. No skips, no TODOs.

- [ ] **Step 6: Run Rust tests**

Run: `cd crates/backend && cargo test --test git_diff_response`

Expected: all six cases pass. If any fail, fix the producer logic from Step 4 before continuing.

- [ ] **Step 7: Regenerate TS bindings**

The actual command in this project (per `package.json`'s `scripts`):

```bash
npm run generate:bindings
```

Which expands to `cargo test --manifest-path crates/backend/Cargo.toml export_bindings && prettier --write src/bindings/`. There is NO `ts-export` feature in `crates/backend/Cargo.toml` — the bindings are emitted by ts-rs-decorated structs being touched in the test build profile.

Expected: `src/bindings/GetGitDiffResponse.ts` is created; `src/bindings/FileDiff.ts` / `DiffHunk.ts` / `DiffLine.ts` / `DiffLineType.ts` are regenerated. Check them in with `git status`.

- [ ] **Step 8: Commit**

```bash
git add crates/backend/src/git/mod.rs crates/backend/src/runtime/state.rs crates/backend/src/runtime/ipc.rs crates/backend/tests/git_diff_response.rs src/bindings/
git commit -m "feat(diff): extend Rust get_git_diff with oldText/newText/rawDiff"
```

### Task 1.5 — Update Vite dev middleware (`gitApiPlugin`) to return the new shape

Per spec Section 4.2 dev-parity. Without this, `npm run dev` mode is broken after PR1.

**Files:**

- Modify: `vite.config.ts` (the `gitApiPlugin` function)

- [ ] **Step 1: Find the existing `/api/git/diff` handler**

In `vite.config.ts`, locate the `gitApiPlugin()` function and its `if (pathname === '/api/git/diff')` branch.

- [ ] **Step 2: Rewrite the handler per the Section 4.2 sketch**

```ts
const rawDiff = await git.diff(buildGitDiffArgs({ safePath, staged, baseBranch }))
const parsed = parseDiff(rawDiff, safePath)
const oldPath = parsed.oldPath ?? safePath
const newPath = parsed.newPath ?? safePath

// Reuse the producer-side detection heuristics.
const isUntracked = /* check whether --no-index fallback path was taken (existing logic in gitApiPlugin) */
const isNewAtBase = rawDiff.split('\n').some((line) => line.startsWith('--- /dev/null'))
const isDeletion = rawDiff.split('\n').some((line) => line.startsWith('+++ /dev/null'))

let oldText = ''
if (!isUntracked && !(staged && isNewAtBase)) {
  const ref = staged ? `HEAD:${oldPath}` : `:${oldPath}`
  oldText = await git.show([ref])
}

let newText = ''
if (!isDeletion) {
  if (staged) {
    newText = await git.show([`:${newPath}`])
  } else {
    const abs = path.join(repoRoot, newPath)
    newText = await fs.promises.readFile(abs, 'utf-8')
  }
}

res.writeHead(200, { 'Content-Type': 'application/json' })
res.end(JSON.stringify({ fileDiff: parsed, oldText, newText, rawDiff }))
```

Imports: add `import fs from 'fs'` and `import path from 'path'` if not already present.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`. In a browser, open DevTools Network tab, click a changed file in the diff panel, inspect the `/api/git/diff` response. Expected: response JSON has `fileDiff` / `oldText` / `newText` / `rawDiff` fields. Frontend will still error because the components haven't been updated yet — that's fine, the smoke is the response shape.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "feat(diff): extend Vite dev middleware to return oldText/newText"
```

### Task 1.6 — Update `gitService.getDiff` return type + `useFileDiff` hook

Per spec Section 4.3. Threads the new shape through the data layer.

**Files:**

- Modify: `src/features/diff/services/gitService.ts`
- Modify: `src/features/diff/hooks/useFileDiff.ts`
- Modify: `src/features/diff/hooks/useFileDiff.test.ts`

- [ ] **Step 1: Update `gitService.getDiff` return type**

In `src/features/diff/services/gitService.ts`, change the interface declaration:

```ts
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface GitService {
  // ... existing methods ...
  getDiff(
    file: string,
    staged?: boolean,
    untracked?: boolean
  ): Promise<GetGitDiffResponse>
}
```

Update all three implementations to return the new shape. `MockGitService` synthesizes `oldText` / `newText` / `rawDiff` from its mock fixtures (the mock already has hard-coded diffs — add the three text fields alongside).

- [ ] **Step 2: Widen `useFileDiff` return shape**

In `src/features/diff/hooks/useFileDiff.ts`, change the return type from `{ diff: FileDiff | null, loading, error }` to:

```ts
import type { FileDiff } from '../types'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface UseFileDiffReturn {
  response: GetGitDiffResponse | null
  /** Convenience derived getter for callers that only need the parsed FileDiff. */
  diff: FileDiff | null
  loading: boolean
  error: Error | null
}
```

The implementation: `diff` is `response?.fileDiff ?? null`.

- [ ] **Step 3: Update `useFileDiff.test.ts`**

Wherever the test asserts on the hook's return, it now sees `{ response, diff, loading, error }`. The `diff` derived getter still works for assertions that don't care about the new fields. Add at least one new test that asserts `response.oldText` / `response.newText` are populated when the mock returns non-empty strings.

- [ ] **Step 4: Run tests + type-check**

```bash
npx vitest run src/features/diff/hooks/useFileDiff.test.ts
npx vitest run src/features/diff/services/
npm run type-check
```

Expected: all green. Any consumers of `useFileDiff` that broke will surface in type-check — they'll be addressed in Task 1.8 (DiffPanelContent rewrite).

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/gitService.ts src/features/diff/hooks/useFileDiff.ts src/features/diff/hooks/useFileDiff.test.ts
git commit -m "feat(diff): widen gitService + useFileDiff return shape for Pierre"
```

### Task 1.7 — Build the toolbar primitives under `src/features/diff/components/toolbar/`

Per spec Section 4.5. Promotes the spike's in-file `PriorityPlus` / `Dropdown` / `Segmented` / `Toggle` to standalone, tested files.

**Files:** see "File structure → PR1 → Create" above.

- [ ] **Step 1: Copy primitives from the spike, one per new file**

The spike's `src/spikes/pierre-diffs/PierreDiffsDemo.tsx` contains the working source for all four primitives. Extract each into its own file under `src/features/diff/components/toolbar/`:

- `PriorityPlus.tsx` — includes `OverflowMenu` as a private component within the file (keep them co-located; not exported separately). Generics: `<T extends string | number>` for `Dropdown` and `Segmented` (widened from spike's `string` only) — see Section 4.5.
- `Dropdown.tsx` — imports from `@floating-ui/react` (`useFloating`, `FloatingPortal`, `useDismiss`, `useRole`, `useInteractions`, `autoUpdate`, `flip`, `offset`, `shift`). Includes the `DropdownOption<T>` interface in the same file.
- `Segmented.tsx` — chip-style pill segmented control.
- `Toggle.tsx` — chip-style boolean toggle with `material-symbols-outlined check_box / check_box_outline_blank`.

- [ ] **Step 2: Add `index.ts` with named constants**

```ts
export { PriorityPlus } from './PriorityPlus'
export { Dropdown, type DropdownOption } from './Dropdown'
export { Segmented } from './Segmented'
export { Toggle } from './Toggle'
export { DiffChipToolbar } from './DiffChipToolbar'

// Named constants used by both the toolbar itself and tests.
export const SPLIT_MIN_WIDTH_PX = 720
export const DIFF_MIN_WIDTH_PX = 360
export const OVERFLOW_CHIP_WIDTH_PX = 32 // material w-8
export const OVERFLOW_GAP_PX = 12 // gap-x-3
```

- [ ] **Step 3: Write `PriorityPlus.test.tsx`**

Use a `ResizeObserver` stub that lets the test simulate container width changes synchronously. Cover:

- All items fit → no overflow chip rendered.
- Container narrows so half the items would land on row 2 → overflow chip appears, hidden items match.
- Chip-space reservation: container is exactly wide enough for all items + chip but NOT items alone → cutoff pulls back one item so the chip fits on row 1 with the last visible item.
- Children-list changes → re-measurement triggered.

- [ ] **Step 4: Write `Dropdown.test.tsx`**

Render, click trigger, assert menu portal-renders to `document.body` (the popover should land outside the test render root). Navigate options via click, assert `onChange(value)` fires. Outside-click → menu closes.

- [ ] **Step 5: Write `Segmented.test.tsx` + `Toggle.test.tsx`**

`Segmented`: render, click each option, assert `onChange(option)` fires once with the right value; assert active option has `bg-primary text-on-primary` (use `getByRole('button', { pressed: true })` if `aria-pressed` is wired, else assert by className substring).

`Toggle`: render, click, assert `aria-pressed` toggles and `onChange(!value)` fires.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/features/diff/components/toolbar/
```

Expected: all four primitives green.

- [ ] **Step 7: Type-check + lint**

```bash
npm run type-check && npm run lint
```

Expected: clean. Common issue: `Toggle` `aria-pressed` typed as `boolean`, not `'true' | 'false'` — set as `aria-pressed={value}` is fine in React but TypeScript may want a string union; use `aria-pressed={value ? 'true' : 'false'}` if so.

- [ ] **Step 8: Commit**

```bash
git add src/features/diff/components/toolbar/
git commit -m "feat(diff): add chip-toolbar primitives (PriorityPlus, Dropdown, Segmented, Toggle)"
```

### Task 1.8 — Build `DiffChipToolbar` composing the primitives

Per spec Section 4.6 + 4.7. The composed toolbar. Holds state for every Pierre option + the hunk-nav + the staging chips (disabled placeholders in PR1).

**Files:**

- Create: `src/features/diff/components/toolbar/DiffChipToolbar.tsx`
- Create: `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx`

- [ ] **Step 1: Write `DiffChipToolbar.tsx`**

Controlled-component shape — every option is a `(value, onChange)` prop pair so `DiffPanelContent` (the state owner) drives both the chips and the `<MultiFileDiff options>` from one source of truth. Chip composition uses `<PriorityPlus maxRows={1}>` with the priority order from spec Section 4.7 (15 chips total — 1 segmented + 6 nav/staging + 4 dropdowns + 4 toggles).

The full chip list (top of file, exported as a const so tests can assert ordering):

```ts
// Priority order (highest priority first — last to overflow into …):
// 1: split/unified segmented
// 2-4: prev/next/counter hunk navigation
// 5-8: stage / unstage (staged view only) / discard / discard all
// 9-12: highlight / theme / indicators / overflow dropdowns
// 13-16: line numbers / background tint / file header / sticky header toggles
```

Render each chip in the declared order, conditionally include `unstage` only when `props.diffMode === 'staged'`. Disabled-chip styling for the staging chips in PR1: `bg-surface-container/20 text-on-surface-variant/40 cursor-not-allowed` + `<Tooltip content="Available in PR2">` wrapping.

- [ ] **Step 2: Write `DiffChipToolbar.test.tsx`**

Render with default values; assert each chip is present. Click each control type once (segmented, dropdown option, toggle); assert `onChange` fires with the right value. Render with `diffMode='unstaged'`; assert `unstage` chip is NOT in the DOM. Render at small container width; assert PriorityPlus collapses chips into `…` and the priority order from Section 4.7 holds (booleans collapse first, dropdowns next, hunk-nav stays).

- [ ] **Step 3: Run tests + type-check**

```bash
npx vitest run src/features/diff/components/toolbar/DiffChipToolbar.test.tsx
npm run type-check
```

- [ ] **Step 4: Commit**

```bash
git add src/features/diff/components/toolbar/DiffChipToolbar.tsx src/features/diff/components/toolbar/DiffChipToolbar.test.tsx
git commit -m "feat(diff): compose DiffChipToolbar from primitives (staging chips disabled in PR1)"
```

### Task 1.9 — Build `<DiffNarrowPlaceholder>` + `pierreAdapter.toPierreInputs`

Per spec Section 4.4 + 4.8.

**Files:**

- Create: `src/features/diff/components/DiffNarrowPlaceholder.tsx`
- Create: `src/features/diff/components/DiffNarrowPlaceholder.test.tsx`
- Create: `src/features/diff/services/pierreAdapter.ts`
- Create: `src/features/diff/services/pierreAdapter.test.ts`

- [ ] **Step 1: Write `DiffNarrowPlaceholder.tsx`**

```tsx
import type { ReactElement } from 'react'

interface DiffNarrowPlaceholderProps {
  min: number
}

export const DiffNarrowPlaceholder = ({
  min,
}: DiffNarrowPlaceholderProps): ReactElement => (
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

- [ ] **Step 2: Write the placeholder test**

Render with `min={360}`; assert both copy lines render; assert `role="status"` is on the root.

- [ ] **Step 3: Write `pierreAdapter.ts`**

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
  // Filename drives Pierre's Shiki language inference. On rename, use
  // each side's actual path so language inference is correct for both.
  const newName = fileDiff.newPath ?? fileDiff.filePath
  const oldName = fileDiff.oldPath ?? newName
  return {
    oldFile: { name: oldName, contents: oldText },
    newFile: { name: newName, contents: newText },
  }
}
```

- [ ] **Step 4: Write `pierreAdapter.test.ts`**

Three tests minimum:

- Modified file (`oldPath === newPath`) → both `oldName` and `newName` equal `filePath`.
- Renamed file (`oldPath !== newPath`) → `oldName` is the old path, `newName` is the new path.
- Untracked file (`oldText === ''`) → `oldFile.contents` is `''`; both names default to `filePath`.

- [ ] **Step 5: Run tests + type-check**

```bash
npx vitest run src/features/diff/components/DiffNarrowPlaceholder.test.tsx src/features/diff/services/pierreAdapter.test.ts
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/components/DiffNarrowPlaceholder.tsx src/features/diff/components/DiffNarrowPlaceholder.test.tsx src/features/diff/services/pierreAdapter.ts src/features/diff/services/pierreAdapter.test.ts
git commit -m "feat(diff): add DiffNarrowPlaceholder + pierreAdapter"
```

### Task 1.10 — Rewrite `DiffPanelContent` to render `<MultiFileDiff>` + `<DiffChipToolbar>`

Per spec Section 4.4 + 4.8. The integration moment. Removes the conditional ladder, the `SPIKE_PIERRE_DIFFS` toggle, the import of `PierreDiffsDemo`.

**Files:**

- Modify: `src/features/diff/components/DiffPanelContent.tsx`
- Modify: `src/features/diff/components/DiffPanelContent.test.tsx`

- [ ] **Step 1: Hoist toolbar state**

At the top of the `DiffPanelContent` component body, alongside existing state:

```ts
const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
const [theme, setTheme] = useState<DiffsThemeNames>('pierre-dark')
const [diffIndicators, setDiffIndicators] = useState<DiffIndicators>('classic')
const [lineDiffType, setLineDiffType] = useState<LineDiffType>('word')
const [overflowOpt, setOverflowOpt] = useState<Overflow>('scroll')
const [disableLineNumbers, setDisableLineNumbers] = useState(false)
const [disableBackground, setDisableBackground] = useState(false)
const [disableFileHeader, setDisableFileHeader] = useState(false)
const [stickyHeader, setStickyHeader] = useState(true)
```

- [ ] **Step 2: Add responsive width tracking**

```ts
const demoRef = useRef<HTMLDivElement>(null)
const [paneWidth, setPaneWidth] = useState(SPLIT_MIN_WIDTH_PX)
useLayoutEffect(() => {
  const node = demoRef.current
  if (!node) return
  const observer = new ResizeObserver((entries) => {
    setPaneWidth(entries[0].contentRect.width)
  })
  observer.observe(node)
  return () => observer.disconnect()
}, [])

const splitForced = diffStyle === 'split' && paneWidth < SPLIT_MIN_WIDTH_PX
const effectiveDiffStyle: DiffStyle = splitForced ? 'unified' : diffStyle
const tooNarrow = paneWidth > 0 && paneWidth < DIFF_MIN_WIDTH_PX
```

- [ ] **Step 3: Replace the right-pane render block**

Remove the existing conditional ladder (lines ~254–281). Remove the `SPIKE_PIERRE_DIFFS` flag (line ~21). Remove the `import { PierreDiffsDemo }` line. Replace the right pane with:

```tsx
<div ref={demoRef} className="flex min-w-0 flex-1 flex-col overflow-auto">
  <DiffChipToolbar
    diffMode={selectedFileStaged ? 'staged' : 'unstaged'}
    diffStyle={effectiveDiffStyle}
    onDiffStyleChange={setDiffStyle}
    theme={theme}
    onThemeChange={setTheme}
    /* ... all other (value, onChange) pairs ... */
  />
  {diffError ? (
    <ErrorCard message={diffError.message} />
  ) : diffLoading ? (
    <LoadingCard />
  ) : response ? (
    tooNarrow ? (
      <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
    ) : (
      <MultiFileDiff
        oldFile={toPierreInputs(response).oldFile}
        newFile={toPierreInputs(response).newFile}
        options={{
          diffStyle: effectiveDiffStyle,
          theme,
          diffIndicators,
          lineDiffType,
          overflow: overflowOpt,
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

Extract `<ErrorCard>` and `<LoadingCard>` into named components within `DiffPanelContent.tsx` (no need for separate files in v1).

- [ ] **Step 4: Update `DiffPanelContent.test.tsx`**

Adjust existing assertions to expect the new chrome. Add tests for:

- `<MultiFileDiff>` mounts when `response` is non-null and width >= 360.
- `<DiffNarrowPlaceholder>` mounts when width < 360.
- `effectiveDiffStyle === 'unified'` is passed to MultiFileDiff when width < 720 AND `diffStyle === 'split'`.
- Saved `diffStyle` preference is preserved across width changes.

- [ ] **Step 5: Run tests + type-check + build**

```bash
npx vitest run src/features/diff/components/DiffPanelContent.test.tsx
npm run type-check && npm run build
```

Expected: all green.

- [ ] **Step 6: Manual E2E**

Run `npm run electron:dev` (or `npm run dev` if testing in browser only). Open a Vimeflow workspace pointing at this repo, click a changed file (modify `src/App.tsx` if needed to have something to diff). Verify:

- `<MultiFileDiff>` renders with Shiki highlighting visible.
- Chip toolbar renders along the top, all chips clickable.
- Drag the diff pane handle narrow → at ~720 px split flips to unified silently; at ~360 px the placeholder card appears, toolbar stays interactive.

- [ ] **Step 7: Commit**

```bash
git add src/features/diff/components/DiffPanelContent.tsx src/features/diff/components/DiffPanelContent.test.tsx
git commit -m "feat(diff): render Pierre MultiFileDiff inside DiffPanelContent + chip toolbar"
```

### Task 1.11 — Spike teardown

Per spec Section 4.9. Delete every remaining artifact of the spike.

**Files:**

- Delete: `src/spikes/` (entire directory)
- Modify: `src/App.tsx` (already done in Task 1.3 — verify no `?spike=pierre-diffs` remnants)
- Modify: `src/features/diff/components/DiffPanelContent.tsx` (already done in Task 1.10 — verify no `SPIKE_PIERRE_DIFFS` remnants)

- [ ] **Step 1: Delete the spike directory**

```bash
git rm -rf src/spikes/
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -rn 'SPIKE_PIERRE_DIFFS\|spikes/pierre-diffs\|PierreDiffsDemo\|PierreDiffsSpike' src/ electron/ vite.config.ts 2>&1 | grep -v node_modules
```

Expected: no matches. If any, hunt down and remove.

- [ ] **Step 3: Type-check + build**

```bash
npm run type-check && npm run build
```

Expected: clean. Build artifact `dist/assets/*.js` contains no references to the spike module.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(diff): remove src/spikes/ scaffolding (Pierre integration is live)"
```

### Task 1.12 — Delete superseded diff components and their tests

Per spec Section 4.10.

**Files:** delete the six component files listed in "File structure → PR1 → Delete".

- [ ] **Step 1: Delete the components + their tests**

```bash
git rm src/features/diff/components/DiffViewer.tsx src/features/diff/components/DiffViewer.test.tsx
git rm src/features/diff/components/SplitDiffView.tsx src/features/diff/components/SplitDiffView.test.tsx
git rm src/features/diff/components/UnifiedDiffView.tsx src/features/diff/components/UnifiedDiffView.test.tsx
git rm src/features/diff/components/DiffLine.tsx src/features/diff/components/DiffLine.test.tsx
git rm src/features/diff/components/DiffHunkHeader.tsx src/features/diff/components/DiffHunkHeader.test.tsx
git rm src/features/diff/components/DiffToolbar.tsx src/features/diff/components/DiffToolbar.test.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -rn '<DiffViewer\|<SplitDiffView\|<UnifiedDiffView\|<DiffLine\|<DiffHunkHeader\|<DiffToolbar' src/ 2>&1 | grep -v node_modules
```

Expected: no matches. Any test fixture / story file that still imports these gets updated.

- [ ] **Step 3: Run full test suite**

```bash
npm run test
```

Expected: all green. Coverage delta vs. before PR1 is reported in the PR description.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(diff): delete superseded React diff components (replaced by Pierre)"
```

### Task 1.13 — PR1 final verification + open PR

- [ ] **Step 1: Run the full PR1 acceptance checklist**

Walk through spec Section 10.1. Every checkbox must be checkable.

- [ ] **Step 2: Full local verification**

```bash
npm run type-check
npm run lint
npm run test
npm run build
```

Expected: all green. Check `dist/assets/*.js` total size in the PR description (per spec Section 9 risk).

- [ ] **Step 3: Manual regression for #249**

Run `npm run electron:dev` (or build + run AppImage). Open a terminal pane. Run `nvim` and `htop`. Expected: both render correctly (PR1 must not regress the terser-minifier fix from #249).

- [ ] **Step 4: Open PR1**

```bash
/lifeline:request-pr
```

Title: `feat(diff): replace renderer with @pierre/diffs (PR1 of 3)`. Body: link the spec + decision record + issue #255 + PR1 acceptance checklist from spec Section 10.1.

---

## PR2 — Hunk Staging IPC + Wiring

### Task 2.1 — Add Rust request types + helper functions

Per spec Section 5.1.

**Files:**

- Modify: `crates/backend/src/git/mod.rs`

- [ ] **Step 1: Add `StageFileRequest`, `DiscardFileRequest`, `DiscardScope`**

In `crates/backend/src/git/mod.rs`:

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiscardFileRequest {
    pub cwd: String,
    pub path: String,
    pub hunk_patch: Option<String>,
    #[serde(default)]
    pub scope: DiscardScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum DiscardScope {
    #[default]
    Unstaged,
    Both,
}
```

`unstage_file` reuses `StageFileRequest` (same fields, same semantics).

- [ ] **Step 2: Add `process` to Tokio features (required for `tokio::process::Command`)**

`crates/backend/Cargo.toml`'s `tokio` dep currently enables `sync, io-util, io-std, time, rt, rt-multi-thread, macros` but NOT `process`. The patch-applying helper needs `process` so it can spawn `git apply` with piped stdin without blocking the runtime.

```toml
# crates/backend/Cargo.toml — find the existing tokio line and add `process` to features:
tokio = { version = "1", features = ["sync", "io-util", "io-std", "time", "rt", "rt-multi-thread", "macros", "process"] }
```

Existing `run_git_with_timeout` uses `std::process::Command` (synchronous spawn wrapped in `tokio::time::timeout`); it keeps that signature unchanged. The new helper below uses `tokio::process::Command` specifically because it needs async stdin piping — these two coexist in `mod.rs` under their full paths (`std::process::Command` is already imported at `mod.rs:8`; reference the new helper's Command as `tokio::process::Command` to avoid shadowing).

- [ ] **Step 3: Add `run_git_apply_with_patch` helper**

Per spec Section 5.1 sketch — note the explicit `tokio::process::Command` qualifier:

```rust
use tokio::io::AsyncWriteExt;

async fn run_git_apply_with_patch(
    cwd: &std::path::Path,
    args: &[&str],
    patch: &str,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.current_dir(cwd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(patch.as_bytes())
            .await
            .map_err(|e| format!("stdin write failed: {e}"))?;
        // Drop stdin so git sees EOF.
    }
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
```

- [ ] **Step 4: Add `git_status_porcelain_is_untracked` helper**

```rust
async fn git_status_porcelain_is_untracked(
    cwd: &std::path::Path,
    path: &str,
) -> Result<bool, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["status", "--porcelain=v1", "-z", "--", path]);
    let out = run_git_with_timeout(cmd).await?;
    // -z separates records with NUL; the first 2 bytes of each record are
    // the XY status code. Untracked = "??".
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout.starts_with("??"))
}
```

- [ ] **Step 5: Add `validate_hunk_patch` helper (shared between Stage and Discard requests)**

`StageFileRequest` and `DiscardFileRequest` have different shapes (Discard adds the `scope` field), so the validator takes the relevant fields as references rather than the whole struct — that way both call sites can use it without an artificial trait or duplicated implementation.

```rust
/// Validates that:
/// 1. `path` is repo-relative (no `..` traversal, no absolute paths).
/// 2. `hunk_patch` (if Some) targets a path matching `path`
///    (rename-aware: matches `oldPath` OR `newPath` from the header).
/// 3. `hunk_patch` (if Some) is single-file (no second `diff --git` line).
fn validate_hunk_patch(
    cwd: &std::path::Path,
    path: &str,
    hunk_patch: Option<&str>,
) -> Result<(), String> {
    // 1. Path validation — reuse the existing helper if it exists, else inline.
    if std::path::Path::new(path).is_absolute() {
        return Err(format!("absolute path not allowed: {}", path));
    }
    let resolved = cwd.join(path);
    if !resolved.starts_with(cwd) {
        return Err(format!("path escapes workspace: {}", path));
    }

    // 2 + 3. Patch header check.
    if let Some(patch) = hunk_patch {
        // Reject multi-file patches.
        let diff_git_count = patch.lines().filter(|l| l.starts_with("diff --git ")).count();
        if diff_git_count > 1 {
            return Err("multi-file patches not allowed".to_string());
        }
        // The `--- a/<path>` and `+++ b/<path>` lines must match `path`.
        let mut header_paths: Vec<&str> = Vec::new();
        for line in patch.lines() {
            if let Some(rest) = line.strip_prefix("--- a/") {
                header_paths.push(rest);
            } else if let Some(rest) = line.strip_prefix("+++ b/") {
                header_paths.push(rest);
            }
        }
        if !header_paths.is_empty() && !header_paths.iter().any(|&p| p == path) {
            return Err(format!(
                "patch targets a different file (header paths: {:?}, req: {})",
                header_paths, path
            ));
        }
    }

    Ok(())
}
```

Call sites (in Task 2.2's `*_inner` functions): `validate_hunk_patch(&cwd, &req.path, req.hunk_patch.as_deref())?;`. Same line for stage / unstage (both use `StageFileRequest`) and discard (which uses `DiscardFileRequest` — same three fields are present).

- [ ] **Step 6: Type-check Rust**

```bash
cd crates/backend && cargo check
```

Expected: clean. If the build complains about Tokio's `process` feature, re-check Step 2 — the `Cargo.lock` may need a manual `cargo update -p tokio` to pick up the feature change.

- [ ] **Step 7: Commit**

```bash
git add crates/backend/Cargo.toml crates/backend/Cargo.lock crates/backend/src/git/mod.rs
git commit -m "feat(git): add stage/unstage/discard request types and helpers"
```

### Task 2.2 — Implement the three `*_inner` handlers + Rust tests

**Files:**

- Modify: `crates/backend/src/git/mod.rs`
- Create: `crates/backend/tests/git_staging.rs`

- [ ] **Step 1: Implement `stage_file_inner`, `unstage_file_inner`, `discard_file_inner`**

Per spec Section 5.1 sketches. Each starts with `validate_cwd` + `validate_hunk_patch`, then branches on `hunk_patch.is_some()` and routes to either the whole-file command or `run_git_apply_with_patch`. `discard_file_inner` additionally branches on `is_untracked` for the whole-file case (`git clean -f` vs `git checkout`).

- [ ] **Step 2: Write `crates/backend/tests/git_staging.rs`**

Cover each Section 10.2 acceptance bullet:

- Whole-file stage of a modified tracked file → `git status --short` confirms the staging.
- Per-hunk stage with a valid patch → only the staged hunk shows in `git diff --cached`; the other hunks remain in the working tree.
- Per-hunk stage with a stale patch (e.g. the working tree changed since the diff was captured) → handler returns `Err` with the actual git stderr text.
- Per-hunk stage with a multi-file patch → rejected by `validate_hunk_patch` before invoking git.
- Per-hunk stage with a patch whose header names a different file → rejected by `validate_hunk_patch`.
- Discard of an untracked file → file is removed from disk.
- Whole-file discard of a modified tracked file → working tree restored to HEAD.
- Unstage of a per-hunk stage → restores the per-hunk delta to the working tree.

- [ ] **Step 3: Run tests**

```bash
cd crates/backend && cargo test --test git_staging
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add crates/backend/src/git/mod.rs crates/backend/tests/git_staging.rs
git commit -m "feat(git): add stage/unstage/discard inner handlers with validation"
```

### Task 2.3 — Wire the 4-file IPC checklist

Per spec Section 5.1 table.

**Files:**

- Modify: `crates/backend/src/runtime/state.rs`
- Modify: `crates/backend/src/runtime/ipc.rs`
- Modify: `electron/backend-methods.ts`
- Create: `src/bindings/StageFileRequest.ts`, `src/bindings/DiscardFileRequest.ts`, `src/bindings/DiscardScope.ts` (ts-rs regenerates)

- [ ] **Step 1: Add `BackendState` methods**

In `crates/backend/src/runtime/state.rs`:

```rust
pub async fn stage_file(&self, req: StageFileRequest) -> Result<(), String> {
    crate::git::stage_file_inner(req).await
}

pub async fn unstage_file(&self, req: StageFileRequest) -> Result<(), String> {
    crate::git::unstage_file_inner(req).await
}

pub async fn discard_file(&self, req: DiscardFileRequest) -> Result<(), String> {
    crate::git::discard_file_inner(req).await
}
```

- [ ] **Step 2: Add IPC router match arms**

In `crates/backend/src/runtime/ipc.rs`, find the existing `match method.as_str()` and add three arms following the existing `"get_git_diff"` pattern:

```rust
"stage_file" => {
    let req: StageFileRequest = serde_json::from_value(params)
        .map_err(|e| format!("invalid params: {e}"))?;
    state.stage_file(req).await.map(|_| Value::Null)
}
"unstage_file" => {
    let req: StageFileRequest = serde_json::from_value(params)
        .map_err(|e| format!("invalid params: {e}"))?;
    state.unstage_file(req).await.map(|_| Value::Null)
}
"discard_file" => {
    let req: DiscardFileRequest = serde_json::from_value(params)
        .map_err(|e| format!("invalid params: {e}"))?;
    state.discard_file(req).await.map(|_| Value::Null)
}
```

- [ ] **Step 3: Extend the allowlist**

In `electron/backend-methods.ts`, append `'stage_file'`, `'unstage_file'`, `'discard_file'` to the existing array of allowed method names.

- [ ] **Step 4: Regenerate bindings**

```bash
cd crates/backend && cargo test --features=ts-export
```

Expected: `src/bindings/StageFileRequest.ts`, `DiscardFileRequest.ts`, `DiscardScope.ts` get created/updated.

- [ ] **Step 5: Type-check + Rust check**

```bash
npm run type-check && cd crates/backend && cargo check
```

Expected: clean.

- [ ] **Step 6: Manual IPC smoke**

Run `npm run electron:dev`. Open Vimeflow's DevTools console and call:

```js
await window.backend.invoke('stage_file', {
  cwd: '/path/to/this/worktree',
  path: 'docs/superpowers/plans/2026-05-24-pierre-diffs-integration.md',
})
```

Expected: returns `null` (success). `git status --short` in a shell shows the file as staged. Unstage it manually: `git reset HEAD docs/superpowers/plans/2026-05-24-pierre-diffs-integration.md`.

- [ ] **Step 7: Commit**

```bash
git add crates/backend/ electron/backend-methods.ts src/bindings/
git commit -m "feat(git): wire stage/unstage/discard IPC handlers (4-file checklist)"
```

### Task 2.4 — Unstub frontend `gitService` + extend `pierreAdapter`

Per spec Section 5.2 + 5.3.

**Files:**

- Modify: `src/features/diff/services/gitService.ts`
- Modify: `src/features/diff/services/gitService.test.ts`
- Modify: `src/features/diff/services/pierreAdapter.ts`
- Modify: `src/features/diff/services/pierreAdapter.test.ts`
- Modify: `vite.config.ts` (finish dev middleware stage/unstage/discard routes)

- [ ] **Step 1: Update `gitService` method signatures**

Change all three methods on `GitService` to:

```ts
stageFile(file: ChangedFile, hunkPatch?: string): Promise<void>
unstageFile(file: ChangedFile, hunkPatch?: string): Promise<void>
discardChanges(file: ChangedFile, hunkPatch?: string): Promise<void>
```

- [ ] **Step 2: Implement `DesktopGitService` versions**

Each calls `invoke('stage_file' | 'unstage_file' | 'discard_file', { cwd, path, hunkPatch })`. For `discardChanges` add `scope: 'unstaged'` (the v1 default).

- [ ] **Step 3: Implement `HttpGitService` versions + Vite dev middleware completion**

In `vite.config.ts`, the existing `/api/git/stage` / `/api/git/unstage` / `/api/git/discard` route stubs get rewritten to use `child_process.spawn` for `git apply` (per spec Section 5.2). For whole-file operations, use `simple-git`'s `git.add()` / `git.reset()` / `git.checkout()` (no stdin needed).

Per-hunk dev sketch:

```ts
import { spawn } from 'child_process'

const applyPatch = async (
  cwd: string,
  args: string[],
  patch: string
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `git ${args.join(' ')} exited ${code}`))
    })
    child.stdin.write(patch)
    child.stdin.end()
  })
}

// in the /api/git/stage handler when hunkPatch is provided:
await applyPatch(
  repoRoot,
  ['apply', '--cached', '--whitespace=nowarn'],
  hunkPatch
)
```

- [ ] **Step 4: `MockGitService` resolves immediately**

```ts
async stageFile(_file, _hunkPatch?): Promise<void> { return Promise.resolve() }
// same for unstage / discard
```

- [ ] **Step 5: Add `findRawDiffHunkIndex` to `pierreAdapter`**

Per spec Section 5.3 mapping rule:

```ts
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

export interface PierreHunkRange {
  newStart: number
  newLines: number
}

/**
 * Maps a Pierre hunk (identified by its newStart/newLines range) to the
 * index into response.fileDiff.hunks. Returns -1 if no git hunk matches —
 * git and Pierre's diff engines can split hunks differently.
 */
export const findRawDiffHunkIndex = (
  response: GetGitDiffResponse,
  pierreHunk: PierreHunkRange
): number =>
  response.fileDiff.hunks.findIndex(
    (h) =>
      h.newStart === pierreHunk.newStart && h.newLines === pierreHunk.newLines
  )
```

- [ ] **Step 6: Update + extend `gitService.test.ts` and `pierreAdapter.test.ts`**

- `gitService.test.ts`: assert each method routes to the right IPC name with the right payload shape (`{ cwd, path, hunkPatch }`). Cover both with-`hunkPatch` and without.
- `pierreAdapter.test.ts`: assert `findRawDiffHunkIndex` returns the correct index for an exact match, returns -1 for a non-match (e.g. different `newLines`), works with multiple hunks.

- [ ] **Step 7: Run tests + type-check**

```bash
npx vitest run src/features/diff/services/
npm run type-check
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/features/diff/services/ vite.config.ts
git commit -m "feat(diff): unstub gitService + add Pierre hunk-index mapper"
```

### Task 2.5 — Wire chip handlers in `DiffPanelContent` + `DiffChipToolbar`

Per spec Section 5.3 click-to-IPC flow + Section 5.4 tests.

**Files:**

- Modify: `src/features/diff/components/DiffPanelContent.tsx`
- Modify: `src/features/diff/components/toolbar/DiffChipToolbar.tsx`
- Modify: `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx`

- [ ] **Step 1: Add focused-hunk state + click handlers to `DiffPanelContent`**

The focused-hunk state tracks the index into the **git** hunks (`response.fileDiff.hunks`). To translate from Pierre's hunk identity to the git hunk index, use `findRawDiffHunkIndex` from `pierreAdapter` (Task 2.4) — **NOT** the focused index directly, because Pierre's diff engine (jsdiff via `oldText`/`newText`) and git's diff engine can split the same change into a different number of hunks (per spec Section 5.3 architectural correction).

For PR1's prev/next chip placeholders we tracked the focused git-hunk index directly (since Pierre had no role yet). PR2 reconciles: when the user clicks a Pierre hunk row or uses prev/next, the toolbar resolves the **Pierre** hunk's range (`newStart`, `newLines`), and the chip handlers re-derive the git index at click time via `findRawDiffHunkIndex(response, { newStart, newLines })`. The chip never trusts the focused index as if it were a raw-diff index.

```ts
import { extractHunkPatch } from '../services/gitPatch'
import { findRawDiffHunkIndex } from '../services/pierreAdapter'

const [focusedHunk, setFocusedHunk] = useState<{
  newStart: number
  newLines: number
} | null>(null)
const [staging, setStaging] = useState(false)

const handleStage = useCallback(async () => {
  if (!response || !selectedFile || staging || !focusedHunk) return
  setStaging(true)
  try {
    const rawIndex = findRawDiffHunkIndex(response, focusedHunk)
    if (rawIndex === -1) {
      showToast(
        'Pierre split this hunk differently than git — cannot stage this region. Use Discard All or the file-level chip.'
      )
      return
    }
    const hunkPatch = extractHunkPatch(response.rawDiff, rawIndex)
    if (hunkPatch === null) {
      showToast('Could not isolate this hunk — try refreshing the diff.')
      return
    }
    await service.stageFile(selectedFile, hunkPatch)
    await refetchDiff()
    await refetchGitStatus()
  } catch (e) {
    showError((e as Error).message)
  } finally {
    setStaging(false)
  }
}, [response, selectedFile, focusedHunk, staging, service])
```

Mirror for `handleUnstage` (calls `unstageFile`) and `handleDiscard` (calls `discardChanges`). For `handleDiscardAll`, no `hunkPatch`, no mapping, no `extractHunkPatch` — just `await service.discardChanges(selectedFile)`.

- [ ] **Step 2: Add prev/next hunk handlers**

```ts
const onPrevHunk = useCallback(() => {
  if (!response) return
  const len = response.fileDiff.hunks.length
  if (len === 0) return
  setFocusedHunkIndex((prev) => (prev + len - 1) % len)
}, [response])
const onNextHunk = useCallback(() => {
  if (!response) return
  const len = response.fileDiff.hunks.length
  if (len === 0) return
  setFocusedHunkIndex((prev) => (prev + 1) % len)
}, [response])
```

- [ ] **Step 3: Compute `selectedLines` for Pierre from the focused hunk**

```ts
const focusedHunk = response?.fileDiff.hunks[focusedHunkIndex]
const selectedLines: SelectedLineRange | null = focusedHunk
  ? {
      start:
        focusedHunk.newLines === 0
          ? focusedHunk.oldStart
          : focusedHunk.newStart,
      end:
        (focusedHunk.newLines === 0
          ? focusedHunk.oldStart
          : focusedHunk.newStart) +
        Math.max(
          (focusedHunk.newLines === 0
            ? focusedHunk.oldLines
            : focusedHunk.newLines) - 1,
          0
        ),
      side: focusedHunk.newLines === 0 ? 'deletions' : 'additions',
    }
  : null
```

Pass `selectedLines` to `<MultiFileDiff>`.

- [ ] **Step 4: Wire handlers into `<DiffChipToolbar>`**

Add the new props to `DiffChipToolbarProps`: `onPrevHunk`, `onNextHunk`, `onStage`, `onUnstage`, `onDiscard`, `onDiscardAll`, `staging`, `focusedHunkIndex`, `totalHunks`. Inside the toolbar, lift the `disabled` styling on the staging chips when the corresponding handler prop is provided AND `staging === false`. Hunk counter chip reads `${focusedHunkIndex + 1}/${totalHunks}`.

Discard All adds a confirmation popover (the `<Tooltip interactive>` pattern from the existing `<Tooltip>` primitive — or a small inline `<Popover>` if Tooltip's `interactive` mode doesn't support buttons): "Discard all changes to `<filename>`? This cannot be undone." with `Confirm` / `Cancel` buttons.

- [ ] **Step 5: Extend `DiffChipToolbar.test.tsx`**

- Click each staging chip → corresponding handler is called once with no arguments.
- `staging === true` → all staging chips are disabled.
- Click Discard All → confirmation popover appears; click Confirm → `onDiscardAll` is called; click Cancel → handler is NOT called.
- Click next hunk twice with 3 hunks → `setFocusedHunkIndex` called with 1 then 2; with 3 hunks and `focusedHunkIndex===2`, next wraps to 0.

- [ ] **Step 6: Run tests + manual E2E**

```bash
npx vitest run src/features/diff/
```

Manual E2E: `npm run electron:dev`. Modify a tracked file with at least 3 distinct hunks. In the diff pane, click `next hunk` until hunk 2 is focused (counter shows `2/3`). Click `stage`. Verify in a shell: `git status --short` shows partial staging; `git diff --cached` shows only the staged hunk. Unstage it back. Discard hunk 1. Verify the working tree updates and the diff refreshes automatically.

- [ ] **Step 7: Commit**

```bash
git add src/features/diff/
git commit -m "feat(diff): wire chip handlers for stage/unstage/discard + hunk navigation"
```

### Task 2.6 — PR2 final verification + open PR

- [ ] **Step 1: Run spec Section 10.2 acceptance checklist**
- [ ] **Step 2: Local verification**

```bash
npm run type-check && npm run lint && npm run test && npm run build && (cd crates/backend && cargo test)
```

- [ ] **Step 3: Open PR2**

```bash
/lifeline:request-pr
```

Title: `feat(diff): hunk staging IPC + chip wiring (PR2 of 3)`.

---

## PR3 — Inline Review Comments

### Task 3.1 — Build the feedback batch hook

Per spec Section 6.2.

**Files:**

- Create: `src/features/diff/hooks/useFeedbackBatch.ts`
- Create: `src/features/diff/hooks/useFeedbackBatch.test.ts`

- [ ] **Step 1: Write `useFeedbackBatch.ts`**

```ts
import { useCallback, useState } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'

export interface ReviewComment {
  id: string
  text: string
  author: 'self'
  createdAt: number
}

export type FeedbackBatch = Map<
  /* batchKey: `${cwd}::${filePath}` */ string,
  DiffLineAnnotation<ReviewComment>[]
>

const SOFT_CAP = 50

export interface UseFeedbackBatchReturn {
  batch: FeedbackBatch
  annotationsForFile: (
    cwd: string,
    filePath: string
  ) => DiffLineAnnotation<ReviewComment>[]
  addAnnotation: (
    cwd: string,
    filePath: string,
    annotation: DiffLineAnnotation<ReviewComment>
  ) => 'ok' | 'cap-reached'
  updateAnnotation: (
    cwd: string,
    filePath: string,
    id: string,
    patch: Partial<ReviewComment>
  ) => void
  removeAnnotation: (cwd: string, filePath: string, id: string) => void
  clearBatch: () => void
  totalAnnotations: () => number
}

export const useFeedbackBatch = (): UseFeedbackBatchReturn => {
  const [batch, setBatch] = useState<FeedbackBatch>(() => new Map())

  const totalAnnotations = useCallback(
    () =>
      Array.from(batch.values()).reduce((sum, list) => sum + list.length, 0),
    [batch]
  )

  const addAnnotation = useCallback(
    (
      cwd: string,
      filePath: string,
      annotation: DiffLineAnnotation<ReviewComment>
    ): 'ok' | 'cap-reached' => {
      if (totalAnnotations() >= SOFT_CAP) return 'cap-reached'
      setBatch((prev) => {
        const key = `${cwd}::${filePath}`
        const next = new Map(prev)
        next.set(key, [...(prev.get(key) ?? []), annotation])
        return next
      })
      return 'ok'
    },
    [totalAnnotations]
  )

  // updateAnnotation, removeAnnotation, clearBatch follow the same Map-clone pattern.
  // removeAnnotation: if the file's list becomes empty after removal, delete
  // the Map key entirely (per spec Section 6.2 housekeeping rule).

  // ... full impl ...
  return {
    batch,
    annotationsForFile,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    clearBatch,
    totalAnnotations,
  }
}
```

- [ ] **Step 2: Write `useFeedbackBatch.test.ts`**

- Empty initial state — `totalAnnotations() === 0`.
- Add an annotation — `annotationsForFile` returns it.
- Add 50 annotations — 51st returns `'cap-reached'` and batch size stays at 50.
- Update an annotation by id — text patched, other fields preserved.
- Remove the last annotation for a file — the Map key is deleted entirely (assert `batch.has(key) === false`).
- `clearBatch()` empties the Map.

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run src/features/diff/hooks/useFeedbackBatch.test.ts
git add src/features/diff/hooks/useFeedbackBatch.ts src/features/diff/hooks/useFeedbackBatch.test.ts
git commit -m "feat(diff): add useFeedbackBatch hook with soft cap"
```

### Task 3.2 — Build `ReviewCommentRow` + `ReviewCommentComposer`

Per spec Section 6.1.

**Files:**

- Create: `src/features/diff/components/ReviewCommentRow.tsx`
- Create: `src/features/diff/components/ReviewCommentRow.test.tsx`
- Create: `src/features/diff/components/ReviewCommentComposer.tsx`
- Create: `src/features/diff/components/ReviewCommentComposer.test.tsx`

- [ ] **Step 1: Write `ReviewCommentRow.tsx`**

Inline chip rendered below the line. Shows comment text + relative timestamp + small edit / delete icon buttons.

```tsx
import type { ReactElement } from 'react'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

interface ReviewCommentRowProps {
  comment: ReviewComment
  onEdit: () => void
  onDelete: () => void
}

export const ReviewCommentRow = ({
  comment,
  onEdit,
  onDelete,
}: ReviewCommentRowProps): ReactElement => (
  <div className="mx-2 my-1 flex items-start gap-2 rounded-md bg-surface-container-high/60 px-3 py-2">
    <p className="flex-1 text-xs text-on-surface whitespace-pre-wrap break-words">
      {comment.text}
    </p>
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest"
        aria-label="Edit comment"
      >
        <span className="material-symbols-outlined text-base">edit</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1 text-on-surface-variant hover:text-error hover:bg-error-container/30"
        aria-label="Delete comment"
      >
        <span className="material-symbols-outlined text-base">delete</span>
      </button>
    </div>
  </div>
)
```

- [ ] **Step 2: Write `ReviewCommentComposer.tsx`**

Floating-ui anchored popover with a textarea + Add/Cancel buttons. Pre-fill on edit. Submit on Enter (Shift+Enter for newline). ESC closes without saving.

```tsx
import { useState, useEffect, useRef, type ReactElement } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'

interface ReviewCommentComposerProps {
  anchor: HTMLElement
  initialText?: string
  onConfirm: (text: string) => void
  onCancel: () => void
}

export const ReviewCommentComposer = ({
  anchor,
  initialText = '',
  onConfirm,
  onCancel,
}: ReviewCommentComposerProps): ReactElement => {
  const [text, setText] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onCancel()
    },
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor },
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed.length > 0) onConfirm(trimmed)
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 w-[320px] rounded-lg bg-surface-container-high/95 backdrop-blur-md border border-outline-variant/20 shadow-xl p-3 flex flex-col gap-2"
        {...getFloatingProps()}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          rows={3}
          className="bg-surface-container/50 text-on-surface text-xs rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add a comment…"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded-md text-xs text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={text.trim().length === 0}
            className="px-3 py-1 rounded-md text-xs bg-primary text-on-primary hover:bg-primary/80 disabled:opacity-50"
          >
            Add comment
          </button>
        </div>
      </div>
    </FloatingPortal>
  )
}
```

- [ ] **Step 3: Tests**

`ReviewCommentRow.test.tsx`: render, click edit → `onEdit` fires; click delete → `onDelete` fires.

`ReviewCommentComposer.test.tsx`: render with no initialText, type → state updates; press Enter → `onConfirm(text)`; press Shift+Enter → newline added, no submit; press Escape → `onCancel()`; click outside → `onCancel()` (via useDismiss).

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/features/diff/components/ReviewCommentRow.test.tsx src/features/diff/components/ReviewCommentComposer.test.tsx
git add src/features/diff/components/ReviewCommentRow.tsx src/features/diff/components/ReviewCommentRow.test.tsx src/features/diff/components/ReviewCommentComposer.tsx src/features/diff/components/ReviewCommentComposer.test.tsx
git commit -m "feat(diff): add ReviewCommentRow + ReviewCommentComposer"
```

### Task 3.3 — Build `activePanePicker` + `feedbackDispatch`

Per spec Section 6.3 + 6.4.

**Files:**

- Create: `src/features/diff/services/activePanePicker.ts`
- Create: `src/features/diff/services/activePanePicker.test.ts`
- Create: `src/features/diff/services/feedbackDispatch.ts`
- Create: `src/features/diff/services/feedbackDispatch.test.ts`

- [ ] **Step 1: Write `activePanePicker.ts`**

```ts
export interface PaneCandidate {
  paneId: string
  ptyId: string
  tabName: string
  agentLabel: string // 'Claude Code' | 'Codex' | (other adapter name)
  cwd: string
  status: 'idle' | 'running' | 'exited' | 'error' // match the existing PTY status enum
  isFocused: boolean
}

export interface ResolveCandidatesArgs {
  allPanes: PaneCandidate[]
  diffCwd: string
  focusedPaneId: string | null
}

export type ResolveResult =
  | { kind: 'none' }
  | { kind: 'one'; pane: PaneCandidate }
  | { kind: 'many'; candidates: PaneCandidate[] }

// Supported agents that the feedback dispatch knows how to format for.
// Other adapters (some future agent we don't yet test against) are
// filtered out until we explicitly verify the bracketed-paste flow
// works against them in PR3's manual E2E.
export type SupportedAgent = 'Claude Code' | 'Codex'
const SUPPORTED_AGENTS: readonly SupportedAgent[] = ['Claude Code', 'Codex']

/**
 * Per spec Section 6.3 — filter to panes in this workspace whose:
 *  - cwd matches the diff cwd (exact or descendant), AND
 *  - have a detected agent that's in SUPPORTED_AGENTS (Claude Code | Codex), AND
 *  - have status === 'running' (the agent process is live).
 * Then route by count: 0 → none; 1 → silent pick; many with focused → focused; many → picker.
 */
export const resolveCandidatePanes = (
  args: ResolveCandidatesArgs
): ResolveResult => {
  const candidates = args.allPanes.filter(
    (p) =>
      isMatchingCwd(p.cwd, args.diffCwd) &&
      SUPPORTED_AGENTS.includes(p.agentLabel as SupportedAgent) &&
      p.status === 'running'
  )
  if (candidates.length === 0) return { kind: 'none' }
  if (candidates.length === 1) return { kind: 'one', pane: candidates[0] }
  const focused = candidates.find((p) => p.paneId === args.focusedPaneId)
  if (focused) return { kind: 'one', pane: focused }
  return { kind: 'many', candidates }
}

const isMatchingCwd = (paneCwd: string, diffCwd: string): boolean => {
  // exact match or descendant per agentCwdHint semantics
  return paneCwd === diffCwd || paneCwd.startsWith(diffCwd + '/')
}
```

- [ ] **Step 2: Write `feedbackDispatch.ts`**

```ts
import type { DiffLineAnnotation } from '@pierre/diffs'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

export interface DispatchEntry {
  cwd: string
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
}

export const formatFeedbackPayload = (entries: DispatchEntry[]): string => {
  const totalCount = entries.reduce((s, e) => s + e.annotations.length, 0)
  const fileCount = entries.length
  const header = `> Inline review feedback (${totalCount} comment${totalCount === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}):`
  const body = entries
    .flatMap((entry) =>
      entry.annotations.map(
        (a) =>
          `> ${entry.filePath}:${a.lineNumber} (${a.side})\n> ─ ${a.metadata.text}\n>`
      )
    )
    .join('\n')
  return [
    header,
    '>',
    body,
    '> ―',
    '> Please address these and reply when done.',
  ].join('\n')
}

export const dispatchFeedbackBatch = async (
  paneId: string,
  ptyId: string,
  entries: DispatchEntry[],
  writePty: (ptyId: string, data: string) => Promise<void>
): Promise<void> => {
  const formatted = formatFeedbackPayload(entries)
  const payload = `${PASTE_START}${formatted}${PASTE_END}\n`
  await writePty(ptyId, payload)
}
```

- [ ] **Step 3: Tests**

`activePanePicker.test.ts`:

- 0 candidates → `{kind:'none'}`.
- 1 candidate → `{kind:'one', pane}`.
- 2+ candidates, focused matches → `{kind:'one', pane: focused}`.
- 2+ candidates, focused not in set → `{kind:'many', candidates}`.
- Descendant cwd match works (`/repo/sub` matches `/repo`).

`feedbackDispatch.test.ts`:

- `formatFeedbackPayload` with 1 comment across 1 file → header reads `1 comment across 1 file`.
- `formatFeedbackPayload` with 3 comments across 2 files → pluralization correct, body has 3 entries.
- `dispatchFeedbackBatch` calls `writePty` once with the payload wrapped in `\x1b[200~` ... `\x1b[201~\n`.

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/features/diff/services/activePanePicker.test.ts src/features/diff/services/feedbackDispatch.test.ts
git add src/features/diff/services/activePanePicker.ts src/features/diff/services/activePanePicker.test.ts src/features/diff/services/feedbackDispatch.ts src/features/diff/services/feedbackDispatch.test.ts
git commit -m "feat(diff): add activePanePicker + feedbackDispatch services"
```

### Task 3.4 — Build `FinishFeedbackPopover` (send-confirmation + multi-pane picker)

Per spec Section 6.2 + 6.3.

**Files:**

- Create: `src/features/diff/components/FinishFeedbackPopover.tsx`
- Create: `src/features/diff/components/FinishFeedbackPopover.test.tsx`

- [ ] **Step 1: Implement the popover**

Anchored to the "Finish feedback (N)" chip in the toolbar. Reads from `resolveCandidatePanes()`. Renders one of three states:

- `kind: 'none'` → message "No coding agent is active in this workspace. Start `claude` or `codex` in a terminal pane." with a single `Dismiss` button.
- `kind: 'one'` → message "Send N comments across M files to `<pane.tabName>` (`<pane.agentLabel>`)?" with `Confirm` / `Cancel` buttons.
- `kind: 'many'` → "Multiple agents in this workspace. Pick one:" with a list of candidate rows + per-row `Send` button + a `Cancel` button.

`Confirm` (or per-row `Send`) calls the parent's `onSend(pane)` callback. `Cancel` calls `onCancel`.

- [ ] **Step 2: Tests**

- Render each of the three kinds; assert the right copy / buttons.
- Click Confirm in the one-pane case → `onSend(pane)` fires with the right pane.
- Click a per-row Send in the many-pane case → `onSend(pane)` fires with that row's pane.
- Click Cancel → `onCancel()` fires.

- [ ] **Step 3: Commit**

```bash
git add src/features/diff/components/FinishFeedbackPopover.tsx src/features/diff/components/FinishFeedbackPopover.test.tsx
git commit -m "feat(diff): add FinishFeedbackPopover (send + pick agent pane)"
```

### Task 3.5 — Integrate annotations into `DiffPanelContent` + `DiffChipToolbar`

Per spec Section 6.

**Files:**

- Modify: `src/features/diff/components/DiffPanelContent.tsx`
- Modify: `src/features/diff/components/toolbar/DiffChipToolbar.tsx`
- Modify: `src/features/diff/components/toolbar/DiffChipToolbar.test.tsx`

- [ ] **Step 1: Mount the feedback batch hook in `DiffPanelContent`**

```ts
const feedback = useFeedbackBatch()
const total = feedback.totalAnnotations()

// Spec Section 6.2: clear on workspace cwd change. DiffPanelContent
// receives `cwd` as a prop and is NOT remounted across workspace
// switches in some flows, so we must explicitly clear the batch when
// the cwd changes. The earliest cwd value is captured in a ref to
// avoid clearing on the initial mount.
const previousCwdRef = useRef(cwd)
useEffect(() => {
  if (previousCwdRef.current !== cwd) {
    feedback.clearBatch()
    previousCwdRef.current = cwd
  }
}, [cwd, feedback])
```

The `clearBatch` callback inside `useFeedbackBatch` is referentially stable (wrapped in `useCallback` with an empty dep array — verify in the hook implementation from Task 3.1, fix it there if not).

- [ ] **Step 2: Pass `lineAnnotations` + `renderAnnotation` to `<MultiFileDiff>`**

```tsx
<MultiFileDiff
  // ... existing props ...
  lineAnnotations={feedback.annotationsForFile(cwd, selectedFile?.path ?? '')}
  renderAnnotation={(annotation) => (
    <ReviewCommentRow
      comment={annotation.metadata}
      onEdit={() => openComposer({ editId: annotation.metadata.id, anchor: /* element ref */, initialText: annotation.metadata.text })}
      onDelete={() => feedback.removeAnnotation(cwd, selectedFile.path, annotation.metadata.id)}
    />
  )}
/>
```

Composer open state is local React state inside `DiffPanelContent` — a single composer instance can be open at a time. The composer's anchor element is captured from the click handler.

- [ ] **Step 3: Wire the diff-line click handler**

Pierre's `InteractionManager` exposes line-click events. Implementation note: read `node_modules/@pierre/diffs/dist/managers/InteractionManager.d.ts` for the exact callback name (likely `onDiffLineClick` per the spec). Wire it via `<MultiFileDiff options.onDiffLineClick>` or whatever Pierre's actual prop is at the version installed.

- [ ] **Step 4: Add "Finish feedback" + "Discard feedback" chips to the toolbar**

In `DiffChipToolbar.tsx`, accept two new props: `feedbackCount: number` and `onFinishFeedback` / `onDiscardFeedback`. Visibility:

```tsx
{
  feedbackCount > 0 && (
    <Chip onClick={onFinishFeedback}>Finish feedback ({feedbackCount})</Chip>
  )
}
{
  feedbackCount > 0 && (
    <Chip onClick={onDiscardFeedback} variant="muted">
      Discard feedback
    </Chip>
  )
}
```

`Finish feedback` chip goes at priority 5; `Discard feedback` chip goes last (first to overflow).

- [ ] **Step 5: Hook up `FinishFeedbackPopover`**

In `DiffPanelContent`, when the Finish chip is clicked, open `<FinishFeedbackPopover>` with `resolveCandidatePanes(...)` results. On `onSend(pane)`:

```ts
const entries: DispatchEntry[] = Array.from(feedback.batch.entries()).map(
  ([key, annotations]) => {
    const [keyCwd, filePath] = key.split('::')
    return { cwd: keyCwd, filePath, annotations }
  }
)
try {
  await dispatchFeedbackBatch(pane.paneId, pane.ptyId, entries, writePty)
  feedback.clearBatch()
} catch (e) {
  showError('Terminal session ended; feedback not sent.')
  // do NOT clear the batch — user can retry after starting a new agent
}
```

`writePty` is the existing terminal-feature export.

- [ ] **Step 6: Extend `DiffChipToolbar.test.tsx`**

- `feedbackCount === 0` → neither chip is in the DOM.
- `feedbackCount > 0` → both chips render; Finish label shows the count; click invokes the callbacks.

- [ ] **Step 7: Manual E2E**

`npm run electron:dev`. Start `claude` in a terminal pane in the same workspace. Open a diff. Click on a couple of lines to add comments. Click "Finish feedback (N)" → popover. Confirm. Switch to the terminal pane; verify the bracketed-paste message appears in scrollback and Claude responds to it.

- [ ] **Step 8: Commit**

```bash
git add src/features/diff/
git commit -m "feat(diff): inline review comments → write_pty to active agent pane"
```

### Task 3.6 — PR3 final verification + open PR

- [ ] **Step 1: Run spec Section 10.3 acceptance checklist**
- [ ] **Step 2: Local verification**

```bash
npm run type-check && npm run lint && npm run test && npm run build && (cd crates/backend && cargo test)
```

- [ ] **Step 3: Open PR3**

```bash
/lifeline:request-pr
```

Title: `feat(diff): inline review comments to active agent pane (PR3 of 3)`.

---

## Stop here

After PR3 lands, the integration is complete per the spec. Follow-ups (optimistic UI, Catppuccin theme, virtualization, settings persistence, `@pierre/trees` swap) are tracked separately per spec Section 9.1.

This plan ends at PR3 opening — DO NOT chain into execution. Control returns to `/lifeline:planner` (or to a fresh `/superpowers:executing-plans` / `/superpowers:subagent-driven-development` invocation when the operator is ready).
