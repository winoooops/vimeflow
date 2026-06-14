# Vimeflow — Sidebar Session List Migration

> **Scope note:** this covers ONLY the **session-list area** of the sidebar — the view-switcher row (Sessions/Files + "+") and the session cards below it. The **agent status card** and the **sidebar top bar / button group** (toggle + command palette + settings) were delivered in earlier handoffs; they are unchanged here.

> **Paste-to-agent prompt:**
>
> Modernize the sidebar's session list to match how AI chat/agent apps (ChatGPT, Claude, Linear, Cursor) present a conversation list. Replace the "generic AI template" look — left accent bars, outline borders, badge-pill soup — with flat soft-fill rows and a clean type hierarchy. Specifically: **(1)** session cards use a single soft fill for active/hover (no border, no left vertical accent line, no status-dot, no chip pills); **(2)** status is plain colored text + time on the bottom row; **(3)** a per-session **pane-layout glyph** on the right that REUSES the editor's existing `LayoutGlyph` (shown only for multi-pane sessions); **(4)** a hover-only **kebab (⋯) menu** with Rename / Remove, absolutely positioned so the row never resizes; **(5)** the Sessions/Files segmented control gets a `view_agenda` icon and no count badge, with a flat lavender active pill; **(6)** a primary flat **"+" new-session** button at the end of that row (replaces the old dashed bottom button), with a platform-aware `⌘N`/`Ctrl+N` tooltip + shortcut; **(7)** per-section counts in the headers (`Active · N`, `Recent · N`). `Sidebar Session List.html` is runnable — copy from it. Follow the per-change reasoning in §3; don't reintroduce any of the removed chrome.

---

## 1. Files & deps

- **Edit:** `src/shell.jsx` — `SessionCard`, `MenuRow`, `SidebarViewSwitcher`, `SegTab`, and the `Sidebar` list section.
- **Wire:** `src/app.jsx` — pass `onNew` / `onEdit` / `onRemove` into `<Sidebar>`; add the `⌘N` shortcut effect.
- **Data:** `src/data.js` — each session needs a `layout` field (`'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'`).
- **Reused, do NOT re-draw:** `LayoutGlyph` + `VIMEFLOW_LAYOUTS` from `src/splitview.jsx` (already `window`-exported); `Icon`, `SectionLabel`, `StatusDot`, `ScrollArea` from `src/primitives.jsx`.

No new dependencies, no new fonts/icons beyond what the app already loads.

---

## 2. Before → after (what changed and why it looked "AI-slop")

| Element         | Before (generic)                                                                    | After (modern)                                                                          |
| --------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Active row      | left accent bar + 1px outline + tint                                                | single soft fill `rgba(203,166,247,0.13)`, no border, no bar                            |
| Hover row       | —                                                                                   | soft `rgba(255,255,255,0.04)` fill                                                      |
| Status          | `Chip` pill ("running · 2m")                                                        | plain colored text + muted time                                                         |
| Title row       | status dot + title + `↵`-count                                                      | just the title (dot & count removed)                                                    |
| Right meta      | `+48 −12` LoC diff                                                                  | pane-layout glyph (multi-pane only)                                                     |
| Row actions     | none                                                                                | hover-only kebab ⋯ menu (Rename/Remove)                                                 |
| Switcher        | 3 mono labels (looked static) → had a count badge + a `data_usage` "context" toggle | 2-segment control (`view_agenda`/`folder_open`), flat pill, no count, no context toggle |
| Create          | dashed "+ new session" at list bottom                                               | flat lavender "+" button in the switcher row                                            |
| Section headers | "Active" / "Recent"                                                                 | "Active · N" / "Recent · N"                                                             |

---

## 3. Changes, with the reason for each

### 3.1 Session card — flat, borderless, soft-fill

The card is a `div[role=button]` (not a `<button>`, because it now nests the kebab button — nested buttons are invalid HTML). Background is the only state signal:

```
active:            rgba(203,166,247,0.13)
hover || menuOpen: rgba(255,255,255,0.04)
else:              transparent
```

No border, **no left vertical accent line**, radius 10, `marginBottom: 2`.

> **Why:** the left accent bar + outline + glow is the tell-tale "AI-generated card." Real chat sidebars (ChatGPT/Claude/Linear) indicate selection with one quiet filled pill and nothing else. Dropping the border/bar and leaning on a single fill is what makes it read as a product, not a template.

### 3.2 Removed the status dot and the hanging indent

Row 1 is just the title now. When the dot existed, rows 2–3 had `marginLeft: 15` to hang under the title; with the dot gone, that indent was removed so everything aligns to the left edge.

