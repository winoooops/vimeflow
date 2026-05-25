# Diff renderer: `@pierre/diffs`

**Date:** 2026-05-23
**Status:** Accepted (spike validated, integration pending via `/lifeline:planner`)
**Scope:** the in-app diff renderer under `src/features/diff/components/` (`DiffViewer`, `SplitDiffView`, `UnifiedDiffView`, `DiffLine`, `DiffHunkHeader`) and the controls toolbar that wraps it. Does **not** preempt later decisions about the file-list sidebar (`ChangedFilesList`) — a future swap to `@pierre/trees` is a separate decision.

## Context

`src/features/diff/` is a hand-rolled Rust-parses → React-renders stack covering ~7.7k LOC across 40 files. It ships split + unified layouts, sticky headers, keyboard nav, theme integration, but is missing the two diff-renderer table stakes:

- ❌ Shiki / language-aware syntax highlighting
- ❌ Word-level intra-line diff producer (schema present in `DiffLine.tsx`, but the Rust backend never populates `LineHighlight[]`)

It also has UI scaffolding for hunk stage/unstage/discard that's wired to `Promise.reject('not implemented')` Rust handlers (commands.rs hasn't grown them yet). The fix-it-yourself path is ~1500 LOC of `DiffLine` / `SplitDiffView` / `UnifiedDiffView` + a new Rust word-diff producer + a Shiki integration. Replacing with a library is plausibly half that and immediately unlocks features we'd never get to (annotation framework, virtualization, merge-conflict resolver).

