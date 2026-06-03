# Browser pane — chrome redesign (L1: Arc-style chrome restyle)

## 1. Overview & scope

### Context

The built-in browser pane shipped its Phase-1 spike in #304 (`BrowserPane.tsx`):
a single-row chrome — capsule tabs + an always-editable address `<input>` + a
"Go" button + "Close" — styled with the lavender `primary` accent and a `ring-1`
focus outline. The design handoff at `docs/design/browser-pane-handoff/`
(`Browser Pane.html` + `README.md`) replaces that chrome with an **Arc-style,
two-row layout** and a **reserved cyan "WEB" identity accent** (`#4fc8d6`).

This handoff is not purely cosmetic: its toolbar contains nav controls
(back / forward / reload), a loading bar, and per-tab favicons — all of which are
already roadmapped as **#316 Phase 2a (navigation controls)** and **2b (favicons
+ loading state)**, and none of which exist in the backend today
(`electron/browser-pane-channels.ts` has `BROWSER_PANE_NAVIGATE`, but no
history-aware back/forward/reload/stop, loading, or favicon channels).

### The increment model

The redesign ships as three sequential increments, each its own spec + plan +
Linear sub-issue under the parent "Browser pane redesign (handoff)":

| Increment | Delivers | Backend |
| --------- | -------- | ------- |
| **L1 — chrome restyle (this spec)** | The full two-row Arc chrome, WEB identity accent, address pill, focus border+glow, open-in-system-browser. Nav controls rendered **disabled**; load bar absent; favicons are deterministic placeholders. | Frontend + two small backend touches (both mirror existing browser-pane channels): `open-external` IPC + a pane-targeted `focus-address` event for page-focused `⌘L` |
| **L2 — navigation controls** (#316 2a) | back / forward / reload wired to the active tab's `webContents`; history state drives button enablement; the reload button toggles to **stop** while loading. | New nav IPC + history events |
| **L3 — favicons + loading** (#316 2b) | Real per-tab favicons (`page-favicon-updated`) and the live load bar / spinner (`did-start/stop-loading`). | New favicon/loading fields + events |

### In scope (L1)

- Two-row chrome: Arc horizontal **tab bar** (WEB chip · capsule tabs with
  favicon + title + close · new-tab · close-pane) over a **toolbar** (nav buttons ·
  centered address pill · open-external).
- A reserved **WEB visual identity** (cyan accent `#4fc8d6` + glyph) so the pane
  consumes the same `accent`/`accentDim` focus machinery the terminal panes use,
  replacing the hardcoded lavender `primary`. It is a standalone `PaneIdentity`
  (a new shared type) owned by the browser feature, **decoupled** from the `AGENTS`
  registry and agent status — `AGENTS` and `registry.test.ts` stay unchanged. Full
  design in §3.
- Focus **ring+glow** keyed to the cyan identity, matching the `TerminalPane`
  treatment: a **constant-width border** for the always-visible ring (color-varying)
  plus an outset `box-shadow` glow (§3.2), replacing today's `ring-1`.
- **Address bar** restyled as a pill with a display↔edit toggle (§4); the
  existing `draft`/`committedUrl` edit logic is preserved verbatim as "edit mode".
- Two small backend touches, both mirroring existing browser-pane channels: a new
  **`open-external`** IPC (active tab's loaded URL → system browser, `http(s)`-only,
  §5) and a pane-targeted **`focus-address`** event (mirrors `browser-pane:focused`)
  so the address bar is reachable while the page has focus (§4.4).

### Out of scope (L1) — deferred to L2 / L3

- Wiring back / forward / reload to real history (**L2**). In L1 these three nav
  buttons render in their handoff styling but are **disabled / non-functional**.
  There is no separate Stop button: the handoff toolbar is back · forward ·
  reload only, so L2 introduces Stop as a **reload↔stop toggle on the same button
  slot** — no L1 slot is reserved and L2 adds zero re-layout.
- Real favicons and the animated loading bar (**L3**). In L1, favicons are
  deterministic placeholder glyphs derived from the URL (§5); no load bar renders.
- Permission prompts, clear-site-data, persistence, automation grants
  (#316 Phases 2c–5) — untouched.
- No change to the native `WebContentsView` host, tab lifecycle, bounds syncing,
  partitions, or CDP proxy — L1 only restyles the React chrome that frames them.

### Success criteria (detail in §6)

1. The pane visually matches `Browser Pane.html` for all _static_ chrome:
   two-row layout, WEB chip, capsule tabs, address pill, focus border+glow.
2. Existing tab + address-bar behavior (activate/close/new tab, navigate, the
   `draft`/`committedUrl` edge cases) is unchanged **except** the "Go" button is
   intentionally removed — Enter submits, and its Tab-to-Go / idle-Go submit paths
   are dropped (§4.3).
3. Disabled nav controls and placeholder favicons are rendered in a way L2/L3
   can light up without re-layout (forward-compatible seams).
4. Lint, type-check, and the full component test suite pass.

## 2. Layout & visual structure

L1 replaces today's single-row chrome with the handoff's two rows. All chrome
lives in the React layer (`src/features/browser/`); the native `WebContentsView`
still renders into the `.page` region via `contentRef` (unchanged).

### 2.1 Pane shell + two-row structure

```
.pane  (focus border+glow — §3; border-radius 10px §3.2; overflow:hidden)
├─ row 1  .tabbar   (h 38px)  — Arc horizontal tabs
├─ row 2  .toolbar  (h 40px)  — nav · address pill · open-external
└─ .page  (flex:1)            — native WebContentsView host (contentRef)
```

Today's chrome is one flex row (tabs + address `<input>` + Go + Close). L1 splits
it: tab management moves to row 1, navigation + address move to row 2. The
`.page` region keeps its current `contentRef` + bounds-sync behavior verbatim.

### 2.2 Component decomposition

`BrowserPane.tsx` is already ~580 lines; the redesign adds structure, so L1
extracts three presentational children (each with a co-located test), leaving
`BrowserPane` as the stateful container (bridge wiring, bounds, draft logic):

| Component | Renders | Owns |
| --------- | ------- | ---- |
| `BrowserTabBar` | WEB chip · tab capsules · new-tab · divider · close-pane | tab list → `onActivate`/`onClose`/`onNewTab`/`onClosePane` callbacks |
| `BrowserToolbar` | nav buttons (disabled) · `BrowserAddressBar` · open-external | nav button slots; hosts the address bar |
| `BrowserAddressBar` | display↔edit pill (§4) | nothing stateful — controlled by props (`draft`, `committedUrl`, `isEditing`) + callbacks; the state machine stays in `BrowserPane` |

`BrowserTab` (single capsule: favicon + title + close-x) may be inlined in
`BrowserTabBar` or split out — left to the plan.

### 2.3 Tab bar (row 1)

- **WEB chip** (`.wchip`) — pane identity: `public` glyph + "WEB", cyan-on-`web-dim`
  fill, `web-soft` border, radius 7px, mono 10px/600. Pure identity marker (no
  action). New element (no analog today).
- **Tab capsules** (`.tabs` → `.tab`) — replace today's `bg-primary/15` active
  styling. Each tab: `[favicon] [title] [close-x]`, h 27px, radius 8px,
  min 96 / max 210px. **Active** = neutral elevated capsule (`--tab-active` fill +
  `rgba(255,255,255,.10)` border + inset/drop shadow), **not** a colored one —
  the cyan stays reserved for pane identity. Inactive = transparent, hover
  `rgba(255,255,255,.04)`. Close-x is `opacity:0` → `.8` on tab hover, `tab--active`,
  **and `focus-within`/`focus-visible`** so keyboard users can reach it; it is
  **hidden when only one tab remains** (today's behavior — the sole tab has no close
  action). Wired to the existing `handleActivateTab`/`handleCloseTab`.
- **Tab overflow** — the handoff's `.tabs{overflow:hidden}` clips extra tabs; L1
  instead preserves today's reachable scroll: tabs flex-shrink toward the 96px min
  as they multiply, then the strip scrolls horizontally (`overflow-x:auto`, today's
  behavior). Auto-scrolling the active tab into view is **not** in L1 — today has no
  such path; it is an L2+ enhancement (preserves §1's "existing behavior unchanged"
  criterion; tested in §6.4).
- **Favicon** (`.fav`) — 16px rounded square, glyph inside. L1 uses placeholder
  glyphs by URL (§5); colors: cyan default, mauve (PR URLs), coral (issue URLs).
- **New-tab `+`** (`.ibtn2`) and **close-pane `×`** (`.ibtn2`, after a divider) —
  26px icon buttons, muted → cyan on hover. New-tab wires to `handleNewTab`;
  close-pane wires to the existing `onClose` (replacing today's text "Close") and, as
  today, is **only rendered when `onClose` is provided** (hidden for non-closable panes).

### 2.4 Toolbar (row 2)

The toolbar is a **3-column grid** — `grid-template-columns: minmax(min-content,1fr)
auto minmax(min-content,1fr)` — so the address pill centers in the **pane**, not in
leftover flex space (the left nav cluster is wider than the single right button, so
the handoff's `margin:0 auto` would sit it off-center). Left = nav cluster
(`justify-self:start`), center = address (`justify-self:center`), right =
open-external (`justify-self:end`). Each side track holds at least its content's
`min-content` (so nav / open-external never clip or overlap) and grows to `1fr`; the
center address (`width:min(520px,100%)`, `min-width:0`) **truncates its URL first**
(§4.2) as the pane narrows. Centering is exact when both side tracks sit at `1fr`
(normal widths) and drifts gracefully once the address has truncated (narrow widths).
The toolbar is `overflow:hidden` / no-wrap, so the sub-realistic case where even a
floored address won't fit clips at the edge rather than reflowing. §6.3's real-browser
check verifies this (jsdom does no real layout).

- **Nav buttons** (`.navbtn`) — back · forward · reload, 27px, radius 8px,
  muted → cyan on hover, `[disabled]` → `--hair` (#4a444f = `outline-variant`) +
  no hover. **All three render `disabled` in L1** (§5); L2 wires them.
- **Address pill** (`.address`) — `width:min(520px,100%)`, h 29px, pill radius
  999px, cyan `web-soft` border + cyan glow ring. Interaction + segment coloring
  in §4.
- **Open-external** (`.navbtn`, `open_in_new`) — opens the active URL in the
  system browser via the new `open-external` IPC (§5).

### 2.5 Token mapping

Reuse existing semantic tokens for exact matches; introduce the chrome-specific
surfaces and the WEB accent (§3).

| Handoff var | Hex | L1 source |
| ----------- | --- | --------- |
| `--surface-lowest` | `#0d0d1c` | reuse `surface-container-lowest` (toolbar + page letterbox) |
| `--on-surface` | `#e3e0f7` | reuse `on-surface` |
| `--on-variant` | `#cdc3d1` | reuse `on-surface-variant` |
| `--muted` | `#8a8299` | reuse `on-surface-muted` |
| `--faint` | `#6c7086` | reuse `syn-comment` token |
| `--bar` | `#121226` | **new token** `browser-bar` (tab-bar fill) |
| `--tab-active` | `#23233b` | **new token** `browser-tab-active` (active capsule) |
| `--web` / `--web-dim` / `--web-soft` | cyan `#4fc8d6` | WEB identity (§3) |
| `--mint` (lock) | `#7defa1` | reuse `success-muted` (= the codex accent) |
| `--mauve` / `--coral` (fav variants) | `#cba6f7` / `#ff94a5` | favicon placeholders (§5) |

The tab bar also carries a subtle top cyan tint
(`linear-gradient(180deg, rgba(79,200,214,.05), transparent 70%)` over the fill) —
ported as a background layer on the tab-bar element.

### 2.6 Reference dimensions (from `Browser Pane.html`)

tabbar h38 / pad 0·8 / gap 5 · toolbar h40 / pad 0·10 / gap 6 · tab h27 r8
(min96 max210) · wchip r7 · fav 16 r5 · ibtn2 26 r7 · navbtn 27 r8 · address h29
r999 maxw520 · divider 1×18. Fonts: JetBrains Mono for all chrome labels/URL
(10–11.5px), matching the handoff.

## 3. WEB identity accent + focus model

### 3.1 A pane visual identity, decoupled from agent status

The cyan focus ring + glow reuses `TerminalPane`'s focus _treatment_
(`TerminalPane/index.tsx:182-198` — a `2px` accent ring + a `0 0 0 6px <accentDim>`
glow, read off an identity object), adapted for the browser's native-view constraint
(a constant-width border ring + a box-shadow glow, §3.2). But the browser
is **not an agent** — no detection, no `AgentStatus`, no model. `shell` is already
a non-agent entry living inside `AGENTS`; adding `web` on top of it is the point
where the **visual identity** concept should be split out from the **agent**
concept rather than bolted onto `AGENTS`.

L1 introduces that split at the type level — no `AGENTS` value changes:

```ts
// src/agents/registry.ts — the shared visual identity of any pane's chrome.
export interface PaneIdentity {
  name: string
  short: string
  glyph: string
  accent: string
  accentDim: string
  accentSoft: string
  onAccent: string
}

// An agent IS a pane identity plus agent-only metadata.
export interface AgentDef extends PaneIdentity {
  id: string
  model: string | null
}
```

The browser owns its identity **in the browser feature**, as a plain
`PaneIdentity` — never registered in `AGENTS`, never reached through
`agentTypeToRegistryKey` / `AgentStatus`:

```ts
// src/features/browser/browserIdentity.ts
import type { PaneIdentity } from '../../agents/registry'

export const BROWSER_IDENTITY: PaneIdentity = {
  name: 'Web',
  short: 'WEB',
  glyph: '⊕', // shape-satisfying fallback; the WEB chip renders the `public`
  //          // Material Symbol, not this glyph (§3.3)
  accent: '#4fc8d6', // --web
  accentDim: 'rgb(79 200 214 / 0.16)', // --web-dim (registry glow weight)
  accentSoft: 'rgb(79 200 214 / 0.30)', // --web-soft
  onAccent: '#06232a',
}
```

`accentDim` uses `0.16` — the glow weight claude/codex/gemini use — rather than the
handoff's isolated `0.12`, so the browser glow reads as a peer of the agent panes in
a split. (`shell` is the lone registry outlier at `0.14`.)

**Decoupling boundary (L1 scope).** `AgentId` and the `AGENTS` key-set
(`registry.test.ts`) are **unchanged** — `web` is never an `AgentId`. `shell`
stays in `AGENTS` because real shell _sessions_ resolve their identity through the
agent path (`agentTypeToRegistryKey` default → `shell`); rerouting that is a
larger change. Lifting `shell` into a dedicated non-agent variants layer alongside
`web` is a **deliberate follow-up**, tracked separately — not L1.

### 3.2 Focus model port

Replace `BrowserPane`'s current shell —
`rounded-lg bg-surface shadow-[inset…] … ring-1 ring-primary/35` — with the
`TerminalPane` pattern, reading `BROWSER_IDENTITY`:

- **Ring = a constant-width border (color-varying); glow = an outset box-shadow.**
  Two traps ruled out the alternatives: a width-varying border (2px focused ↔ 1px
  not) resizes the content box and **jitters** the native view (its bounds come from
  `contentRef.getBoundingClientRect()`, `BrowserPane.tsx:147-154`); an `inset-0`
  overlay span — or an outset-only shadow — is **occluded** by native
  `WebContentsView`s that paint above DOM, and SplitView is `gap-0`, so neighbors
  abut with no buffer. The resolution:
  - **Ring** — a **constant `2px` border** on the outer container; only the _color_
    changes (`${accent}` focused, `rgba(74,68,79,0.22)` not). Constant width ⇒ the
    native view (inset by it) keeps constant bounds (no jitter); the border lives in
    the pane's **own** box at its edge, so a neighbor's native view never covers it,
    even at `gap-0`. This is the always-visible focus signal. (Constant 2px — vs the
    handoff's 1px unfocused — trades a 1px hairline for zero jitter and zero occlusion.)
  - **Glow** — focused only: `box-shadow: 0 0 0 6px ${accentDim}, 0 8px 32px rgba(0,0,0,.35)`.
    Decorative; on a shared `gap-0` edge it may be partially clipped by a neighbor's
    native view — accepted, since the border carries the signal.
- **Container**: `border-radius: 10px` (matches the sibling `TerminalPane`), `bg
  surface`; the `2px` border is constant across focus states, so `contentRef`'s rect —
  and the native bounds — never change with focus.
- **Visibility**: `isFocusVisible = showFocusHighlight && pane.active` — the exact
  condition the component already computes; no prop changes.

### 3.3 Accent consumers + icon set

`BROWSER_IDENTITY`'s cyan is consumed by: the focus border+glow (§3.2), the WEB
chip (fill `accentDim`, border `accentSoft`, text `accent`), the default favicon,
the address-pill ring (§4), and nav-button hover (text → `accent`). The L3 load
bar will reuse `accent` (deferred).

Chrome icons adopt the established `material-symbols-outlined` span pattern (used
throughout the app), replacing today's text `"x"`/`"+"`/`"Go"`/`"Close"`. Exact names:

| Control | Icon |
| ------- | ---- |
| WEB chip · default favicon | `public` |
| PR-URL favicon · issue-URL favicon | `merge` · `adjust` |
| tab close · close-pane | `close` |
| new tab | `add` |
| back · forward · reload | `arrow_back` · `arrow_forward` · `refresh` |
| address lock | `lock` (https, mint/`success-muted`) · `lock_open` (non-https, faint) |
| open-external | `open_in_new` |

**Icon-name verification is mandatory**: an invalid Material Symbol name renders
as raw ligature _text_, and `textContent`-based tests still pass — so every icon
above must be confirmed rendering in a real browser before the work is trusted
green.

**Accessibility.** Every icon span is decorative — `aria-hidden="true"` — with the
accessible name on the parent control (button `aria-label` / the chip's text).
Hover-revealed affordances (close-x) must also reveal on keyboard focus
(`focus-within`/`focus-visible`), per project a11y rules; §6 tests this.

## 4. Address bar — display↔edit toggle

The handoff shows the address as a static, color-segmented pill with a `⌘L` hint;
today it is an always-editable `<input>` + "Go" button. L1 makes the pill a
**two-mode** control. Crucially, the existing `draft`/`committedUrl` state machine
in `BrowserPane` (`BrowserPane.tsx:90-124, 367-381, 499-539`) is **preserved
verbatim** — it simply becomes the "edit mode" behind a display view.

### 4.1 Two modes

- **Display** (idle, default): a read-only, color-segmented rendering of the active
  tab's `committedUrl` — lock · `scheme`·`host`·`path` · `⌘L` hint.
- **Edit** (focused): the existing `<input>` with all its current behavior. The Go
  button is **removed** — Enter submits (the handoff has no Go button).

A single `isEditing` boolean selects the mode (promoted from today's
`isAddressEditingRef`, which already gates the idle url-sync).

`committedUrl` is BrowserPane's **existing** variable — the active tab's current URL,
synced from url/tabs-changed events and updated optimistically on submit. It is a
**display** value (the address bar's text), _not_ a verified-loaded signal; that is
exactly why open-external is main-authoritative rather than trusting it (§5.4).

### 4.2 Display mode

- **Lock** — derived **client-side from the scheme only** (no backend secure state
  in L1): `https` → `lock` in mint (`success-muted`); otherwise → `lock_open` in
  `comment`/faint. (Real cert validity is not available renderer-side; L1 does not
  claim it.)
- **Segments** — `committedUrl` parsed via the `URL` API into `scheme` (faint) ·
  `host` (`on-surface`) · `path+query+hash` (`on-surface-muted`), centered, mono
  11.5px, truncated with ellipsis. A URL that fails to parse renders raw in the
  host color (no crash).
- **`⌘L` hint** — a right-aligned `kbd` chip (`⌘L` on mac, `Ctrl+L` elsewhere),
  faint. Purely a hint; the binding lives in §4.4.
- The whole pill is a `<button>` whose `aria-label` mirrors the **platform-resolved**
  hint (e.g. `address bar — <url>; press Enter or ⌘L to edit` on mac, `Ctrl+L`
  elsewhere) so click / Enter / Space all enter edit mode.

### 4.3 Edit mode

Renders today's `<input>` (same `value={draft}`, `onFocus`/`onChange`/`onBlur`,
`handleSubmit`), styled as the pill (cyan ring, centered text). Preserved unchanged:

- the idle→`committedUrl` mirror, paused while `isEditing` (survives the SPA
  url/tabs-changed event stream — `BrowserPane.tsx:117-124`);
- `normalizeUrl` on submit, then `navigateBrowserPane`;
- blur reverts `draft`→`committedUrl` (cancel).

**Simplified** by dropping Go: the `goButtonRef` / `onMouseDown`-preventDefault /
`relatedTarget === goButtonRef` tab-to-Go branch is deleted — with no Go button,
blur is always a cancel.

### 4.4 Toggle, keyboard & focus

- **Enter edit**: click/Enter/Space on the display button, **or** `⌘L`/`Ctrl+L` →
  `setIsEditing(true)`, then focus + select-all the input (`useEffect` on
  `isEditing`).
- **Exit edit**: Enter (submit→navigate), blur (cancel), or `Escape` (cancel) →
  `setIsEditing(false)`; display re-renders from `committedUrl`.
`⌘L` reaches the address bar over **two pane-targeted paths** — neither relies on
`activePaneId`, and neither steals keystrokes from the editor/dialogs:

- **Chrome focused** (renderer-local): a `keydown` listener on the pane's chrome root
  (`[data-browser-pane-id]`, already present) catches `⌘L` when focus is inside this
  pane's chrome → enters edit. Fires only for this pane.
- **Page focused** (the `WebContentsView` has focus, so keystrokes bypass React):
  main intercepts `⌘L` in the page's `before-input-event` and emits a **new,
  pane-targeted event** carrying `{ sessionId, paneId }` — mirroring the existing
  `browser-pane:focused` event, **not** the generic synthetic-keydown forwarding
  (which is anonymous and only suits window-level shortcuts like the command palette).
  The pane subscribes and enters edit when the ids match.

The page-focused channel mirrors `BROWSER_PANE_FOCUSED`:

| File | Add |
| ---- | --- |
| `electron/browser-pane-channels.ts` | `BROWSER_PANE_FOCUS_ADDRESS = 'browser-pane:focus-address'` |
| `electron/browser-pane.ts` | in `installAppShortcutForwarding`'s `before-input-event`: `KeyL` with the **platform modifier only** (mac `meta && !ctrl`, else `ctrl && !meta`), no `alt`/`shift`, ignoring auto-repeat — an inline main-side predicate mirroring the renderer's `shortcutConfig` platform logic (not an import of that command-palette symbol) → `preventDefault` + send to the **app renderer** via `BrowserWindow.fromId(record.windowId).webContents.send(BROWSER_PANE_FOCUS_ADDRESS, { sessionId, paneId })` (the same `win.webContents` target as `BROWSER_PANE_URL_CHANGED` at `:1000` — **not** the page view's `webContents`) + focus the app window |
| `electron/preload.ts` · `types.ts` · `browserBridge.ts` | an `onFocusAddress(cb)` subscription, mirroring `onFocus` |
| `BrowserPane.tsx` | subscribe; on a matching `{ sessionId, paneId }` → `setIsEditing(true)` |

### 4.5 Ownership

`BrowserPane` (container) keeps `committedUrl`, `draft`, `isEditing`, the bridge
effects, and `handleSubmit`. `BrowserAddressBar` is **controlled** — it receives
`{ committedUrl, draft, isEditing }` + `{ onBeginEdit, onDraftChange, onSubmit,
onCancel }` and renders display-or-edit from props. No address state lives in the
child (consistent with §2.2). Callback shapes: `onSubmit(url: string)` receives the
current draft (the container runs `normalizeUrl` + `navigate`); `onBeginEdit()` /
`onCancel()` take no args; `onDraftChange(value: string)`. The display-mode pill is
`type="button"` so clicking it inside the edit-mode `<form>` enters edit rather than
submitting.

## 5. Inert-controls contract + open-external IPC

L1 renders the full toolbar/tab chrome, but the controls needing backend support
(§1) are inert in _defined_ ways so L2/L3 are wiring-only — no re-layout.

### 5.1 Disabled nav controls (→ L2)

back / forward / reload render with the handoff's `[disabled]` styling
(`--hair`/`outline-variant`, no hover) and are non-interactive: `disabled` on the
`<button>` (native `disabled` already conveys the semantics — no redundant
`aria-disabled`), no `onClick`. They occupy their final slots now
(§2.4). L2 supplies `canGoBack`/`canGoForward`/`isLoading` (history events) + the
handlers, and the reload slot becomes the reload↔stop toggle (§1). L2 changes
enablement + handlers only — no DOM/layout change.

### 5.2 Favicon placeholders (→ L3)

Each tab's `.fav` shows a deterministic glyph + tone from the tab URL — no network,
no `page-favicon-updated` (that's L3):

- PR-like URL (`/pull/`, `/pulls`, `/merge_requests`) → `merge`, mauve.
- Issue-like URL (`/issues`) → `adjust`, coral.
- Otherwise → `public`, cyan (`accent`).

A pure `faviconPlaceholder(url): { glyph, tone }` helper with its own unit test. L3
swaps the glyph/tone source for the real favicon, keeping the 16px slot.

### 5.3 No load bar in L1 (→ L3)

The handoff's `.loadbar` is **not** rendered in L1 (no loading state exists yet),
and L1 reserves no space for it. Note for L3: because the native `WebContentsView`
paints above React (§3.2), the load bar **cannot** be a React overlay over `.page`
— L3 must place it in the chrome layer (e.g. a 2px strip along the toolbar's bottom
edge, above the native region), not over the native view.

### 5.4 `open-external` IPC

Opens the **active tab's** URL in the system browser. Mirrors the existing
`navigate` channel; the handler resolves the URL **main-side from the pane record**
(never trusts a renderer-supplied URL):

| File | Add |
| ---- | --- |
| `electron/browser-pane-channels.ts` | `BROWSER_PANE_OPEN_EXTERNAL = 'browser-pane:open-external'` |
| `electron/browser-pane.ts` | `ipcMain.handle` → resolve the active tab's **loaded** URL (`webContents.getURL()`, not a requested-but-uncommitted target) → validate scheme is `http(s)` → `shell.openExternal(url)` |
| `electron/preload.ts` | expose `browserPane.openExternal(ref)` |
| `src/features/browser/types.ts` | `BrowserPaneBridge.openExternal` + request type (`BrowserPaneRef`) |
| `src/features/browser/browserBridge.ts` | `openExternalBrowserPane` wrapper (no-op when bridge absent) |

Security & enablement: **main is the sole authority** — on invocation it resolves
the active tab's actually-loaded URL (`getURL()`) and opens it only if the scheme is
`http`/`https`; anything else (`about:blank`, `mailto:`, …) is dropped (no-op). The
renderer **cannot** reliably predict the loaded URL in L1 — the tab snapshot's `url`
is the _requested_ target until navigation commits, and there is no committed-URL /
loading signal yet (that arrives with L3). So L1 keeps the button **enabled whenever
an active tab exists** and relies on main's validate-or-no-op; the rare "enabled but
no-ops on a fresh `about:blank` tab" case is benign. And because main opens the
**loaded** URL, a click during a pending navigation — address bar already showing the
just-submitted target, page not yet committed — opens the **currently-loaded** page,
never a not-yet-loaded target (by design — `webContents.getURL()` returns the
last-**committed** URL, not a pending target, so no extra tracking is needed; §6.1
tests it). URL-precise disabling (graying the button on non-http(s)) is deferred to
**L3**, when a committed-URL/loading signal exists.

### 5.5 Forward-compatible seams (summary)

L1's markup already contains every control's final slot. L2 = enablement + history
wiring; L3 = real favicons + load bar. Neither re-lays-out the chrome — the whole
point of rendering inert-but-final in L1.

## 6. Testing & acceptance

Tests follow repo conventions: Vitest (`test()` not `it()`), explicit
`import { test, expect, vi } from 'vitest'` in every new file, co-located
`*.test.tsx`, Testing Library, and the existing `window.vimeflow.browserPane`
bridge-mock pattern from `BrowserPane.test.tsx`.

### 6.1 Component & main-process tests

- **`BrowserTabBar`**: renders WEB chip; active tab = neutral elevated capsule
  (asserts the `--tab-active` treatment, **not** a cyan/`accent` fill); favicon glyph
  matches `faviconPlaceholder(url)`; close-x absent when `tabs.length === 1`, present
  otherwise; new-tab/close-pane fire their callbacks.
- **`BrowserToolbar`**: back/forward/reload render with the native `disabled`
  attribute and fire **no** handler on click; open-external calls the bridge with the
  pane ref (enabled whenever an active tab exists — main is authoritative, §5.4); the
  3-column grid + `overflow:hidden` are present (structure assertions; real
  narrow-width layout is a §6.3 browser check, not jsdom).
- **`BrowserAddressBar`** (presentational, prop-driven by `isEditing`): display
  renders `scheme`/`host`/`path` segments + `lock` (https) / `lock_open` (http);
  click/Enter/Space call `onBeginEdit`; in edit mode the input is focused + selected,
  `Enter` calls `onSubmit` with the draft, `Escape`/blur call `onCancel`. It does
  **not** route `⌘L`, navigate, or normalize — those are asserted on the container.
- **`BrowserPane` (container)**: focus border on the **outer container** toggles with
  `showFocusHighlight && pane.active`; an address-bar `onSubmit` runs `normalizeUrl`
  then `navigate`; **`⌘L` routing** — a chrome-focused `⌘L` keydown and a simulated
  `focus-address` event each set `isEditing`, while a `⌘L` targeting outside the pane
  chrome does not; preserves the existing `draft`/`committedUrl` edge cases (idle sync
  paused while editing, blur-cancel, redirect events).
- **`faviconPlaceholder(url)`** pure unit: PR → `merge`/mauve, issue → `adjust`/coral,
  else → `public`/cyan.
- **`open-external` (main, in `browser-pane.test.ts`)**: resolves the loaded URL
  main-side; accepts `http(s)`, rejects non-http(s)/`about:blank` (no
  `shell.openExternal` call); `shell.openExternal` invoked (mocked) on eligible URLs.
- **`⌘L` focus-address (main)**: a `before-input-event` with `KeyL` + the platform
  modifier (mac `meta`, else `ctrl`) emits `BROWSER_PANE_FOCUS_ADDRESS` for the right
  `{ sessionId, paneId }`; other keys — and `Ctrl+L` on mac — do not.
- **open-external pending-nav (main)**: after a new-URL submit but before commit,
  `getURL()` still returns the prior committed URL, so open-external opens **that**
  (asserts no pending target is opened).
- **Preload/bridge wiring (`preload.test.ts` / `browserBridge.test.ts`)**: the
  `browserPane` bridge exposes `openExternal` and `onFocusAddress` mapped to the
  correct channel constants — the easiest wiring to break silently (per the new-IPC
  checklist).

### 6.2 Accessibility

- Decorative icon spans carry `aria-hidden="true"`; the accessible name is on the
  parent control.
- Close-x is keyboard-reachable — revealed on `focus-within`/`focus-visible`, not
  hover-only (assert by focusing the tab).
- Address pill is a `<button>` with a platform-resolved `aria-label`; disabled nav
  buttons use the native `disabled` attribute.

### 6.3 Real-browser verification (NOT covered by jsdom)

jsdom performs no real CSS layout and treats any string as valid icon text, so two
checks are explicit **manual** acceptance steps in a real browser / Electron build:

- **Icons**: every Material Symbol in §3.3 (incl. `lock_open`) renders as a glyph,
  not raw ligature text (an invalid name passes `textContent` tests but shows words).
- **Narrow-width layout**: the toolbar shows no horizontal overflow and no wrap at a
  representative narrow (quad-layout) pane width; the address truncates first.

### 6.4 Regression

The existing `BrowserPane.test.tsx` behavioral suite (tab activate/close/new,
navigate, address draft/commit edge cases) stays green, updated for the new
component structure. **Exception:** the removed "Go" button — its Tab-to-Go /
idle-Go submit assertions are dropped and replaced by Enter-submit; the
draft/committedUrl sync, blur-cancel, and redirect-event assertions are preserved.

### 6.5 Decoupling assertions

- `registry.test.ts` is **unchanged** — key-set still pins `claude/codex/gemini/shell`;
  `web` is never an `AgentId`.
- `BROWSER_IDENTITY` is typed `PaneIdentity`, lives in the browser feature, and is not
  exported from `AGENTS` (asserted).

### 6.6 Acceptance criteria (L1 done = all of)

1. Two-row Arc chrome visually matches `Browser Pane.html` static chrome (manual
   browser check): WEB chip, capsule tabs, address pill, focus border+glow, icons.
2. Existing tab + address behavior unchanged (regression suite green).
3. Disabled nav, placeholder favicons, and the absent load bar are
   forward-compatible — L2/L3 wire behavior with no chrome re-layout.
4. `⌘L` enters address-edit from both page-focused (forwarded) and chrome-focused
   paths, and never fires for the editor/dialogs.
5. `npm run lint`, `npm run type-check`, `npm run test` all pass.

### 6.7 Explicitly NOT verified in L1

Real back/forward/reload + history-driven enablement (L2); real favicons + the live
load bar (L3). L1 asserts only that their placeholders/disabled states render and are
forward-compatible.