> **Why:** the colored status **text** on row 3 ("Running", "Awaiting you", …) already encodes state; a dot in the title row was redundant and added visual noise. (This was an explicit review removal — don't re-add it.)

### 3.3 Status as text, not a chip

Row 3: `meta.label` in the state tone color + `· {time}` muted. State→tone map:
`running #7defa1 · awaiting #ff94a5 · completed #c9b3f0 · errored #ffb4ab · idle #8a8299`.

> **Why:** pill chips everywhere ("chip soup") are heavy and generic. Plain colored text is lighter and lets the title dominate the row.

### 3.4 Pane-layout glyph — REUSE `LayoutGlyph`

On the right of row 3, for **multi-pane sessions only** (`s.layout && s.layout !== 'single'`):

```jsx
<span
  style={{
    display: 'inline-flex',
    color: active ? '#cba6f7' : '#7c7689',
    flexShrink: 0,
  }}
  title={(window.VIMEFLOW_LAYOUTS[s.layout] || {}).name}
>
  <window.LayoutGlyph layoutId={s.layout} />
</span>
```

> **Why a layout glyph (not a branch name or LoC diff):** a session holds **multiple panes**; an aggregate `+48 −12` conflates work across panes and a single branch name doesn't convey the multi-pane structure. The pane-layout glyph shows the session's split arrangement at a glance.
> **Why reuse `LayoutGlyph`:** that exact component already draws the layout icons in the editor toolbar's `LayoutSwitcher`. Reusing it (instead of a parallel hand-drawn glyph) guarantees the sidebar and toolbar never drift, and it inherits the canonical layout IDs. It's already `window`-exported from `splitview.jsx` — just call `window.LayoutGlyph`. `shell.jsx` loads before `splitview.jsx`, so reference it at **render time** via `window.LayoutGlyph` (don't import at module top). Hidden for `single` because a lone rectangle communicates nothing.

### 3.5 Hover kebab (⋯) menu — absolutely positioned

A 24×24 `more_horiz` button appears on `hover || menu`, positioned `absolute; top: 7; right: 8` (5 when compact). Clicking opens a small popover (`#1c1c30`, radius 9) with two `MenuRow`s: **Rename** (`edit`) and **Remove** (`delete`, danger-red). `e.stopPropagation()` on the button and popover so they don't trigger the card's `onClick`.

> **Why absolute, not inline:** an earlier version put the action icons inline in the title row, which **changed the card height on hover** (the 22px buttons were taller than the text line) — the row visibly jumped. Absolutely positioning the control overlays it in the corner so layout is identical hover vs not. _(Verified: card height constant at 79px.)_
> **Why one kebab vs two inline icons:** matches the `⋯` overflow pattern in Linear/ChatGPT/Cursor — quiet until needed, and extensible (more actions later) without crowding the row.

### 3.6 Switcher: `view_agenda` icon, no count, flat pill

`SidebarViewSwitcher` is a 2-segment control (Sessions/Files). The Sessions icon is **`view_agenda`** (stacked rows) not `bolt`; the count badge is removed. The active thumb is a **flat** fill `rgba(203,166,247,0.16)` + `1px rgba(203,166,247,0.4)` border — no gradient, no glow.

> **Why `view_agenda` over `bolt`:** a lightning bolt reads as "fast/active," meaningless for a session list; stacked rows read as "a list of sessions." **Why drop the count badge:** the per-section headers now carry counts (§3.8), so a tab badge double-counts. **Why flat pill:** the gradient + `0 0 14px` glow was ambient "AI lighting"; a flat tint matches the rest of the redesigned sidebar.

### 3.7 Primary "+" new-session button

A flat 38px square button at the end of the switcher row: `bg rgba(203,166,247,0.1)`, `border 1px rgba(203,166,247,0.32)`, lavender `add` icon; hover deepens the fill. Tooltip + `aria-keyshortcuts` are platform-aware (`⌘N` on mac, `Ctrl+N` else). The old dashed "+ new session" button at the list bottom is **deleted**. Wire `onNew` to the app's `newSessionTab`, and add a `⌘N`/`Ctrl+N` keydown effect mirroring the existing `⌘K`/`⌘B` ones.

> **Why move it up & flatten it:** a create action belongs with the view controls, not stranded at the bottom of a scrolling list. The first version was a bright gradient pill inside a recessed track (double-framed, loud); flattening it to match the segmented control's active-pill treatment makes it sit in the same control family while still signalling "primary" via the lavender tint.

### 3.8 Per-section counts

`<SectionLabel>Active · {activeCount}</SectionLabel>` and `Recent · {recentCount}`, where active = `running||awaiting` and recent = everything else.

> **Why:** moves the at-a-glance count to where the grouping actually is, and lets the tab badge go away (§3.6).

---

## 4. Acceptance criteria

1. No left accent bar, no border, no status dot, no chip pills on any session card; active = single soft lavender fill.
2. Hovering a card does **not** change its height; a ⋯ button appears top-right and opens a Rename/Remove popover.
3. Multi-pane sessions show a layout glyph identical to the editor toolbar's `LayoutSwitcher` icon for the same layout; single-pane sessions show none.
4. Switcher shows Sessions (`view_agenda`) / Files with a flat active pill and **no** count badge and **no** context toggle.
5. "+" button sits in the switcher row, flat lavender, tooltip shows `⌘N`/`Ctrl+N`, and the shortcut creates a session; no dashed button at the list bottom.
6. Section headers read `Active · N` / `Recent · N`.

## 5. Anti-patterns — do not reintroduce

- ❌ Left vertical accent bar / outline border / glow on cards.
- ❌ Status dot in the title row, or chip-pill status.
- ❌ LoC diff (`+N −N`) or branch name as the card's right-side meta.
- ❌ Inline (layout-shifting) row action icons — the kebab must be absolutely positioned.
- ❌ A second hand-drawn pane glyph — reuse `window.LayoutGlyph`.
- ❌ Count badge on the Sessions tab, the `data_usage` context toggle, gradient/glow on the active pill.
- ❌ The dashed "+ new session" button at the list bottom.
