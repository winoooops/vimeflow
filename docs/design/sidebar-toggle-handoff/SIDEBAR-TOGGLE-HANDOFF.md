# Vimeflow — Collapsible Sidebar Handoff

> **Paste-to-agent prompt (copy this whole block to your coding agent):**
>
> Implement a collapsible left sidebar for Vimeflow. The sidebar (sessions / files / context) must hide and show on demand. Add a single toggle control that **lives inside the sidebar header when the sidebar is open**, and **relocates into the 48px icon rail when the sidebar is collapsed** so it stays reachable. The toggle must use a Codex/VS-Code-style "panel-left" glyph (a rounded rect with a left rail) — never a meaningless plain square. Wire it to a persisted `sidebarCollapsed` flag and a `⌘B` / `Ctrl+B` shortcut. Also delete the placeholder "W" avatar at the top of the icon rail. Follow the per-change reasoning in §3 exactly — each change has a stated reason; do not skip or "simplify" any of them, and do not introduce new tokens or dependencies.

---

## 0. Task

Make the left `Sidebar` collapsible, controlled by one toggle button that **moves between two homes** depending on state:

- **Sidebar open** → toggle sits in the sidebar's project header (top-right).
- **Sidebar collapsed** → toggle appears at the top of the icon rail.

State is a single boolean `sidebarCollapsed`, persisted through the existing tweak store, and also bound to `⌘B` / `Ctrl+B`.

**Files touched:** `src/app.jsx`, `src/shell.jsx`. No new files, no new deps.

---

## 1. Source-of-truth order

1. **This file** — authoritative for this feature.
2. **`src/shell.jsx`** — `IconRail` + `Sidebar` live here; the toggle component goes here.
3. **`src/app.jsx`** — owns `tweaks` state; adds the default, the conditional render, and the shortcut.

---

## 2. The toggle icon — required symbolism

The glyph is a **panel-left** mark, identical in both states except for one fill:

```
viewBox 0 0 16 16, stroke = currentColor, strokeWidth 1.3
- rect  x1.6 y2.6 w12.8 h10.8 rx2.4   (the panel outline — ALWAYS)
- path  M5.9 2.9 V13.1                 (the left-rail divider — ALWAYS)
- rect  x2.2 y3.2 w3.1 h9.6 rx1.4 fill currentColor @0.28   (rail fill — ONLY when sidebar is OPEN)
```

- **Open:** outline + divider + filled left rail → "a panel is showing."
- **Collapsed:** outline + divider, **no** fill → "a panel you can open."

**Reason the divider stays in both states:** a plain rounded square carries no meaning — users can't tell it toggles a side panel. Keeping the divider in both states makes the affordance self-evident; only the rail _fill_ communicates on/off. (This was an explicit review correction — do not regress it to a bare square.)

---

## 3. Changes, with the reason for each

### 3.1 `src/shell.jsx` — add a shared `SidebarToggle` component

Add one small presentational component (above `IconRail`). It renders the §2 SVG, takes `collapsed`, `onClick`, and an optional `size` (default 28). `title` / `aria-label` swap on `collapsed` ("Show sidebar ⌘B" / "Hide sidebar ⌘B"); `aria-pressed={collapsed}`.

> **Why:** the exact same control is rendered in two different places (sidebar header and icon rail). One component, two call sites guarantees the icon, tooltip, and a11y stay identical and can't drift. The `size` prop exists because the rail wants a 34px hit target to match the other rail buttons, while the header wants 28px.

### 3.2 `src/shell.jsx` — `IconRail`: accept state, host the collapsed toggle, drop the avatar

- Extend the signature: `IconRail({ activeArea, onArea, onCommand, onSettings, sidebarCollapsed, onToggleSidebar })`.
- **Delete** the placeholder "W" account avatar `<div>` at the top of the rail.
- When `sidebarCollapsed` is true, render `<SidebarToggle collapsed onClick={onToggleSidebar} size={34} />` at the top (before the `flex:1` spacer).

> **Why host it in the rail when collapsed:** once the sidebar is gone there is no header to hold the control, so it must have a second home that's always visible. The icon rail is the persistent 48px chrome — the natural place for a "bring the panel back" affordance. Rendering it _only_ when collapsed avoids two competing toggles on screen at once.
>
> **Why delete the "W" avatar:** it was an unwired placeholder with no account menu behind it. Leaving fake identity UI in a handoff invites the implementing agent to wire up something that doesn't exist, and it visually competes with the real control we're adding to the top of the rail. Remove it so the rail's top slot belongs unambiguously to the (conditional) sidebar toggle.

