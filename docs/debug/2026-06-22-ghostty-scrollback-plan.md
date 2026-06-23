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
