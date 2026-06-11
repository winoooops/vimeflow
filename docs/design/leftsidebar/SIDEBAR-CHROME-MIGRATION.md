# Vimeflow — Sidebar Chrome Migration

> **Paste-to-agent prompt:**
>
> Rework the left **sidebar chrome** (only the sidebar area — don't touch the editor / activity panel). Three changes: **(1) remove the 48px icon rail entirely**; **(2)** give the sidebar a **top bar** (38px, dark, matching the session-tab bar) with the **collapse toggle pinned to the left** and **Command Palette + Settings as compact buttons on the right of that same row**; **(3)** the collapse toggle must stay at the **exact same viewport position and size** whether the sidebar is open or collapsed — it does NOT move or resize. `Sidebar Chrome.html` is a runnable reference that proves the stable-toggle behavior. Follow the per-change reasoning in §3.

---

## Scope

Sidebar area only. Files: `src/shell.jsx` (sidebar + toggle live here) and `src/app.jsx` (layout + handlers). Plus `src/views.jsx` for one small `SessionTabs` padding tweak. No new deps.

## The three changes

### 1 · Remove the icon rail completely

Delete the `IconRail` and `RailBtn` components from `src/shell.jsx`, the `<IconRail … />` element from `src/app.jsx`, and drop `IconRail` from the `Object.assign(window, …)` export.

> **Why:** the rail held only two utilities (command palette, settings) plus the collapsed-state toggle — all of which now live in the sidebar top bar. With it gone the shell is a clean two-column layout `[sidebar | main]`, and `main` reclaims the 48px the rail used to occupy. Removing it (vs. hiding) means no dead gutter and no stale border.

### 2 · Sidebar top bar — toggle left, utilities right (same row)

Add a `SidebarTopBar` as the **first child of the `<aside>`**, above the agent status card:

```jsx
<div
  style={{
    height: 38,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
    background: '#0d0d1c',
    borderBottom: '1px solid rgba(74,68,79,0.2)',
  }}
>
  <SidebarToggle
    collapsed={false}
    onClick={onToggleSidebar}
    size={28}
    variant="inset"
  />
  <div style={{ flex: 1 }} /> {/* spacer pushes utils right */}
  <TopBarUtil
    icon="terminal"
    label="Command Palette"
    kbd="⌘K"
    onClick={onCommand}
  />
  <TopBarUtil icon="settings" label="Settings  ⌘," onClick={onSettings} />
</div>
```

- `TopBarUtil` is a compact button (full source in the HTML): Command Palette shows its `⌘K` inline; Settings is icon-only (28×28). Both use the same recessed style as the toggle so the row reads as one control cluster.
- Thread `onCommand` / `onSettings` into `Sidebar` and wire them in `app.jsx` to `setPaletteOpen(true)` / `setSettingsOpen(true)` (the handlers the icon rail used).
- **Delete** the old bottom `SidebarFooter` (the full-width command-palette + settings strip) — these utilities now live in the top bar, and removing the footer gives the session list back its vertical space.

> **Why the top bar, right side:** the toggle anchors the top-left (see §3); the two global utilities are secondary, so they go to the opposite end of the same 38px row — one tidy chrome strip instead of a separate footer. The `flex:1` spacer is what right-aligns them; keep it (don't use margins) so the row survives reflow.
> **Why 38px + `#0d0d1c`:** these match the session-tab bar in the main region exactly, so the sidebar's top edge and the main region's top edge form one continuous band — and, critically, it puts the toggle at the same vertical position as the collapsed-state toggle (next).

### 3 · The toggle never moves or resizes

This is the headline requirement. Use **one** `SidebarToggle` component (size 28, `variant="inset"`) rendered in two places at the **same viewport box `{x:12, y:5, w:28, h:28}`**:

- **Open:** inside `SidebarTopBar` — `paddingLeft:12` + vertical-center in the 38px bar ⇒ the toggle box lands at viewport (12, 5).
- **Collapsed:** the sidebar is unmounted, so render the toggle as an absolutely-positioned overlay at the **top of `<main>`** (which is `position: relative`):

```jsx
{
  collapsed && (
    <div style={{ position: 'absolute', top: 5, left: 12, zIndex: 30 }}>
      <SidebarToggle
        collapsed={true}
        onClick={expand}
        size={28}
        variant="inset"
      />
    </div>
  )
}
```

Because both the `<aside>` and `<main>` start at the same top-left origin, (top:5, left:12, 28px) resolves to the identical viewport coordinate in both states. **Verified: `{x:12, y:5, w:28, h:28}` in both — no jump.**

Also bump `SessionTabs` left padding so the floating toggle doesn't overlap the first tab:

```js
paddingLeft: sidebarCollapsed ? 48 : 8,   // 12 + 28 toggle + ~8 gap
```

(Pass `sidebarCollapsed` into `SessionTabs` to drive this.)

> **Why one component, two mounts (not two buttons):** previously the open state used an inset 28px toggle inside the status card while the collapsed state used a 32px ghost button at (9,9) — so it jumped position, size, AND style. Sharing the single `SidebarToggle` at matched coordinates guarantees pixel-stable behavior and keeps the icon/glyph identical. Only the `collapsed` prop differs (it controls the left-rail fill: filled = open, hollow = collapsed).
> **Note:** the toggle was removed from the agent status card header as part of this — its only homes are now the top bar (open) and the main overlay (collapsed).

## Static assets

Fonts: Instrument Sans, JetBrains Mono, Inter. Icons (Material Symbols Outlined): `terminal` (command palette) + `settings`. The toggle is inline SVG (no icon font needed). Same two `<link>`s already in the app.

```html
<link
  href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
<link
  href="https://fonts.googleapis.com/icon?family=Material+Symbols+Outlined"
  rel="stylesheet"
/>
```

## Acceptance criteria

1. No icon rail anywhere; layout is `[sidebar | main]`; `main` fills the freed width.
2. Sidebar top bar (38px) holds the toggle on the left and Command Palette (`⌘K`) + Settings on the right of the **same row**; no bottom footer.
3. Collapse, then expand → the toggle stays at `{x:12, y:5, w:28, h:28}` the whole time (measure with `getBoundingClientRect`). Glyph swaps rail-fill only.
4. `⌘K` opens the palette, `⌘,` opens settings, `⌘B` toggles collapse — all still work.
5. Collapsed: floating toggle does not overlap the first session tab (tab bar padded to 48).

## Anti-patterns

- ❌ Two different toggle buttons for open vs collapsed (must be one component, matched box).
- ❌ Leaving the icon rail in place / hiding it with `display:none` instead of deleting it.
- ❌ Keeping the bottom `SidebarFooter` after moving utilities up.
- ❌ Right-aligning the utilities with margins instead of a `flex:1` spacer.
- ❌ A top bar height/fill that doesn't match the session-tab bar (breaks the shared top band and the toggle's vertical alignment).
