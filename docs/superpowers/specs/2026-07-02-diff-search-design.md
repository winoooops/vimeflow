# Single-File Diff Search — Design Spec

**Status:** Complete — whole-spec codex pass pending
**Issue:** [VIM-252](https://linear.app/vimeflow/issue/VIM-252) — feat(diff): add single-file diff search and collapsible snippets (search half)
**Date:** 2026-07-02
**Branch:** `feature/vim-252`

## 1. Context & problem

**Issue:** VIM-252 (Urgent) — *feat(diff): add single-file diff search and collapsible snippets*. This spec covers the **search half only**; collapsible hunks/context get their own spec and PR (pierre ships native collapse options — `collapsedContextThreshold`, `expandUnchanged`, `expansionLineCount` — so that half is likely mostly configuration and must not be entangled with this one). PR #632 already shipped the narrow split-side `h`/`l` slice.

**Problem.** Reviewing a large diff file means visually scanning for identifiers. There is no in-file search: the browser's find can't see into the diff (shadow DOM), workspace-wide search doesn't exist, and the only navigation is file/hunk stepping. Users need vim-style search *within the currently selected diff file*: type a query, see every match highlighted, jump between matches, and read a `current/total` count — without leaving the keyboard.

**Approved UX direction** (interactive mockup `.lifeline-planner/vim-252-diff-search-mockup.html`, session artifact, not committed; direction approved 2026-07-02): a floating glass magnifier button hovers over the diff body — deliberately *not* in the chip toolbar — and expands into a glass search popup anchored on the same corner, visually a sibling of the #645 unpinned changed-files panel. This intentionally supersedes the issue's "reuse existing toolbar/menu primitives" line for the *entry point*; the popup still reuses shared glass/tooling primitives where they fit.

**Renderer constraints** (verified against `@pierre/diffs@1.2.2` dist source + upstream repo, 2026-07-02):

1. All diff line DOM lives in an **open shadow root** (`<diffs-container>`); light-DOM queries and stylesheets do not reach it.
2. Every pierre re-render (async syntax-highlight arrival, theme change, options identity change, `lineAnnotations` identity change, hunk expand) **rebuilds all line DOM via `innerHTML`** — externally attached ranges/marks die on each rebuild. `options.onPostRender` is the sanctioned post-rebuild signal; `options.unsafeCSS` is the sanctioned way to inject CSS into the shadow tree.
3. **No search or span-decoration API exists** in any stable pierre release (upstream issues [#884](https://github.com/pierrecomputer/pierre/issues/884) span decorations and [#846](https://github.com/pierrecomputer/pierre/issues/846) built-in search are open, no timeline; 1.2.x upgrades are bug fixes; the 1.3-beta "search" is scoped to their editor component). In vimeflow's usage (no `<Virtualizer>` provider) **nothing is virtualized** — every line is always present in the shadow DOM.
4. Per-line DOM is stable and text-faithful: each `[data-line]` element's `textContent` equals the raw source line (gutter numbers live in a sibling column; `+`/`-` are CSS pseudo-elements; tabs stay literal). `data-line-index` + column side identify visual order; split view renders deletion/addition columns as sibling subtrees, so DOM order ≠ visual order.

**Goal.** Vim-modal search over the selected file's rendered diff lines, built entirely outside pierre against the four constraints above, with the keyboard contract in §3 and zero regression to existing diff shortcuts, review comments, staging, or the #645 sidebar.

## 2. UX contract

**Floating search button** (entry point, rendered only when a diff file is selected and wide enough to render — hidden in empty/narrow-placeholder states):

- Anchored inside the diff panel's relative container: **4px below the chip toolbar's bottom edge, 22px from the panel's right edge** (clears the overlay scrollbar; both values locked from the tuned mockup).
- 34×34px, `rounded-xl`, `border border-outline-variant/25`, `bg-surface-container-high/30 backdrop-blur-[14px] backdrop-saturate-150`, soft shadow. Icon: 15px magnifier, `text-on-surface-muted`; **hover changes icon color only** (`hover:text-primary`) — no border/glow/fill change. Hidden while the popup is open (the popup "grows out of" the button's corner).

**Search popup** (same anchor, `transform-origin: top right`):

- 330px wide, clamped to `panel width − 24px` when the panel is narrower (below `DIFF_MIN_WIDTH_PX` the whole diff surface — button and popup included — is already replaced by the narrow placeholder). `rounded-2xl`, `border border-outline-variant/30`, `bg-surface-container-high/85 backdrop-blur-[34px] backdrop-brightness-110 backdrop-saturate-[180%]`, modal-tier shadow — the exact #645 unpinned-sidebar recipe, so the two surfaces read as siblings.
- Contents, left to right: text input (JetBrains Mono, placeholder "Search in diff…", `spellcheck=false`) · match counter (mono, muted, `aria-live="polite"`) · separator · prev/next icon buttons · close icon button. `role="search"`; every control has an aria-label; all reachable by Tab.
- Open/close animation: opacity + `scale(0.92) translateY(-6px)` → identity, 200ms ease-out, `motion-safe` only.
- **Modeless**: clicking into the diff does *not* dismiss the popup (required for `n`/`p` match navigation — focus lives in the diff while the popup stays visible). Only `Esc` or the close button dismisses.
- **Primitive choice**: this is explicitly *not* the shared `Popover` primitive — `Popover` is `role="dialog"`, portaled, and dismiss-on-outside-click, all three wrong for a modeless in-pane tool. The popup is an absolutely-positioned surface inside the diff panel subtree, following the #645 unpinned changed-files panel precedent. No `@floating-ui` involvement (the VIM-116 lint ratchet is untouched); chrome composes existing primitives (`IconButton`, `Tooltip`, glass classes per the recipe above). Staying inside the panel subtree is load-bearing: `useKeyboard`'s diff-scope containment check must keep seeing popup-focused events. **Design-system note:** `docs/design/UNIFIED.md`'s floating-surface rule ("compose `Dropdown`/`Menu`/`Popover`, don't hand-roll") targets anchored/portaled floating-ui surfaces; this popup — like the #645 unpinned changed-files panel it mirrors — is an *in-pane tool layer*, a different class. The implementation PR must record this classification as an explicit exception in `UNIFIED.md` so the contract stays enforceable rather than silently eroded.

**Counter states**: no query → empty; query with matches → `k/N` (1-based); query with no matches → `0/0`. Count updates live on every keystroke.

**Match painting** (CSS `::highlight()`, theme tokens only):

- All matches: `selection` token background (`vf-diff-search` highlight).
- Active match: `primary-container` background + `on-primary` text (`vf-diff-search-active`) — `::highlight()` can't paint box-shadows/rings, so contrast comes from the stronger fill.
- Painting is substring-precise within lines, both sides in split view.

**Behavior across state changes** — two explicitly distinct recompute rules, keyed on file identity:

- **File switch while open** (the selected entry's *identity* changes — **repo root + file path + staged/unstaged lane**, the same identity the changed-files list selects by): popup stays open, query persists, matches recompute against the new file, and the active index **resets to the first match**. The view scrolls only on explicit navigation, not on recompute.
- **Same-file recompute** (pierre rebuild — including async syntax-highlight arrival — manual refresh, unified↔split or word-diff toggles): highlights re-applied automatically, and the active index is **preserved, then clamped** to the new match count (never dangles).
- Highlight re-apply **composes with, never replaces**, any other `onPostRender` consumer, and must never hand pierre fresh function identities per render (function-valued options fail pierre's deep-equality check and force full DOM rebuilds; exact composition contract in §4).
- **Diff becomes empty** (file deselected / no changes): popup closes, query clears, button hides.
- **Narrow placeholder engages** (panel drops below `DIFF_MIN_WIDTH_PX`): search closes exactly like the empty transition — query and paint cleared, `n`/`p` revert to file navigation. Search is never open while its UI is unrenderable (no invisible key remapping).

**Out of scope for this surface**: replace, regex/smart-case, cross-file search, match-count badges on the changed-files sidebar.

## 3. Keyboard contract

All diff-scope bindings live in the existing `useKeyboard` hook (`src/features/diff/hooks/useKeyboard.ts`) and inherit its guards unchanged: diff-scope focus check, text-entry suppression, terminal/editor exclusion, dialog gate, `confirming` (y/n) branch first, modifier keys bail out. Search extends the hook's options with `searchOpen: boolean` **plus four callbacks** — `onOpenSearch`, `onCloseSearch`, `onNextMatch`, `onPreviousMatch` — wired exactly like the existing action callbacks (`onNextFile` etc.). One new key (`/`); only `n`, `p`, and `Esc` are remapped while open.

**Key ownership is split in two**: `useKeyboard` owns every diff-scope key outside text entry; the popup component's own `onKeyDown` owns `Enter` / `Shift+Enter` / `Esc` while its input is focused — the existing text-entry guard guarantees `useKeyboard` never sees those events, so there is exactly one owner per key per focus state.

**Mode table** (diff scope, no modifiers, not in text entry):

| Key | Search closed (today's behavior) | Search open |
|---|---|---|
| `/` | Open search popup, focus input, select existing query | Refocus input, select query (vim re-search) |
| `n` | Next file | **Next match** (wraps) |
| `p` | Previous file | **Previous match** (wraps) |
| `Esc` | Cancel visual selection (only in visual mode) | **Close search** (clear query + highlights, revert `n`/`p` to files) |
| everything else (`j/k`, `[`/`]`, `h/l`, `s/d/D`, `i/I/u/U/x`, `Y`, `t`, `e/E`, `v/y`, `Ctrl+d/u`) | unchanged | **unchanged** — search remaps nothing else |

**Esc priority** (single ordered rule, replacing today's implicit order): `confirming` y/n branch → dialog-open gate → **search open? close search** → visual mode? cancel selection. If search and visual mode are both active, the first `Esc` closes search, the second cancels the selection. **While `confirming` is active, `Esc` is inert everywhere in the diff scope — including the popup input, whose local handler checks the same flag** — a pending stage/discard confirmation resolves only via `y`/`n` (today's semantics, unchanged).

**Inside the popup input** (handled by the popup's own `onKeyDown`, never by `useKeyboard` — the text-entry guard suppresses all diff shortcuts here):

- `Enter` — commit: jump to the first match (or advance to next if already on one) and **move focus back to the diff panel**, so `n`/`p` immediately work. Popup stays visible.
- `Shift+Enter` — same, but backwards.
- `Esc` — close + clear (same as diff-scope Esc).
- Every other key types into the query; matches and counter update per keystroke.

**Focus rules**: opening (button click or `/`) focuses the input and selects any existing query. Committing (`Enter`) returns focus to the diff panel root. Closing returns focus to the diff panel root (never leaks to `body`). The popup's prev/next/close buttons are Tab-reachable; since the popup sits inside the diff panel's scope and buttons aren't text entries, `n`/`p`/`Esc` still work while a popup button is focused.

**Non-interference**: `/` is ignored during `confirming` and when any dialog is open. Search state never blocks staging/discard/comment shortcuts — a user can stage hunks while matches stay highlighted.

**Discoverability**: the search button's tooltip shows `/` as its shortcut chip (same pattern as the existing `IconButton` `shortcut` prop) — this is the live surface. `DiffLegend` is currently unwired/mockup-derived per `UNIFIED.md`; it gains the `/` + modal `n`/`p` entries only if/when that component ships.

## 4. Architecture & data flow

**New modules** (all under `src/features/diff/`, co-located tests per repo convention):

- `search/matchDiffLines.ts` — **pure matcher**. `matchDiffLines(lines, query)` where lines are `{ key, side, lineIndex, text }` and matches come back as `{ key, side, lineIndex, start, end }[]`, sorted by `(lineIndex, side: deletions-before-additions, start)` — visual order in both unified and split. Case-insensitive substring via lowercase `indexOf` loop, **non-overlapping** (the scan advances past each match, vim-style); empty query → `[]`. No DOM, no React.
- `search/diffSearchDom.ts` — **DOM adapter**, the only file that touches the shadow root. Exposes `collectLines(container)` (walk `[data-line]` elements → matcher input + a key→element map), `paintMatches(matches, activeIndex, elementMap)` (map column offsets to `Range`s across token spans, register `CSS.highlights.set('vf-diff-search', …)` and `'vf-diff-search-active'`), `clearPaint()`, and `scrollToMatch(match, elementMap)` (element `scrollIntoView({ block: 'nearest' })`). **Only `paintMatches`/`clearPaint` are gated** by `supportsHighlightApi()` (`typeof CSS !== 'undefined' && 'highlights' in CSS`) — collection, matching, counter, navigation, and scroll are Highlight-API-independent and fully functional in jsdom; absence of the API degrades *paint only*.
- `hooks/useDiffSearch.ts` — **state owner**. State: `{ isOpen, query, activeIndex, hasNavigated }`; derived: `matches`, counter text. Actions: `open`, `close` (clears query + paint), `setQuery` (recompute, reset `activeIndex` to 0 and `hasNavigated` to false — first match becomes *active* and painted, but not scrolled to), `step(±1)` (wraps, scrolls, sets `hasNavigated`), `commit(direction)` (**first commit after typing scrolls to the current active match without stepping and marks navigation as started** — `hasNavigated ? step(direction) : (scrollTo(active); hasNavigated = true)` — so the second `Enter` advances; resolves the §3 "jump to first match, or advance if already on one" rule with no off-by-one; also returns focus to the panel). Applies the §2 recompute rules: file-key change → reset to first match; same-file repaint tick → preserve + clamp. Returns the four `useKeyboard` callbacks plus props for button/popup.
- `components/DiffSearchButton.tsx`, `components/DiffSearchPopup.tsx` — per §2. Popup renders inside the panel subtree (no portal).

**Pierre integration — the two option additions and the identity rule.** Pierre decides `forceRender` by *deep-equality* on options; a function-valued option with fresh identity every React render fails that check and would turn **every React render into a full pierre DOM rebuild**. Therefore:

- `unsafeCSS`: a **module-level constant** string containing the `::highlight()` rules, referencing theme CSS variables (custom properties cascade into shadow trees, so tokens resolve without extra plumbing):
  `::highlight(vf-diff-search) { background-color: var(--color-selection) } ::highlight(vf-diff-search-active) { background-color: var(--color-primary-container); color: var(--color-on-primary) }`
- `onPostRender`: a **stable identity** function (created once per Panel mount) that forwards to a ref'd handler — the closure never changes, the ref always points at current state. It receives pierre's container node → `node.shadowRoot` is the walk root; no light-DOM querying needed.
- Both are merged into the existing options memo in `Panel.tsx`/`useToolbarState` composition — **wrapping, never replacing**, any future `onPostRender` consumer (compose: call ours, then theirs).

**Repaint pipeline** (single code path for all triggers):

```
trigger ──> collectLines(shadowRoot) ──> matchDiffLines(lines, query) ──> reconcile activeIndex ──> paintMatches
  where trigger ∈ { onPostRender (pierre rebuilt), query change, activeIndex change, open/close }
```

`onPostRender` schedules the walk via one `requestAnimationFrame` (coalesces pierre's back-to-back rebuild bursts, e.g. plain-then-highlighted first paint); query/activeIndex changes reuse the cached line collection (no re-walk — the DOM didn't change). Close → `CSS.highlights.delete(…)` for both names.

**State & wiring in `Panel.tsx`**: `useDiffSearch` is mounted **unconditionally at Panel top level** (React hook rules; Panel has empty/populated render branches) with a **nullable file key** — defined as **repo root + file path + staged/unstaged lane**, deliberately *excluding* diff content or status revision so refreshes remain same-file recomputes. The key transitioning to `null` — or the narrow placeholder engaging — is exactly the §2 close trigger (close popup, clear query and paint). The button and popup render only in the populated branch. Outputs flow to `useKeyboard` (flag + 4 callbacks), `DiffSearchButton`, and `DiffSearchPopup`. No context, no global store — search state is pane-local and deliberately *not* persisted in the diff review state (a reopened session starts with search closed).

**Perf budget**: collect + match is linear; for a 10k-line file with hundreds of matches, keystroke-to-paint must stay under one frame (~16ms). Bulk range construction (`vf-diff-search`) is capped at **1,000 painted matches**; the **active match is registered separately in `vf-diff-search-active` and is therefore always painted, cap or no cap** — navigation reaches and visibly marks every match, and the counter always reports the true total. Cap exceeded is a non-event, not an error.

## 5. Failure modes & edge cases

**Global registry, multiple panels.** `CSS.highlights` is document-global with one `Highlight` object per name — two mounted diff panels would overwrite each other's registrations (last writer wins). The active-painter authority is explicit: Panel passes `useDiffSearch` a **`paintEnabled: boolean` derived from panel visibility** (the dock is session-scoped, so exactly one diff panel is visible at a time; the existing `useKeyboard` `enabled` flag is hard-coded `true` today and is *not* a sufficient signal). Contract: `paintEnabled` false→true transition triggers a repaint; true→false and unmount clear both registry names; `paintMatches` additionally verifies `container.isConnected` before registering. One painter at a time, by defined authority. (Highlight names stay fixed constants — no per-instance suffixing, which would break the constant `unsafeCSS` string.)

**Rebuild races.** `onPostRender` can fire in bursts (plain paint → highlighted paint). The rAF-scheduled walk coalesces: at most one walk per frame, always against the *current* shadow DOM; both highlight registries are fully re-`set` on every repaint, never incrementally patched — stale `Range`s (pointing at disconnected nodes) are dropped wholesale, so a race can cause at most one frame of missing paint, never a crash or ghost highlight. **A queued frame can outlive its owner**, so repaints are generation-gated: close/disable/unmount cancels the pending rAF id *and* bumps a generation counter, and the rAF callback re-checks `generation` + `paintEnabled` before touching `CSS.highlights` — a stale frame can never re-register ranges after cleanup or after another panel takes over painting.

**Zero matches.** Counter shows `0/0`; `n`/`p` are no-ops (no wrap, no scroll, no error); both registries cleared. Same state after a file switch that yields no matches (no scroll on recompute, per §2).

**Degraded environments.**
- No `CSS.highlights` (jsdom, hypothetical runtime): paint no-ops; matching, counter, navigation, and scroll fully work (§4 guard placement).
- No `shadowRoot` on the container (a future pierre restructuring): `collectLines` returns `[]`; the popup still opens, counter shows `0/0`, nothing throws. The pierre coupling is confined to `diffSearchDom.ts`, so a breakage surfaces as "search finds nothing" — visible, not corrupting.

**Interplay with existing features.**
- Staging/discard/comments operate on pierre's annotation/selection props — search touches none of them; a repaint after `s`/`d` re-applies highlights via the same pipeline. Search state survives staging a hunk (same-file recompute: preserve + clamp).
- Visual selection (`v`/`y`) coexists; `Esc` ordering per §3. Native text selection in the diff is unaffected (`::highlight` doesn't own selection).
- The #645 changed-files overlay and the search popup can be visible simultaneously (opposite corners; no z-order conflict — both are panel-local layers above the scroll body).
- Browser panes: the popup lives in the DOM plane inside the dock — existing WebContentsView occlusion behavior is unchanged; no `areBrowserPanesOccluded` entry needed (it's not a workspace-level modal).

**Theme switch.** `unsafeCSS` references `var(--color-*)` tokens — a theme change re-resolves colors automatically; pierre also fully re-renders on theme change, which re-runs the same repaint pipeline. No special handling.

**Session restore.** Search state is deliberately not persisted (§4); restored sessions open with search closed. No migration, no schema change to diff review state.

**Upstream exit strategy.** If pierre ships span decorations (#884): delete `diffSearchDom.ts` paint internals, feed matches to the decorations API — matcher, hook, keymap, UI unchanged. If pierre ships built-in search (#846): write a decision record comparing before adopting; our keymap modality and glass UI are unlikely to be replaceable wholesale.

## 6. Testing approach

Vitest + Testing Library, co-located per repo convention; TDD per `rules/` (tests first, 80% floor). Layer by layer:

- **`matchDiffLines.test.ts`** (pure): empty query → `[]`; case-insensitivity; multiple matches per line; non-overlapping scan (`"aa"` in `"aaaa"` → 2); cross-side ordering (deletions before additions on the same `lineIndex`); multi-line ordering — the split-view visual-order guarantee.
- **`useDiffSearch.test.ts`** (renderHook): open/close/setQuery lifecycle; `hasNavigated` — first `commit` scrolls without stepping, second steps; `step` wrap in both directions; zero-match no-ops; **file-key change → reset to 0** vs **same-file repaint → preserve + clamp**; nullable file key closes + clears; unmount/`paintEnabled` false → clear called, pending frame canceled (generation gate).
- **`diffSearchDom.test.ts`** (jsdom supports `attachShadow`): `collectLines` against a synthetic shadow fixture mirroring pierre's shape (`[data-content]`/`[data-line]`/`data-line-index`, split sibling columns); offset→`Range` mapping across multiple token spans (assert start/end containers + offsets, tabs and leading whitespace intact); paint no-ops without `CSS.highlights`; with a stubbed registry (`vi.stubGlobal`) assert `set`/`delete` per name, the 1,000 bulk cap, and the active range always registered.
- **`DiffSearchPopup.test.tsx`** (Testing Library, role-first queries): `role="search"`; all controls reachable via `getByRole` with accessible names; counter states (empty / `k/N` / `0/0`); local `Enter`/`Shift+Enter`/`Esc` ownership incl. the `confirming` guard.
- **`DiffSearchButton.test.tsx`**: render/hide rules, aria-label, `/` shortcut chip.
- **`useKeyboard.test.ts`** (extend existing): `/` fires `onOpenSearch` (and refocus while open); `searchOpen` remaps exactly `n`/`p`/`Esc`; closed mode keeps file nav; Esc priority chain incl. inert-under-`confirming` and search-before-visual; unrelated keys unchanged in both modes.
- **`Panel.test.tsx`** (extend existing): wiring (flag + callbacks reach `useKeyboard`); popup closes on empty-diff transition; **pierre options stability** — `options` stays deep-equal across unrelated Panel re-renders with search mounted (guards the §4 identity rule).

Acceptance-criteria mapping (Linear): "search operates within one file and jumps between matches" → `useDiffSearch` + `useKeyboard` tests; "tests cover search navigation" → the two navigation suites above. E2E (packaged Electron has real shadow DOM + `CSS.highlights`) is a **follow-up, not a gate**: one spec in `tests/e2e/core` — open, type, assert counter, `n`, `Esc`.

## 7. Out of scope & future work

- **Collapse half of VIM-252** — its own spec/PR. Pierre's native `collapsedContextThreshold`/`expandUnchanged`/`expansionLineCount` make it mostly configuration; that spec must define the search↔collapse interplay (mockup precedent: searching auto-expands blocks containing matches) and the §2 recompute rules already accommodate it (hunk expand = same-file recompute).
- **Not in this feature**: regex/smart-case, replace, cross-file/workspace search, persisted search state, sidebar match badges.
- **Upstream watch**: pierre #884 (span decorations — would delete our paint layer) and #846 (built-in search — decision record before adopting). Exit strategy in §5.
