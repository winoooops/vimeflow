# Sidebar Chrome: Remove Icon Rail + Top-Bar Utilities — Design

> **Status:** design converged via a live UI spike on `feat/vim-66-remove-icon-rail` (validated in the running app and approved). Part of **VIM-66**; closes **VIM-76**.
> **Design inputs:** `docs/design/leftsidebar/SIDEBAR-CHROME-MIGRATION.md` and `docs/design/leftsidebar/Sidebar Chrome.html` (authoritative for layout + intent), reconciled to the real TS architecture and the design system (`docs/design/UNIFIED.md`). Builds on VIM-75 (`docs/superpowers/specs/2026-06-04-sidebar-collapsible-design.md`).

## 1. Problem & scope

The collapsible sidebar (VIM-75) shipped with the 48px **IconRail** still in place. The rail held only two utilities — Command Palette and Settings — plus the collapsed-state expand toggle. With the rail present, the collapse toggle has **two homes at two different viewport positions** (an inset 28px control in the status card when open; a 28px control near the rail top when collapsed), so it visibly **jumps** on collapse.

VIM-76 removes the rail entirely, consolidates its utilities into a new **sidebar top bar**, and makes the toggle **position-stable** across collapse and expand.

**Scope:** the sidebar chrome only — the top bar plus the single collapse toggle (its open home + its collapsed home). No change to the editor, the dock, the right activity panel, or VIM-75's collapse state/persistence/shortcut/command.

### Locked decisions (validated in the spike)

- **Remove the 48px IconRail entirely.** Grid columns go `48px auto 1fr auto` → `auto 1fr auto`; `<main>` reclaims the 48px. Removing it (vs. hiding) means no dead gutter and no stale seam.
- **New `SidebarTopBar` (38px).** Reuses the session-tab strip's own tokens — `bg-surface-container-lowest` fill + a `border-b border-outline-variant/25` bottom hairline (not the mock's literal `#0d0d1c` / `0.2` hex; verified: the token resolves to `rgb(13,13,28)` = `#0d0d1c`) — so the two bars form one continuous, token-driven band. The collapse toggle sits at the bar's **left** (`paddingLeft: 12`); Command Palette + Settings sit on the **right** via a `flex: 1` spacer (not margins, so the row survives reflow).
- **Collapse model: instant hide, NOT a drawer slide.** Collapsing snaps the sidebar shell width to `0` **instantly** (no width transition) and marks the shell `inert` + `aria-hidden`; the inner panel stays **mounted** (clipped to 0 width), so durable non-chrome sidebar state — file-explorer expansion/scroll and an in-progress session rename draft — survives a collapse/expand, consistent with the chrome-only scope. ("Preserved" means durable state, not open popovers — a transient overlay such as a file-tree context menu or a tooltip dismisses on collapse, as usual.) The outer shell remains a 0-width `auto`-track placeholder so `<main>` reclaims with no gutter. This intentionally supersedes VIM-75's animated drawer _slide_ (the only VIM-75 change is slide → instant); see the toggle decision below for why the slide had to go.
- **One `SidebarToggle`, two IN-FLOW homes, ONE viewport box.** The toggle is a real in-flow child of whichever 38px bar is showing — the **sidebar top bar's left slot** when open, the **session-tab bar's leading slot** when collapsed. Both bars are 38px with the toggle at `paddingLeft 12`, vertically centred, so the toggle resolves to **`{x:12, y:5, w:28, h:28}`** in both states (verified in-browser). Only the `collapsed` prop differs (panel-left rail fill: filled = open, hollow = collapsed). This is the **headline requirement**.
  - **Why in-flow + instant unmount (not a floating overlay over a sliding drawer):** keeping VIM-75's slide forces the stable toggle to be decoupled from layout (a root/viewport-anchored float). That float is fragile (it only "lines up" with the bar by coincidence) and, because `<main>` slides during the animation while the toggle is pinned, it produces a brief window on **expand** where the first session tab passes _under_ the toggle. Making the toggle an in-flow child of each bar means (a) it can never be misaligned by a sidebar **resize** (its bar's left edge is the sidebar's left edge, fixed at viewport `x = 0` — verified stable at widths 240/272/420), and (b) tabs flow _after_ it, so a tab can never sit under it (verified: first tab at `x ≈ 49`). The instant hide (no animation) removes the transition window entirely.
