# Vimeflow — Browser Pane (redesign)

A web/browser pane that fits the existing multi-pane split-grid. It reuses the
shared pane shell (rounded box, focus border + glow) and adopts **Arc-style
horizontal tabs**.

## Files

- `Browser Pane.html` — self-contained markup + CSS for the pane.
- `assets/github-dashboard.png` — placeholder screenshot of the loaded page.
  **In the app, replace the `<img>` inside `.page` with the real webview/iframe.**

## Structure

```
.pane                     ← shared pane shell (border = focus accent, overflow:hidden)
├─ .tabbar                ← Arc horizontal tabs
│  ├─ .wchip  "WEB"        ← pane identity chip
│  ├─ .tabs               ← capsule tabs (active = neutral elevated pill)
│  │  └─ .tab(.tab--active) → .fav (favicon) · .tab__title · .tab__x
│  └─ .ibtn2              ← new-tab (+) and close-pane (×)
├─ .toolbar              ← back / fwd / reload · .address (command bar) · open-external
└─ .page                 ← loaded web content (webview goes here)
```

## Key design decisions

- **Reserved WEB accent = cyan `#4fc8d6`.** Agents already own the other accents
  (claude=lavender, codex=mint, **gemini=blue `#a8c8ff`**, shell=yellow), so the
  browser needed its own identity color that doesn't collide. Used for: focus
  border + glow, WEB chip, address ring, nav-button hover, load bar.
- **Active tab is a neutral elevated capsule** (`--tab-active #23233b`), not a
  colored one — matches Arc, and keeps the cyan reserved for pane identity.
- **Per-site favicon colors**: cyan (default), mauve (`.fav--mauve`, PRs),
  coral (`.fav--coral`, issues).
- **Focus ring is a `border`** (not `outline`) so it follows the corner radius and
  wraps all four sides; `overflow:hidden` clips the tab bar + page inside it.
- **Page fills edge-to-edge** via `object-fit:cover; object-position:top center`.

## Tokens used

```
--surface-lowest #0d0d1c   --bar #121226        --tab-active #23233b
--on-surface #e3e0f7       --on-variant #cdc3d1  --muted #8a8299  --faint #6c7086
--line rgba(74,68,79,.30)  --line-soft rgba(74,68,79,.18)
--web #4fc8d6  --web-dim rgba(79,200,214,.12)  --web-soft rgba(79,200,214,.30)
--mint #7defa1  --mauve #cba6f7  --coral #ff94a5
font: JetBrains Mono (chrome/labels), Inter (body)
icons: Material Symbols Outlined
```

## Unfocused state

The focused pane uses `border:2px var(--web)` + glow. For the unfocused pane,
match the app convention: `border:1px solid rgba(74,68,79,0.22)` and drop the
box-shadow glow.
