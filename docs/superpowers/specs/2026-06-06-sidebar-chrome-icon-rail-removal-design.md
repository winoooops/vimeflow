# Sidebar Chrome: Remove Icon Rail + Top-Bar Utilities — Design

> **Status:** design converged via a live UI spike on `feat/vim-66-remove-icon-rail` (validated in the running app and approved), then captured + refined here under codex review. Part of **VIM-66**; closes **VIM-76**.
> **Design inputs:** `docs/design/leftsidebar/SIDEBAR-CHROME-MIGRATION.md` and `docs/design/leftsidebar/Sidebar Chrome.html` (authoritative for layout + intent), reconciled to the real TS architecture, the design system (`docs/design/UNIFIED.md`), and VIM-75's shipped drawer animation (`docs/superpowers/specs/2026-06-04-sidebar-collapsible-design.md`).

## 1. Problem & scope

The collapsible sidebar (VIM-75) shipped with the 48px **IconRail** still in place. The rail held only two utilities — Command Palette and Settings — plus the collapsed-state expand toggle. With the rail present, the collapse toggle has **two different homes at two different viewport positions** (an inset 28px control in the status card when open; a 28px control near the rail top when collapsed), so the toggle visibly **jumps** on collapse.

VIM-76 removes the rail entirely, consolidates its utilities into a new **sidebar top bar**, and makes the toggle **position-stable** across collapse _and_ expand.

**Scope:** the sidebar chrome only — the top bar plus the single collapse toggle. No change to the editor, the dock, the right activity panel, or VIM-75's collapse machinery (the persisted flag, the `⌘B` / `Ctrl+⇧B` shortcut, the `:toggle-sidebar` command, the drawer animation).

### Locked decisions (validated in the spike)