### 3.3 `src/shell.jsx` — `Sidebar`: accept `onToggleSidebar`, host the open toggle

- Extend the signature: add `onToggleSidebar`.
- In the project-header row (the one with the `VF` mark + `vimeflow-core` + `unfold_more` chevron), render `<SidebarToggle collapsed={false} onClick={onToggleSidebar} />` as the last child of that row.

> **Why in the header, not the main view:** the control must sit on the surface it acts on, so its meaning is unambiguous and it travels with the sidebar. (An earlier pass put it in the main session-tab bar; that was rejected because it reads as a tab-bar action, not a sidebar action.) Placing it beside the project switcher matches the Codex/VS-Code mental model where the panel's own header owns its collapse control.

### 3.4 `src/app.jsx` — add the persisted default

In `TWEAK_DEFAULTS`, add `"sidebarCollapsed": false` (next to `"activityCollapsed"`).

> **Why:** the app already persists all UI state through the `tweaks` object (`localStorage` + edit-mode protocol). Adding the flag here — rather than a local `useState` — means the collapse choice survives reloads and stays consistent with how every other panel's open/closed state is stored. Default `false` so first-run users see the sidebar.

### 3.5 `src/app.jsx` — conditionally render the sidebar + pass handlers

- Wrap the `<Sidebar … />` element in `{!tweaks.sidebarCollapsed && ( … )}`.
- Pass `onToggleSidebar={() => updateTweaks({ sidebarCollapsed: !tweaks.sidebarCollapsed })}` to **both** `<Sidebar>` and `<IconRail>`, and pass `sidebarCollapsed={!!tweaks.sidebarCollapsed}` to `<IconRail>`.

> **Why unmount instead of `display:none`:** the shell is a flex row (`IconRail | Sidebar | main`). Removing the `Sidebar` node lets `main` reclaim the full width with zero leftover gutter — no zeroed-width column, no stale border. `updateTweaks` is the existing setter that writes through to `localStorage` and the edit-mode bridge, so toggling stays in one code path.
>
> **Why both components get the same handler:** the toggle has two homes (§3.2, §3.3) but one behavior. Sharing the identical `updateTweaks` closure keeps them in lockstep.

### 3.6 `src/app.jsx` — add the `⌘B` / `Ctrl+B` shortcut

Add a `useEffect` (mirroring the existing `⌘K` palette and `⌘,` settings effects) that, on `(metaKey||ctrlKey) && key==='b'`, calls `e.preventDefault()` then `updateTweaks({ sidebarCollapsed: !tweaks.sidebarCollapsed })`. Depend on `[tweaks.sidebarCollapsed, updateTweaks]`.

> **Why:** collapsing the file/sessions panel is a high-frequency action and `⌘B` is the near-universal editor binding for it (VS Code, Codex, etc.) — meeting that muscle-memory expectation is the whole point. It mirrors the established keyboard-effect pattern already in `app.jsx`, so it reads as in-house code, and `preventDefault` stops the browser's bold shortcut from firing.

---

## 4. Acceptance criteria

1. **Open state** — toggle renders in the sidebar header (top-right); icon shows outline + divider + filled rail; no toggle in the icon rail; no "W" avatar anywhere.
2. **Collapsed state** — `<Sidebar>` is unmounted; `main` fills the freed width with no gutter/border artifact; toggle renders at the top of the icon rail; icon shows outline + divider, **no** fill.
3. **Persistence** — collapse, reload → state restored from `localStorage`.
4. **Keyboard** — `⌘B` (mac) / `Ctrl+B` (win/linux) toggles from anywhere; browser bold action does not fire.
5. **A11y** — the live toggle exposes `aria-pressed` and a state-appropriate `aria-label` / `title`.

---

## 5. Anti-patterns — do not add

- ❌ A plain square for the collapsed icon (must keep the panel divider — see §2).
- ❌ Two toggles visible at once (rail toggle is conditional on `collapsed`).
- ❌ Placing the toggle in the session-tab bar or any main-view chrome (§3.3).
- ❌ A local `useState` for the collapse flag (must go through `tweaks` for persistence — §3.4).
- ❌ Hiding the sidebar with `display:none`/zeroed width instead of unmounting (§3.5).
- ❌ Re-introducing the "W" avatar or any unwired identity UI (§3.2).
- ❌ New tokens, new colors, or new dependencies.
