# Handoff delta — Dock position update

These four files supersede their counterparts in `docs/design/handoff/prototype/src/`.
Nothing else from the handoff bundle changed.

## What's new

A **dockable** Editor/Diff/Files panel. The panel can sit at the **bottom** (default),
**left**, or **right** of the terminal area, or be **hidden** entirely.

### Tweak schema additions

```ts
dockPosition: 'bottom' | 'left' | 'right' | 'hidden' // default 'bottom'
dockSize: number // % of split, clamped 20–70, default 40
```

`bottomPanelOpen` is still honoured; `dockPosition: 'hidden'` is the canonical "off" state.

### Layout rule

The terminal-area + dock-panel pair sit inside a single flex container whose
`flex-direction` and child order are derived from `dockPosition`:

| position | direction | order          |
| -------- | --------- | -------------- |
| bottom   | column    | terminal, dock |
| top      | column    | dock, terminal |
| left     | row       | dock, terminal |
| right    | row       | terminal, dock |
| hidden   | —         | dock omitted   |

### UI

- Dock-position switcher lives **inside the dock panel header** (right side, before the close button), using `<DockSwitcher compact />`.
- Tweaks panel exposes the full 4-option `<DockSwitcher />` under "Editor / Diff dock".
- The "show editor & diff" reveal button rotates to a vertical edge tab when the dock was last docked left/right.
- Collapse chevron in the dock header rotates to match position (`expand_more` / `chevron_left` / `chevron_right`).

### Component renames

- `BottomPanel` → `DockPanel`. A `BottomPanel = DockPanel` alias is exported for back-compat.
- New: `DockSwitcher`, `DockGlyph` (in splitview.jsx).

## Files in this delta

```
prototype/src/app.jsx
prototype/src/views.jsx
prototype/src/splitview.jsx
prototype/src/overlays.jsx
diagrams/dock-bottom.svg      ← default position
diagrams/dock-left.svg        ← dock on left of terminal
diagrams/dock-right.svg       ← dock on right of terminal
diagrams/dock-hidden.svg      ← dock collapsed; vertical reveal tab on edge
```

Drop the `prototype/src/*.jsx` files over the matching paths in
`docs/design/handoff/prototype/src/`. The SVG is a vector reference for the
dock-position layouts — open it in any browser/SVG viewer at any size; agents
can also read its source to understand zone ordering.
