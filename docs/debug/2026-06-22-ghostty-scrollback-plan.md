# Ghostty scrollback (scroll up to see history) — VIM-216 plan

**Status:** approved approach, implementing · **Branch:** `fix/ghostty-scrollback` · base umbrella

## The bug (root cause — confirmed, not a mystery)

On the Ghostty native render path you cannot scroll up to see history in any agent session
(codex/claude/shell). Three concrete gaps:

1. **No wheel/scroll handler** anywhere in `src/features/terminal/`.
2. **Every render snaps to `'bottom'`** (`terminalTextSurface.applyScrollMode`) — even if you could
   scroll, the next snapshot yanks you down.
3. **Scrollback is never fetched** — the bridge calls `snapshot({includeCells:true})`, never
   `includeScrollback`. Only the ~30 visible rows reach the DOM.

Confirmed: codex/claude run on the **main screen** (`isAltScreen=false`) and DO accumulate real
libghostty scrollback (resumed codex = 119 lines; fresh shell = 0). libghostty exposes it:
`snapshot({includeScrollback:true})` → `scrollbackLines` (text-only), and `formatHtml()` → the
**full styled** buffer (already parsed per-frame in the bridge for bg synthesis).

## Decision: STYLED history (user choice, 2026-06-22), fetched lazily

Live viewport stays styled via the existing `cells[]` path. Scrolled-up history is **also fully
styled**. Because per-frame styled-scrollback over IPC would jank, styling is fetched **lazily**:

- Per-frame snapshot: viewport-only + `scrollbackRowCount` + `isAltScreen` (cheap).
- Dedicated channel `READ_SCROLLBACK(driverId)` → styled scrollback cells, parsed from `formatHtml`'s
  scrollback rows (extend the existing HTML walker to emit fg/bg/bold/italic/underline). Fetched
  only while `userScrolledUp`, refreshed on a throttle as scrollback grows.