- **Remove the 48px IconRail entirely.** Grid columns go `48px auto 1fr auto` → `auto 1fr auto`; `<main>` reclaims the 48px. Removing it (vs. hiding) means no dead gutter and no stale seam — the design system uses tonal depth, not borders.
- **New `SidebarTopBar` (38px).** Reuses the session-tab strip's own design tokens — `bg-surface-container-lowest` fill + a `border-b border-outline-variant/25` bottom hairline (not the static mock's literal `#0d0d1c` / `0.2` hex; verified: the token resolves to `rgb(13,13,28)` = `#0d0d1c`, so the approved look is preserved) — so the two bars form one continuous, token-driven band. Command Palette + Settings sit on the **right** via a `flex: 1` spacer (not margins, so the row survives reflow); the bar's **left slot** (`paddingLeft: 12`) is left empty for the always-mounted root toggle to float over, so the toggle reads as the bar's first item without being a child of it.
- **One `SidebarToggle`, always mounted at the root, ONE viewport box.** A single `SidebarToggle` is rendered as an absolutely-positioned child of the **workspace grid root** at **`{x:12, y:5, w:28, h:28}`** in _every_ state (verified in-browser via `getBoundingClientRect`); only its `collapsed` prop drives the panel-left rail fill (filled = open, hollow = collapsed). It is **never** unmounted or re-parented, so it holds `(12, 5)` through both the collapse and expand drawer animations while the sidebar slides beneath it.
  - **Deviation from the migration doc (intentional, documented):** the doc specifies "one component, two mounts" (a top-bar child when open + an overlay when collapsed) and verified it on a prototype that _unmounts_ the sidebar with no animation. Combined with VIM-75's drawer slide that two-mount structure cannot stay stable during the **expand** transition — the top-bar-child toggle would clip in from width 0 before it reaches `(12, 5)`. A single always-mounted root overlay achieves the doc's actual headline goal ("the collapse toggle must stay at the exact same viewport position and size whether the sidebar is open or collapsed") with no transition-timing or focus-handoff machinery, and is **visually identical** (it floats in the top bar's left slot when open and over `<main>` when collapsed). This is the **headline requirement**.
- **Real shortcut, not the mock's placeholder.** The Command Palette utility shows the **real** palette chord via `formatShortcut(COMMAND_PALETTE_SHORTCUT_KEYS)` (`Ctrl+;` / `⌘;`), not the static mock's `⌘K`.
- **Settings stays a stub.** Settings is an icon-only utility rendered **`aria-disabled`** with its click suppressed (a no-op) until the Settings dialog (issue #252) lands — the same deferral VIM-75 carried on the rail; the tooltip names the follow-up issue. Passing a real `onSettings` handler (post-#252) enables it automatically.
- **Tab-bar clearance.** When collapsed, the session-tab strip's left padding becomes a literal `pl-[48px]` (= `12 + 28` toggle `+ 8` gap), **not** `pl-12` — at this project's 14px root font `pl-12` (3rem) is only 42px and would leave a 2px gap. The arbitrary value pins 48px regardless of root size so the floating toggle never overlaps the first tab.

### Non-goals

- No change to the collapse flag, its `localStorage` persistence, the `⌘B` / `Ctrl+⇧B` shortcut, the `:toggle-sidebar` command, or VIM-75's drawer-slide animation.
- The Settings dialog itself (issue #252) is out of scope; the button stays a stub.
- Sessions/Files tab UI migration + the new-session button is **VIM-77**, tracked separately.

## 2. Component & file changes

### 2.1 Delete `IconRail` (`features/workspace/components/IconRail.tsx`)

Remove `IconRail`, `RailBtn`, and `RailIcon`. Remove the `<IconRail />` element and its import from `WorkspaceView`. With the rail gone its only consumers vanish, so also remove the now-dead `data/mockNavigation.ts` (and its test) and drop the `mockNavigationItems` / `mockSettingsItem` imports — these were the rail's deprecated-for-one-cycle exports and have no remaining caller once the rail is deleted.

### 2.2 New `SidebarTopBar` + `TopBarUtil` (`features/workspace/components/SidebarTopBar.tsx`)

- **`SidebarTopBar`** — the 38px chrome row (styling above). It renders **only the right-side utilities**; the collapse toggle is the always-mounted root overlay owned by `WorkspaceView`, not a child of this bar. Props: `onCommand` (**required** — the Command Palette button must always be wired; an optional handler would allow an enabled no-op), `onSettings?` (optional — absence renders the disabled Settings stub), `commandShortcutHint` (**required** — no `⌘K` placeholder default), `settingsIssueNumber?`. Layout: `paddingLeft: 12` reserving the left slot the floating toggle overlays, a `flex: 1` spacer, then the two utilities.
- **`TopBarUtil`** — a compact recessed button sharing the toggle's inset-well treatment (fill `rgba(26,26,42,0.6)`, border `rgba(74,68,79,0.3)`, lavender hover). A `disabled?` prop renders `aria-disabled` and suppresses `onClick` (used by the Settings stub). Command Palette is **labeled** (Material Symbol `terminal` + inline mono keycap hint); Settings is **icon-only** (28×28, Material Symbol `settings`). Both expose `aria-label` + `title`.

### 2.3 `Sidebar` gains a full-bleed `topBar` slot (`components/sidebar/Sidebar.tsx`)

Add an optional `topBar?: ReactNode`, rendered **edge-to-edge (no padding)** as the first child of the sidebar column, above the padded `header` slot. Reuse the existing `renderSlot` guard so a `true`/`false`/nullish value renders nothing.

### 2.4 `AgentStatusCard` loses the toggle (`features/workspace/components/AgentStatusCard.tsx`)

Remove the in-card `SidebarToggle`, its `onToggleSidebar` / `sidebarShortcutHint` props, and the `SidebarToggle` import. The card header becomes the title alone.

## 3. Layout, the single root toggle & focus (`WorkspaceView`)

- **Grid:** `gridTemplateColumns` `48px auto 1fr auto` → `auto 1fr auto`. The VIM-75 two-layer drawer (animated shell `width`, `inert` when collapsed, inner panel pinned to full width so content slides instead of squishing, resize handle hidden when collapsed) is unchanged.
- **The toggle (single root overlay):** `WorkspaceView` renders one `<SidebarToggle collapsed={sidebarCollapsed} variant="inset" size={28} data-testid="sidebar-toggle">` as an absolutely-positioned child of the **workspace grid root** (made `relative`) at `{ position: 'absolute', top: 5, left: 12, zIndex: 30 }` — in **every** state, never conditionally. The root spans the viewport and never moves, so the toggle holds `(12, 5)` size 28 throughout both drawer animations. When open it floats over the top bar's reserved left slot (sidebar at `x = 0`, `paddingLeft 12`); when collapsed it floats over `<main>`'s tab strip (cleared by `pl-[48px]`). `SidebarTopBar` (in the `topBar` slot) hosts only the utilities.
- **Focus continuity:** because the toggle is always mounted at the root (outside the sidebar), toggling via it never moves focus into an inert subtree. A single post-collapse focus guard covers the other entry points: after a genuine **open → collapsed transition** (gated on the previous flag value, so it never fires on initial mount or persisted-collapsed hydration — reload keeps the app's normal terminal/workspace focus), if `document.activeElement` is `null`, `<body>`, or within the now-`inert` sidebar, focus moves to the root toggle. This catches the in-sidebar shortcut (`⌘B` / `Ctrl+⇧B`) case (the focused element goes `inert`) AND the `:toggle-sidebar` command case (the command palette closes and drops focus to `<body>`), while leaving terminal/editor focus untouched (their `activeElement` stays valid → no-op); toggle clicks are already fine (the toggle itself stays focused). The guard is deferred a microtask so it runs after the palette's own close/focus-restore settles. One general retarget superseding VIM-75's per-handler rail-focus flag.
- **Session-tab clearance:** `<Tabs>` gains a `sidebarCollapsed?` prop; the strip's left padding is `pl-[48px]` when collapsed, else the unchanged `pl-2`.

## 4. Keyboard, command palette & settings

- The `⌘B` / `Ctrl+⇧B` shortcut and the `:toggle-sidebar` palette command (both from VIM-75) are untouched — they call the same workspace-global `toggleSidebar`, so the toggle and both keyboard paths stay in lockstep on the persisted flag.
- **Command Palette utility:** wired to `commandPalette.open` (the exact handler the rail used). Its keycap hint is `formatShortcut(COMMAND_PALETTE_SHORTCUT_KEYS)` so the displayed chord always tracks the real binding (`Ctrl+;` / `⌘;`).
- **Settings utility:** no handler wired today → `aria-disabled`, click suppressed, tooltip naming issue #252. Same as the VIM-75 rail stub; only its location changes (top bar, not rail).

## 5. Edge cases, a11y & testing

- **A11y:** the collapsed sidebar stays `aria-hidden` + `inert` (VIM-75); the always-mounted root toggle is the single focusable collapse control in both states. `SidebarToggle` keeps its `aria-expanded` + label/title swap. `TopBarUtil` buttons carry `aria-label` + `title`; the Settings stub is `aria-disabled`.
- **Focus continuity:** see §3 — the post-collapse focus guard fires only on a real open → collapsed transition (gated on the previous flag value, never on initial mount/hydration) and retargets to the root toggle whenever, after collapse, `document.activeElement` is `null` / `<body>` / inside the inert sidebar; this covers the in-sidebar shortcut and the `:toggle-sidebar` palette path (which closes to `<body>`), and is deferred a microtask so it wins the race with the palette's focus restore.
- **Drawer transition windows (accepted):** clearance that is driven off the boolean `sidebarCollapsed` (the tab strip's `pl-[48px]`) flips instantly while the drawer width animates over ~220ms. On **expand** this leaves a brief (~1–2 frame) window where the first session tab is at `pl-2` while the sidebar is still narrow, so it can pass under the fixed toggle until the sidebar widens past it. This is a negligible cosmetic transient; a full drawer-transition state machine to hold clearance through the animation is deferred as not worth the complexity. The toggle itself never moves — it is root-anchored.
- **Reduced motion:** the sidebar shell's width transition (VIM-75) is gated with `motion-reduce:transition-none` so `prefers-reduced-motion` users get an instant collapse/expand with no slide; the toggle has no transition and is unaffected.
- **Carried-over deferrals (NOT reopened here):** VIM-75's known LOWs — `RateLimitBar` `aria-valuenow` clamp and the toggle's missing `aria-controls` — remain tracked follow-ups; this PR does not touch them.
- **Implementation status:** the live spike currently retains VIM-75's dual-mount toggle (a top-bar child + a root overlay) — it is visually correct and end-state-stable, which is what was approved. Aligning it to the single-root-toggle design above (plus the general focus retarget and the `motion-reduce` gate) is **finalization work**, done with the tests below.
- **Testing (finalization, TDD, ≥80% — NOT yet written):**
  - `SidebarTopBar.test.tsx` — renders the two utilities (no toggle); Command Palette fires `onCommand` and shows the hint; Settings is present, labeled, and `aria-disabled` with a suppressed click.
  - `Sidebar.test.tsx` — the `topBar` slot renders full-bleed above the header and is absent when not passed.
  - `AgentStatusCard.test.tsx` — UPDATE: drop the toggle-click assertion; assert the header is title-only.
  - `Tabs.test.tsx` — `pl-[48px]` when `sidebarCollapsed`, `pl-2` otherwise.
  - `WorkspaceView.*.test.tsx` — UPDATE: no icon rail; top bar present; the single root toggle present in both states with `collapsed` tracking the flag; collapse from a shortcut while focus is in the sidebar retargets focus to the toggle; command-palette open path runs through the top bar.
  - DELETE `IconRail.test.tsx` and `mockNavigation.test.ts` alongside their sources.
- **Spike verification already done (in-browser):** icon rail gone; layout `[sidebar | main | activity]`; top bar present with token-matched fill (`rgb(13,13,28)`) + `/25` hairline; Command Palette + Settings render as real glyphs (not ligature text); Settings `aria-disabled`; the (root-anchored) toggle measures `{x:12, y:5, w:28, h:28}` open and collapsed.

## 6. Acceptance criteria

1. No icon rail anywhere; layout is `[sidebar | main | activity]`; `<main>` reclaims the freed 48px.
2. The sidebar top bar (38px, matching the session-tab bar's tokens) carries Command Palette (real chord) + Settings on the right; the collapse toggle floats over its left slot; no separate footer or utility strip.
3. Collapse ↔ expand: the single always-mounted root toggle stays at `{x:12, y:5, w:28, h:28}` during and after **both** transitions; only the rail-fill glyph swaps.
4. `⌘B` / `Ctrl+⇧B` / `:toggle-sidebar` / the toggle all flip the same persisted flag and stay in sync; reload restores state; any collapse path that would otherwise drop focus (focus inside the sidebar, or the `:toggle-sidebar` palette closing to `<body>`) lands focus on the toggle.
5. Collapsed: the floating toggle never overlaps the first session tab (tab strip padded to 48px).
6. Command Palette opens via the top-bar button and its shortcut; Settings is an `aria-disabled` no-op stub pending #252.
7. `npm run lint` / `type-check` / `test` green; coverage ≥ 80% (finalization).