- **Tooltips use the project `Tooltip`, not native `title`.** The toggle and both utilities surface their label (and, where relevant, a Zed-style shortcut chip) through `components/Tooltip` (`placement="bottom"`), matching the rest of the app chrome. Verified: hovering the toggle shows "Show sidebar" + a `Ctrl+⇧B` chip; no element carries a native `title`.
- **Real shortcut, not the mock's placeholder.** The Command Palette utility shows the real palette chord via `formatShortcut(COMMAND_PALETTE_SHORTCUT_KEYS)` (`Ctrl+;` / `⌘;`), not the mock's `⌘K`.
- **Settings stays a stub.** Settings is an icon-only utility rendered **`aria-disabled`** with its click suppressed until the Settings dialog (issue #252) lands; the tooltip names the follow-up. A real `onSettings` handler (post-#252) enables it automatically.
- **Tab-bar clearance.** The collapsed toggle is the tab bar's in-flow `leading` child: the bar uses `pl-[12px]` so the toggle seats at `x = 12`, and the toggle has `mr-2` so the first tab clears it at `x = 48`. (No `pl-[48px]` floating-clearance hack — the in-flow toggle naturally pushes the tabs over.)

### Non-goals

- No change to the collapse flag, its `localStorage` persistence, the `⌘B` / `Ctrl+⇧B` shortcut, or the `:toggle-sidebar` command.
- VIM-75's animated drawer slide is intentionally **replaced** by an instant hide (above) — that is in scope, but no other VIM-75 behaviour changes (the sidebar's content state is preserved across collapse).
- The Settings dialog itself (issue #252) is out of scope; the button stays a stub.
- Sessions/Files tab UI migration + the new-session button is **VIM-77**, tracked separately.

## 2. Component & file changes

### 2.1 Delete `IconRail` (`features/workspace/components/IconRail.tsx`)

Remove `IconRail`, `RailBtn`, `RailIcon`, the `<IconRail />` element + import from `WorkspaceView`, and the now-dead `data/mockNavigation.ts` (+ test) and its `mockNavigationItems` / `mockSettingsItem` imports (no remaining caller once the rail is gone).

### 2.2 New `SidebarTopBar` + `TopBarUtil` (`features/workspace/components/SidebarTopBar.tsx`)

- **`SidebarTopBar`** — the 38px chrome row (styling above). Renders the in-flow `SidebarToggle` (left, `data-testid="sidebar-toggle-topbar"`), a `flex: 1` spacer, then the two utilities. Props: `onToggleSidebar` (required), `onCommand` (**required** — the palette button must always be wired), `onSettings?` (absent → disabled Settings stub), `commandShortcutHint` (**required** — no `⌘K` default), `sidebarShortcutHint?`, `settingsIssueNumber?`.
- **`TopBarUtil`** — a compact recessed button (fill `rgba(26,26,42,0.6)`, border `rgba(74,68,79,0.3)`, lavender hover) wrapped in the project `Tooltip` (`placement="bottom"`, no native `title`). A `disabled?` prop renders `aria-disabled` + suppresses `onClick` (Settings stub). Command Palette is labeled (Material Symbol `terminal` + inline mono keycap hint); Settings is icon-only (28×28, `settings`). Both carry `aria-label`.

### 2.3 `Sidebar` gains a full-bleed `topBar` slot (`components/sidebar/Sidebar.tsx`)

Add an optional `topBar?: ReactNode`, rendered edge-to-edge (no padding) as the first child of the sidebar column, above the padded `header`. Reuse the `renderSlot` guard.

### 2.4 `AgentStatusCard` loses the toggle (`features/workspace/components/AgentStatusCard.tsx`)

Remove the in-card `SidebarToggle` + its `onToggleSidebar` / `sidebarShortcutHint` props + import. The header becomes title-only.

### 2.5 `Tabs` gains a `leading` slot (`features/sessions/components/Tabs.tsx`)

Add an optional `leading?: ReactNode` rendered as the bar's first child, seated left (`self-center`, `mr-2`) with the bar at `pl-[12px]` when present (else the unchanged `px-2`). This hosts the collapsed-state toggle in-flow; the tablist flows after it. Keeps `Tabs` generic — `WorkspaceView` owns the toggle.

### 2.6 `SidebarToggle` uses the project `Tooltip` (`features/workspace/components/SidebarToggle.tsx`)

Wrap the button in `components/Tooltip` (`content` = "Show/Hide sidebar", `shortcut` = `shortcutHint`, `placement="bottom"`) and drop the native `title`. `aria-label` / `aria-expanded` stay. (`SidebarToggle` is now used only in the two in-flow homes.)

## 3. Layout, the toggle & focus (`WorkspaceView`)

- **Grid:** `gridTemplateColumns` `48px auto 1fr auto` → `auto 1fr auto`. The sidebar shell sets `width: collapsed ? 0 : var(--workspace-sidebar-width)` with **no transition** and toggles `inert` + `aria-hidden` when collapsed; the inner panel (`Sidebar` + resize handle) stays **mounted** (clipped to 0 width) so its state survives, and the resize handle is hidden while collapsed.
- **Toggle homes:** open → passed into `SidebarTopBar` (in the `Sidebar` `topBar` slot); collapsed → passed as the `<Tabs leading>` toggle (`data-testid="sidebar-toggle-tabs"`). Both resolve to `(12, 5)` size 28; exactly one is **focusable/visible** at a time — when collapsed the top-bar toggle is still mounted (the inner panel is kept mounted for state preservation) but `inert` + clipped inside the 0-width shell, so only the tab-bar toggle is reachable. Both call the same `toggleSidebar`.
- **Focus continuity:** toggling removes the active toggle from the tab order (on collapse the top-bar toggle's shell goes `inert`; on expand the `leading` slot unmounts), so a post-toggle focus guard restores focus to the now-visible toggle when focus was dropped to `<body>`. The same guard covers the `⌘B` / `Ctrl+⇧B` / `:toggle-sidebar` paths (collapsing while focus is inside the now-`inert` sidebar → `<body>` → toggle). It fires only on a real toggle transition (not initial mount) and is deferred a frame so it runs after the inert flip / palette close settles. (Implementation is a finalization task — see §5.)
- **No floating overlay, no root `position: relative`, no per-handler focus flag** — all removed with the slide.

## 4. Keyboard, command palette & settings

- The `⌘B` / `Ctrl+⇧B` shortcut and `:toggle-sidebar` command (VIM-75) are untouched — same `toggleSidebar`. Both toggle homes call it too, so all paths stay in lockstep on the persisted flag.
- **Command Palette utility:** `commandPalette.open`; hint `formatShortcut(COMMAND_PALETTE_SHORTCUT_KEYS)`.
- **Settings utility:** no handler today → `aria-disabled`, suppressed click, tooltip naming #252.

## 5. Edge cases, a11y & testing

- **A11y:** the collapsed sidebar shell is `inert` + `aria-hidden` (kept mounted for state preservation, but removed from the tab order and AT); the in-flow tab-bar toggle is the focusable collapse control. `SidebarToggle` keeps `aria-expanded` + label swap; tooltips are the project `Tooltip`; the Settings stub is `aria-disabled`.
- **Focus continuity:** the post-toggle focus guard (see §3) restores focus to the visible toggle when an unmount drops it to `<body>`, covering toggle clicks and the shortcut/palette paths.
- **No motion concern:** there is no collapse animation, so there is nothing to gate for `prefers-reduced-motion` (the VIM-75 width transition is removed).
- **Carried-over deferrals (NOT reopened):** VIM-75's `RateLimitBar` `aria-valuenow` clamp and the toggle's missing `aria-controls` remain tracked follow-ups.
- **Implementation status:** the spike implements the layout, the instant (no-slide) collapse, both in-flow toggle homes, the `leading` slot, and the project tooltips — all verified in-browser. The spike currently _unmounts_ the inner panel on collapse; finalization switches it to the **kept-mounted + `inert`** model above (state preservation). Remaining finalization work also includes the post-toggle focus guard; deleting `IconRail.tsx` (+ test) and `mockNavigation.ts` (+ test); and the tests below.
- **Testing (finalization, TDD, ≥80% — NOT yet written).** The `{12,5,28,28}` pixel invariant is verified in a browser-capable path (the spike's `getBoundingClientRect` checks, promotable to an e2e test); Vitest/jsdom covers structure, slots, classes, wiring, and focus (it cannot compute layout boxes):
  - `SidebarTopBar.test.tsx` — renders the toggle + two utilities; Command Palette fires `onCommand` + shows the hint; Settings is `aria-disabled` with a suppressed click; no native `title` (project tooltip).
  - `SidebarToggle.test.tsx` — UPDATE: wrapped in the project `Tooltip` (no native `title`); glyph fill tracks `collapsed`; `aria-expanded` / label swap.
  - `Sidebar.test.tsx` — `topBar` slot renders full-bleed above the header; absent when not passed.
  - `Tabs.test.tsx` — `leading` renders seated left with `pl-[12px]` (tabs flow after it); absent → `px-2`.
  - `AgentStatusCard.test.tsx` — UPDATE: title-only header, no toggle.
  - `WorkspaceView.*.test.tsx` — UPDATE (structural, not pixel): no icon rail; the toggle is the top bar's child when open and the tab bar's `leading` child when collapsed; the sidebar shell is `inert` when collapsed (inner kept mounted); collapse from a shortcut while focus is in the sidebar restores focus to the toggle; palette open path via the top bar.
  - DELETE `IconRail.test.tsx` and `mockNavigation.test.ts` with their sources.
- **Spike verification (in-browser):** rail gone; layout `[sidebar | main | activity]`; top bar token-matched (`rgb(13,13,28)` + `/25` hairline); toggle `{12,5,28,28}` open (top bar) and collapsed (tab bar, in-flow, first tab at `x≈49`); stable across resize (240/272/420); Settings `aria-disabled`; project tooltip shows "Show sidebar" + `Ctrl+⇧B`.

## 6. Acceptance criteria

1. No icon rail anywhere; layout is `[sidebar | main | activity]`; `<main>` reclaims the freed 48px.
2. The sidebar top bar (38px, tab-strip tokens) carries the collapse toggle on the left and Command Palette (real chord) + Settings on the right of the same row; no separate footer/strip.
3. The toggle is at `{x:12, y:5, w:28, h:28}` when open (top bar) and when collapsed (tab-bar leading slot); collapse/expand is instant (no slide) so the position never animates or jumps; only the rail-fill glyph differs.
4. Resizing the sidebar never moves the toggle; the collapsed toggle never overlaps the first session tab (tabs flow after it).
5. `⌘B` / `Ctrl+⇧B` / `:toggle-sidebar` / the toggle all flip the same persisted flag and stay in sync; reload restores state; collapsing while focus is in the sidebar moves focus to the toggle.
6. The toggle and both utilities use the project `Tooltip` (no native `title`); Command Palette opens via its button + shortcut; Settings is an `aria-disabled` stub pending #252.
7. `npm run lint` / `type-check` / `test` green; coverage ≥ 80% (finalization).