- Scroll UX: xterm.js sticky-bottom. Default stuck-to-bottom (live). Wheel-up → freeze
  (`applyScrollMode` no-op) + scroll-anchor across prepends. Scroll back to bottom OR any keypress →
  resume live. Alt-screen TUIs (vim/less): scrollback suppressed (today's behavior); wheel→paging
  forwarding is a separate follow-up.
- Perf: per-frame stays cheap; on very long sessions the lazy fetch + render of history is the cost,
  paid only while reading. Virtualization (windowed render) is the documented follow-up if needed.

## Architecture note (de-risked 2026-06-22)

The render-state IPC is **synchronous** (`ipcRenderer.sendSync`, see
`ghostty-render-state-preload`). So `READ_SCROLLBACK` is a **synchronous** channel: the surface
fetches styled scrollback inline on scroll-up — no async fetch, no fetch/live-frame race, no
scroll-anchoring across an async boundary. This collapses the riskiest part of the plan.

## Progress

- **Step 1 DONE** — committed `2e28d726`. Scroll state machine in `terminalTextSurface.ts`
  (`userScrolledUp` + wheel/scroll listeners; `applyScrollMode` no-op while scrolled; scroll-anchor
  in `renderOutput`; typing/scroll-to-bottom resumes). 6 mutation-checked tests in the new
  `terminalTextSurface.test.ts`. (Note: a `git checkout` clobbered the WIP mid-step; recovered by
  re-applying via Edit — never `git checkout <file>` with uncommitted WIP.)

## Step 2 DONE + Step 3 design (refined 2026-06-23)

- **Step 2 DONE** — committed `a94a8a9b`. Bridge requests `snapshot({includeScrollback:true})`,
  reports `scrollbackRowCount` (computed in main, lines stay there) + `isAltScreen`; suppressed
  (count 0) on alt screen. 2 tests; bridge suite 39 green.
- **Confirmed:** native `cells` are **viewport-only** (rows 0..viewport-1, never negative/scrollback);
  `scrollbackLines` is text-only `{row,text}`. **The only styled source for scrollback is
  `formatHtml`** — so Step 3 must parse it.
- **Step 3 approach:** extend the existing HTML walker (`readReverseVideoRangesFromHtml` + its
  `readTagCellStyle`) to emit **full styled cells** (text + fg/bg/bold/italic/underline), reuse the
  existing `rowShift` anchor, and take the rows that map **outside** the viewport above
  (`contentRow + rowShift < 0`) as scrollback, re-indexed 0-based top-down. Return them over a new
  sync `READ_SCROLLBACK` channel. (libghostty gives no styled scrollback; `formatHtml` is per-frame
  already, but READ_SCROLLBACK is called only on scroll-up so the parse cost is paid only then.)

## Step 3 — codex verdict corrections (2026-06-23)

Codex reviewed the design ("sound") with concrete corrections, adopted:
1. **Shared tokenizer, two readers** — do NOT make the per-frame `readReverseVideoRangesFromHtml`
   emit styled cells (allocates scrollback-sized data every frame). Extract the tokenizer/style-stack
   walk once; keep `readReverseVideoRangesFromHtml` (per-frame bg) + add
   `readStyledScrollbackFromHtml` (lazy, scrollback only) on top.
2. **Parse CSS declarations** (split on `;`), not a loose `color:` regex — else it matches inside
   `background-color:`.
3. **Convert fg + bg to HEX** (reuse `paletteIndexToHex`/`toHexColor`); do NOT pass
   `var(--vt-palette-N)` through — `createGhosttyVtRenderSnapshotOutput` only encodes hex into SGR
   sentinels and drops raw CSS vars before DOM styling.
4. **Coalesce styled runs** into sparse cells (not one-per-char) — sync-IPC payload sanity at 10k.
5. Return `{ rows, cells }`, omit cursor; **`rows.length = -rowShift`** (preserve internal blank
   scrollback rows); cell `row` relative to returned rows.
6. **Share the `rowShift`/`canAlign` helper** with `normalizeSnapshot` (no duplication); return empty
   on alt-screen or when alignment is impossible. Test `/resume` + a trailing styled-blank row.

(Awaiting the opus review of the surface-integration path before implementing.)

## Opus review — CRITICAL finding (2026-06-23): the surface has no rows+cells path

Both codex and opus return **GO-WITH-CHANGES** (design sound). But opus traced the full pipeline and
found the brief's premise wrong: the surface does NOT render rows+cells. `createGhosttyVtRenderSnapshotOutput`
collapses `{rows, cells}` into ONE flat string (SGR sentinels via `readStyledRowText`) →
`displayDelta` `replace` → `TerminalDisplayBuffer.replace()` (clear+rewrite the whole buffer every
frame) → flat `runs[]` → DOM. There is no viewport/scrollback region; `userScrolledUp` only moves
scroll position. So "return {rows,cells} and the surface prepends them" describes a path that does
not exist.

**Consequence — revised steps:**
- **Step 3 (main, low-risk, isolated):** `readScrollback` returns styled `{rows, cells}` (0-based,
  top-down). Corrections: extract a shared `computeRowShift(snapshot, rows, contentRowCount)` used by
  BOTH `normalizeSnapshot` and `readScrollback` (never recompute from a 2nd snapshot — desync). New
  parallel `HtmlCellStyle` type + `readStyledCellsFromHtml` reusing the tokenizer primitives
  (do NOT widen `ReverseVideoRange` helpers). fg+bg→HEX (`paletteIndexToHex`/`toHexColor`; raw
  `var()` is dropped by `readSgrColorParameters`). Parse CSS declarations (split `;`). Coalesce runs.
  `rows.length = -rowShift`. Clamp the `rowShift==-1` false-positive blank row. Bound payload
  (bottom-N) + streaming `regex.exec`. Alt-screen → empty.
- **Step 4 (plumbing, currently MISSING):** `scrollbackRowCount`/`isAltScreen` are dropped today at
  `normalizeNativeSnapshot` AND the preload type — thread them through both so the renderer can gate.
- **Step 5 (THE real integration, bigger than scoped):** on scroll-up, encode each scrollback row
  via the existing `readStyledRowText` sentinel encoder, **concatenate ahead of the viewport
  `displayText`** as one `replace`; handle `trimLeadingEmptyRows` (don't rotate history) + cursor
  offset shift. Prototype against one real frame first.
- **Step 6:** alt↔main transition reset + e2e.

opus fallback if styling proves too costly: render text-only `scrollbackLines` unstyled above the
viewport (content history now, styling later) — same integration risk, less walker work.

## Steps (TDD, co-located *.test.ts)

1. **Surface scroll state machine** (common): `userScrolledUp` flag + wheel/scroll listeners on the
   surface root; `applyScrollMode` no-op while scrolled; scroll-anchor in `renderOutput` across
   prepends; keypress/scroll-to-bottom resets. New `terminalTextSurface.test.ts`.
2. **Bridge per-frame: `scrollbackRowCount` + `isAltScreen`** in the normalized snapshot
   (`electron/ghostty-render-state-main.ts`), gated off alt-screen.
3. **Bridge `READ_SCROLLBACK` channel**: styled scrollback cells from `formatHtml` (extend the HTML
   walker to full styling; reuse without the viewport rowShift). New channel + handler + types.
4. **Renderer IPC + service binding** for `READ_SCROLLBACK`
   (`ghosttyNativeRenderStateBridge.ts` + service).
5. **Surface renders fetched styled scrollback** above the viewport; combined scroll area;
   throttled refresh; clears on bottom/keypress.
6. **Alt-screen gating + end-to-end test** (`ghosttyInstance.test.ts`) + manual smoke.

## Risks (from research)

- jsdom has no layout → surface tests must stub `scrollHeight`/`clientHeight`/`scrollTop`.
- Cursor + viewport cell rows must offset by `scrollbackRowCount` consistently.
- `trimLeadingEmptyRows` must not rotate prepended scrollback.
- Scroll-anchor must run every frozen frame (scrollback grows as live lines scroll off).
- Async fetch vs live-frame race + scroll-anchor across the async boundary.
- ≥10k-line sessions: lazy render may need virtualization (deferred).
