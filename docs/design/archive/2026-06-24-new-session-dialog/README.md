# Handoff: New Session Dialog

## Overview
A modal dialog for **Vimeflow** that lets a user create a new agent session by choosing:
1. A **session name** (defaults to the working-directory folder name)
2. A **working directory** — picked via the native OS folder picker, or a recent folder
3. A **layout** (how panes are arranged)
4. A **starting command** per pane (Claude Code / Codex / Kimi / opencode / Browser pane / Shell)

The dialog has a **steady height** — its body scrolls internally, so it never resizes when the layout or pinned-layout state changes.

## About the Design Files
The files in this bundle are **design references created in HTML/React (Babel-in-browser)** — a prototype showing the intended look and behavior, **not production code to copy directly**. The task is to **recreate this design in Vimeflow's existing codebase**, using its established component patterns, theme tokens, and conventions. Vimeflow is already a React app (UMD React 18 + Babel today), so port the markup/state into the app's real component structure rather than shipping the prototype file.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and interactions are all specified below and present in the prototype. Recreate pixel-for-pixel using the existing theme variables (the prototype reuses Vimeflow's `--vf-*` token set).

---

## Screen: New Session Dialog

### Purpose
Launch a new multi-pane agent session, pinned to a chosen working directory, with each pane pre-assigned a starting command.

### Layout
- **Centered modal** on a dimmed radial-gradient backdrop.
- Dialog: `width: 560px` (max 100%), `border-radius: 14px`, `overflow: hidden`.
  - Background `rgba(30,30,46,0.96)` (`--vf-surface-2` @ 96%), border `1px solid rgba(226,199,255,0.18)`, shadow `0 30px 80px rgba(0,0,0,0.55)`.
- Three regions, top to bottom:
  1. **Header** (fixed): `padding: 16px 20px`, bottom border `1px solid rgba(74,68,79,0.25)`. Bolt icon (accent) + title "New session" + spacer + close button.
  2. **Body** (scroll region): `height: min(600px, 70vh)`, `padding: 18px 20px 24px`, `overflow: auto`. **This fixed height is what keeps the dialog steady** — content scrolls here, the dialog never grows.
  3. **Footer** (fixed): `padding: 14px 20px`, top border `1px solid rgba(74,68,79,0.2)`, background `rgba(13,13,28,0.4)`. Left: muted summary `"<N> panes · <folder>"` (mono). Right: Cancel (ghost) + Create session (primary).

### Body contents (in order)

**1. Session name**
- Uppercase label `Session name` (10.5px, letter-spacing .08em, `--vf-text-3`, weight 600).
- Field row: `padding 10px 12px`, bg `--vf-surface-0`, border `1px solid rgba(74,68,79,0.5)`, radius 9. Edit icon (15px, `--vf-text-3`) + text input (13px, weight 500, `--vf-text`).
- Trailing pill:
  - When untouched: static "folder name" hint pill.
  - When user-edited: clickable "reset" pill (accent-tinted) → restores the folder basename and clears the edited flag.
- **Behavior:** name auto-tracks the folder basename until the user types; once edited, changing the folder no longer overwrites it (unless reset).

**2. Working directory**
- Label `Working directory`.
- Row: path crumb field (flex 1, bg `--vf-surface-0`, border `1px solid rgba(203,166,247,0.3)`, radius 9, folder_open icon accent) + **Browse…** button (`--vf-surface-3` bg, drive_folder_upload icon).
  - **Browse… calls the native OS folder picker** via `window.showDirectoryPicker({ mode:'read' })`. On success uses `'~/' + handle.name`. On cancel/unsupported, falls back to a placeholder path. In the real app, wire this to the platform's directory picker (Tauri `dialog.open({ directory:true })`, Electron `dialog.showOpenDialog`, etc.).
- **Recent folders list** below: rows with a colored project badge (22×22, radius 6, mono initials), the path crumb, a branch chip (fork_right icon), and a relative timestamp. Clicking a row sets the path (and name, if untouched).
- **Path crumb rendering:** split path on `/`; render `~` and intermediate segments in `--vf-text-3`/`--vf-text-2`, last segment in `--vf-accent-bright` weight 600. (Do NOT prepend an extra `~/` — render the tilde as a normal first segment, or you get a doubled slash.)

**3. Layout + Starting command (side-by-side row)**
- Container: `display:flex; gap:16px; align-items:flex-start; min-height:232px`. The `min-height` reserves space for the tallest state (an extra layout pinned) so this section never reflows.
- **Left column — Layout** (`width:158px`, fixed):
  - Label `Layout`. Vertical list of **quick layouts** (Single, Vertical, Horizontal). Each row: layout glyph (SVG) + name + pane-count (mono, right).
    - Selected: bg `rgba(203,166,247,0.12)`, border `1px solid rgba(203,166,247,0.45)`, name in `--vf-accent-bright` weight 600.
    - Unselected: bg `--vf-surface-0`, border `1px solid rgba(74,68,79,0.4)`.
  - **"More layouts"** button (dashed border) opens a floating popup listing ALL layouts (Single, Vertical, Horizontal, Main+2, Quad). Picking a non-quick layout **pins it** into the visible list.
- **Right column — Starting command** (flex 1):
  - Label `Starting command` + sub-hint "click a panel to choose what it opens with".
  - **Layout board:** a CSS-grid miniature of the chosen layout (`height:150px`, `gap:8px`), using the layout's `cols`/`rows`/`areas`. Each cell is a **skeleton pane button** (dashed border, centered): command glyph (30×30 tinted chip) + command name (+ "soon" pill if applicable) + CLI name + expand_more chevron.
    - Selected pane: solid accent border + tinted bg + the command's accent.
    - Clicking a pane opens a **floating command popup** (see Interactions).

### Floating popups (shared `FloatingMenu`)
Both "More layouts" and the per-pane command picker use a shared **fixed-position** popup so they **escape the dialog's scroll container and never change the dialog height**:
- Rendered `position: fixed`, anchored to the trigger's `getBoundingClientRect()`.
- `top = anchor.bottom + 5`; **flips up** (`anchor.top - height - 5`) if it would overflow the viewport bottom; **clamps** to the right viewport edge (8px margin).
- Full-screen transparent backdrop (`position:fixed; inset:0; z-index:100`) closes on outside click; menu is `z-index:101`.
- Style: bg `rgba(30,30,46,0.98)`, border `1px solid rgba(74,68,79,0.5)`, radius 10, padding 5, shadow `0 16px 40px rgba(0,0,0,0.5)`, `backdrop-filter: blur(8px)`, entrance `vfPop 140ms`.

---

## Interactions & Behavior
- **Browse…** → native OS folder picker; on success updates path (and name if untouched).
- **Recent folder click** → set path (+ name if untouched).
- **Name reset pill** → restore folder basename, clear edited flag.
- **Layout select** → updates the layout board and footer pane count.
- **More layouts** → floating popup; selecting a non-quick layout pins it into the left list (`extra` state) and selects it.
- **Pane click** → floating command popup; selecting assigns that command to that pane index.
- All popups: outside-click closes; auto flip-up + edge-clamp.
- Entrance animation on first mount is intentionally OFF for the dialog body (it caused a stuck `opacity:0` in static capture contexts) — keep the dialog visible without an opacity keyframe, or gate any entrance animation so its end-state is the base style.

## State Management
- `path: string` — current working directory (e.g. `~/code/vimeflow-core`).
- `name: string` — session name; `nameEdited: boolean` — whether the user typed a custom name.
- `layoutId: string` — one of `single | vsplit | hsplit | threeRight | quad`.
- `extra: string | null` — a "More" layout the user pinned into the quick list.
- `layoutMenu: DOMRect | null` — anchor rect for the More-layouts popup.
- `assign: string[]` — command key per pane index (default `['claude','shell','shell','shell']`).
- `openPane: { i, anchor } | null` — which pane's command popup is open + its anchor rect.
- Derived: `layout = LAYOUTS[layoutId]`; `visibleLayouts = extra not in quick ? [...quick, extra] : quick`.

## Design Tokens (from Vimeflow's `--vf-*` set)
- Surfaces: `--vf-surface-0 #0d0d1c`, `--vf-surface-1 #121221`, `--vf-surface-2 #1e1e2e`, `--vf-surface-3 #292839`, `--vf-bg #141424`.
- Text: `--vf-text #e3e0f7`, `--vf-text-1 #cdc3d1`, `--vf-text-2 #8a8299`, `--vf-text-3 #6c7086`.
- Accent: `--vf-accent #cba6f7`, `--vf-accent-bright #e2c7ff`. Outline `--vf-outline #4a444f`.
- Status: `--vf-success #7defa1`, `--vf-warn #ff94a5`.
- **Command accents:** claude `#cba6f7`, codex `#7defa1`, kimi `#74e0cf`, opencode `#f7a6d4`, vbrowser `#a8c8ff`, shell `#f0c674`. Each also uses a `dim` (≈16% alpha) chip bg and `soft` (≈34% alpha) chip border of the same hue.
- Radii: fields/buttons 9, chips/glyph 6–8, dialog 14, popups 10.
- Type: UI = Inter; all mono = `'JetBrains Mono', monospace`. Labels 10.5px /.08em /600 uppercase. Body 12–13px.

### Commands registry
| key | name | CLI | glyph | ships? |
|---|---|---|---|---|
| claude | Claude Code | claude | ∴ | yes |
| codex | Codex CLI | codex | ◇ | yes |
| kimi | Kimi | kimi | ◐ | yes |
| opencode | opencode | opencode | ◈ | **soon** (badge) |
| vbrowser | Browser pane | vbrowser | ◑ | yes |
| shell | Shell | zsh | $ | yes |

### Layout registry
| id | name | cap | cols | rows | areas |
|---|---|---|---|---|---|
| single | Single | 1 | `1fr` | `1fr` | `[[p0]]` |
| vsplit | Vertical | 2 | `1fr 1fr` | `1fr` | `[[p0,p1]]` |
| hsplit | Horizontal | 2 | `1fr` | `1fr 1fr` | `[[p0],[p1]]` |
| threeRight | Main + 2 | 3 | `1.4fr 1fr` | `1fr 1fr` | `[[p0,p1],[p0,p2]]` |
| quad | Quad | 4 | `1fr 1fr` | `1fr 1fr` | `[[p0,p1],[p2,p3]]` |
Quick layouts (always shown): `single`, `vsplit`, `hsplit`. Others live behind "More layouts".

## Assets
- **Icons:** Google Material Symbols Outlined (`bolt`, `close`, `edit`, `folder_open`, `drive_folder_upload`, `account_tree`, `fork_right`, `more_horiz`, `expand_more`, `expand_less`, `check`). Map to your existing icon system.
- **Fonts:** Inter + JetBrains Mono (Google Fonts). Use the app's existing font stack if it already loads these.
- No raster images; command/layout glyphs are Unicode + inline SVG.

## Files
- `New Session Dialog.html` — entry; loads React/Babel, theme tokens, and the two JSX files.
- `new-session-dialog.jsx` — the full dialog: registries, `FloatingMenu`, `LayoutBoard`, `LayoutGlyph`, `PathCrumb`, `NewSessionDialog`, styles.
- `design-canvas.jsx` — present only because the earlier exploration used it; NOT needed for this dialog. Ignore for implementation.

## Related (not part of this dialog, but shipped in the same effort)
The narrow-pane **bottom status bar** (branch · diff · time) + its Tweaks controls (`paneStatusBar`, `paneNarrowW`) live in `src/splitview.jsx` / `src/overlays.jsx` of the main app, not in this dialog. Mentioned only so your agent knows it's separate.