Tracking issue: [#255](https://github.com/winoooops/vimeflow/issues/255).

## Options considered

1. **Keep building in-house** — fix the two gaps; ship hunk staging.
2. **Run [`modem-dev/hunk`](https://github.com/modem-dev/hunk) (4.3k★, MIT) as a CLI in a Vimeflow terminal pane** — different UX paradigm; gets agent annotations + watch mode for free.
3. **Embed [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) (Apache-2.0)** — the React renderer extracted from the Pierre Computer Company's commercial code-review product; same library that powers hunk's rendering.

## Decision

**Option 3 — `@pierre/diffs@1.2.2`.** Add the dep, replace the React rendering layer (`<MultiFileDiff>` from `@pierre/diffs/react`) inside the existing `DiffPanelContent.tsx` orchestration shell. Keep the Rust git source, `ChangedFilesList`, `CommitInfoPanel`, `DiffToolbar` chrome.

## Justification

1. **Solves the two real gaps in one move.** Shiki highlighting + word-level intra-line diff are both built in via Pierre's `lineDiffType: 'word-alt' | 'word' | 'char' | 'none'` option.
2. **Library, not a CLI.** Hunk publishes only a `bin/hunk.cjs` binary; its `./opentui` export is for OpenTUI apps, not React. `@pierre/diffs` ships dedicated `./react`, `./ssr`, and `./worker` exports. No paradigm change for our embedded panel.
3. **Backed by a real team with skin in the game.** Maintainers include Mark Otto + Jacob Thornton (Bootstrap co-creators, 165k★ track record). Pierre uses the library in its commercial product. Last push to monorepo: 2026-05-23 (active).
4. **Already adopted by similar tools.** `oorestisime/opencode-diffs`, `clemg/pierre-github`, `dpenny52/ghDiffs` (Chrome ext replacing GitHub PR diffs), `Stanzilla/gitlab-pierre`, `onevcat/YiTong` (WKWebView wrapper) — multiple independent "replace X's diff with Pierre" implementations.
5. **License-compatible.** Apache-2.0 vs Vimeflow MIT. Both permissive; no copyleft anywhere in the dep chain (Shiki, hast-util-to-html, diff all MIT).
6. **Unlocks features we'd never reach in-house.** `<VirtualizedFileDiff>` for big files, `<UnresolvedFile>` + `RenderMergeConflictActions` for merge conflicts, `DiffLineAnnotation<T>` + `renderAnnotation` for inline agent comments — the last one is on-brand for Vimeflow's agent-control-plane mission.
7. **Built-in stage/unstage utility.** `diffAcceptRejectHunk` + `DiffAcceptRejectHunkConfig` plug straight into our existing (still stubbed) Rust stage/unstage commands once those grow handlers.
8. **Spike already validated end-to-end inside the Electron diff pane** with our actual chrome (`DiffPanelContent`), Catppuccin Mocha tokens via Shiki theme name, and the responsive Priority+ toolbar. Pierre rendered cleanly with no integration-time surprises.

## Alternatives rejected

### Option 1 — Keep building in-house (rejected)

- Word-level diff producer in Rust would be net-new code (~200 LOC + tests) that Pierre already ships and battle-tests.
- Shiki integration in React land is doable but every consumer in `src/features/diff/components/` would need to call into the highlighter; Pierre wraps that.
- Time-to-value for hunk staging is worse — we still need Rust handlers regardless, but Pierre adds the UI affordance for free.

### Option 2 — Hunk CLI in a terminal pane (rejected for now)

- Embedded diff panel UX disappears; users have to launch a terminal to review.
- Loses workspace integration: file-list click → opens diff in pane wouldn't survive, commit metadata wouldn't bind, hunk stage button wouldn't exist.
- Hunk's agent-annotation UI is excellent and worth keeping in mind as a future "open in hunk" power-user shortcut (Path C in [#255](https://github.com/winoooops/vimeflow/issues/255)). Not now.

## Locked-in design choices (carry into the planner)

### Library and component

- **Dep:** `@pierre/diffs@^1.2.2` (Apache-2.0). React via `@pierre/diffs/react`.
- **Primary component:** `<MultiFileDiff>` — takes `oldFile`/`newFile` as `FileContents` objects and computes the diff itself. Filename drives Shiki language inference.
- **Defer:** `<PatchDiff>` (raw patch input) and `<FileDiff>` (pre-computed `FileDiffMetadata`) — both available, neither needed for the v1 integration.
- **Worker pool:** spike uses `disableWorkerPool` (main-thread). Production integration **must** enable `<WorkerPoolContextProvider>` so Shiki tokenization runs off-main-thread for large diffs.
- **Virtualization:** not in v1. Swap `<MultiFileDiff>` for `<VirtualizedFileDiff>` once we have a concrete large-file complaint or a measured frame-budget regression.

### Defaults (the saved-state initial values)

| Option               | Default         | Why                                                                                                                                                 |
| -------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diffStyle`          | `'split'`       | Matches the existing `DiffPanelContent` mental model and Pierre's own default for code review. Users on a wide pane see two columns immediately.    |
| `theme`              | `'pierre-dark'` | Closest to the Obsidian Lens out of the box. Long-term replace with a registered Shiki theme generated from `tailwind.config.js` Catppuccin tokens. |
| `lineDiffType`       | `'word'`        | "Highlight changed words within lines" — the most legible intra-line diff for code.                                                                 |
| `diffIndicators`     | `'classic'`     | `+`/`-` glyphs match what users see in `git diff` output and CLI tools.                                                                             |
| `overflow`           | `'scroll'`      | Long lines don't soft-wrap; users can horizontally scroll. Wrap is opt-in.                                                                          |
| `disableLineNumbers` | `false`         | Line numbers on.                                                                                                                                    |
| `disableBackground`  | `false`         | Add/remove row tint on.                                                                                                                             |
| `disableFileHeader`  | `false`         | File-name header on.                                                                                                                                |
| `stickyHeader`       | `true`          | File header stays pinned while scrolling — long diffs benefit.                                                                                      |

### Responsive width bands (single source of truth)

| Width                                                    | Toolbar                                        | Diff body                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `≥ 720px` (`SPLIT_MIN_WIDTH_PX`)                         | Priority+ keeps as much as fits in **one row** | `<MultiFileDiff>` in user's saved `diffStyle`                                                                                |
| `360 – 720px` (`DIFF_MIN_WIDTH_PX … SPLIT_MIN_WIDTH_PX`) | Same toolbar, more chips fold into `…`         | `<MultiFileDiff>` silently coerced to `unified` — saved preference preserved                                                 |
| `< 360px` (`< DIFF_MIN_WIDTH_PX`)                        | Toolbar still mounted + interactive            | **Diff stops rendering** — placeholder card: `unfold_more` icon + "Pane is too narrow to render the diff. Widen to ≥ 360px." |

Both thresholds are tunable constants at the top of the demo file. The user's `diffStyle` choice is **never overwritten** by the coercion — it just reads as `effectiveDiffStyle = forced ? 'unified' : diffStyle`. Widen the pane back and the saved choice returns.

### Toolbar UX (chip-style, Priority+ overflow)

- **Layout:** single row (`maxRows = 1`). Anything that doesn't fit collapses into a trailing `…` (`more_horiz`) chip; its popover stacks hidden controls vertically.
- **Priority order** (highest first — last to overflow into `…`):
  1. `split / unified` segmented pill (matches `DiffToolbar.tsx` mode toggle)
  2. `highlight` (line-diff type) — the most actionable knob, Pierre-screenshot parity
  3. `theme`
  4. `indicators`
  5. `overflow`
  6. `line numbers` toggle
  7. `background tint` toggle
  8. `file header` toggle
  9. `sticky header` toggle
- **Chip space reservation.** Measurement also checks the trailing free space on the last visible item's row; if the chip (`w-8` = 32 px + `gap-x-3` = 12 px = 44 px) wouldn't fit, cutoff pulls back one item so the chip lands on the same row instead of wrapping below.
- **Re-measurement:** `ResizeObserver` on the toolbar container. Phase A renders all items, measures, sets cutoff. Phase B trims + adds chip. `resizeTick` bumps on every observer fire to defeat React's same-value setState bail-out.

### Dropdown / popover primitive

- **Built on `@floating-ui/react`** — same primitive as our `Tooltip` per [2026-04-22-tooltip-library.md](./2026-04-22-tooltip-library.md). `useFloating` + `FloatingPortal` + `useDismiss` + `useRole({ role: 'menu' })`.
- **Portal-rendered** to escape the diff pane's `overflow:auto` stacking context — solves the "popover gets clipped by Pierre's rendered diff" bug observed during the spike.
- **Placement:** `bottom-start` for control dropdowns, `bottom-end` for the overflow `…` menu, both with `flip()` + `shift({ padding: 8 })`.
- **Option rendering:** label + optional description; selected option in `text-primary` (lavender).

### Visual language (Obsidian Lens conformance)

- Toolbar container: `bg-surface-container-low/50 backdrop-blur-sm border border-outline-variant/10 rounded-lg` — glass surface, near-invisible border, matches `DiffToolbar.tsx:7`.
- Segmented pills: active = `bg-primary text-on-primary`; inactive = `text-on-surface-variant hover:text-on-surface`. Outer wrapper `bg-surface-container/40 rounded-full p-0.5`.
- Dropdown chips: `bg-surface-container-high/60 hover:bg-surface-container-highest/80 rounded-md`.
- Toggle pills: active = `bg-primary/20 text-primary`; inactive = `bg-surface-container/40 text-on-surface-variant`. Icon: `check_box` / `check_box_outline_blank` via `material-symbols-outlined`.
- Labels (dropdown prefix): `font-label text-[0.7rem] uppercase tracking-wider` — same chrome as `DiffToolbar`.
- Popover menu: `bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl rounded-lg`.

### What the spike is **not** shipping as-is

- `PriorityPlus`, `Dropdown`, `Segmented`, `Toggle` are in-file in `PierreDiffsDemo.tsx`. Production should promote them to `src/components/` (or a `src/features/diff/components/toolbar/` if scope justifies it).
- The `SPIKE_PIERRE_DIFFS` env-gated short-circuit in `DiffPanelContent.tsx:21–25` gets removed in the integration phase — the real renderer goes inline.
- Machine-local fixtures under `docs/spikes/pierre-diffs/` stay out of git. The integration consumes real `useFileDiff` output and converts it to Pierre's `FileContents` (`{ name, contents }`) on the fly.
- Hunk stage/unstage wiring (acceptance criterion #5 in [#255](https://github.com/winoooops/vimeflow/issues/255)) is **not** done in the spike — it needs new Rust handlers (`stage_hunk` / `unstage_hunk` / `discard_hunk`) plus the wiring through Pierre's `diffAcceptRejectHunk` utility. Planner should treat that as a stage in the integration spec.

## Known risks & mitigations

| Risk                                                                                            | Likelihood | Mitigation                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Production bundle weight (Shiki + Pierre = ~3 MB unpacked)                                      | Medium     | Tree-shaking is good; Pierre's worker bundle keeps the main thread snappy. If first-paint or AppImage size regresses, lazy-load the diff feature behind the dock-panel tab activation.           |
| Theme mismatch — Pierre themes don't exactly fit Obsidian Lens                                  | Medium     | Short-term: ship `pierre-dark` default. Long-term: register a custom theme via `registerCustomTheme` derived from `tailwind.config.js` Catppuccin tokens.                                        |
| Tests for the replaced components are now dead weight                                           | Low        | Delete `DiffLine.test.tsx`, `SplitDiffView.test.tsx`, `UnifiedDiffView.test.tsx`, `DiffHunkHeader.test.tsx`, `DiffViewer.test.tsx` during integration. Pierre's internal coverage replaces ours. |
| Rust git parser output shape doesn't trivially map to `FileContents`                            | Low        | Pierre takes raw text — we already have `oldText` / `newText` reconstruction via `git show <ref>:<file>`. Add a small adapter at the service layer.                                              |
| Native esbuild minifier regression (cf. [#249](https://github.com/winoooops/vimeflow/pull/249)) | Low        | Already on terser. Run a production build during the spike close-out to catch any new mangling.                                                                                                  |
| Apache-2.0 NOTICE preservation on AppImage release                                              | Low        | Add Pierre + Shiki + hast-util-to-html to a `THIRD_PARTY.md` when we ship the next packaged release.                                                                                             |

## References

- Tracking issue: [#255](https://github.com/winoooops/vimeflow/issues/255)
- Library: <https://www.npmjs.com/package/@pierre/diffs>
- Source: <https://github.com/pierrecomputer/pierre/tree/main/packages/diffs>
- Live docs + demo: <https://diffs.com>
- Pierre Computer Company: <https://pierre.computer>
- Hunk (alternative considered): <https://github.com/modem-dev/hunk>
- Tooltip / floating-ui decision: [2026-04-22-tooltip-library.md](./2026-04-22-tooltip-library.md)
