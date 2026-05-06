# Vimeflow — Full App Shell Handoff

A handoff package for implementing the **Vimeflow** desktop terminal app shell in your Tauri/Rust + React-TS-Tailwind codebase.

This bundle contains a complete, working HTML/React prototype of the entire Vimeflow application surface — multi-pane agent terminals, sessions, activity panel, bottom diff/editor panel, command palette, and global chrome. Use it as the **visual + behavioural source of truth** while you build the real thing.

---

## 1. About the design files

The files in `prototype/` are a **design reference**, not production code to copy.

They were authored as a single-file HTML React+Babel prototype because that medium produced the highest-fidelity, fastest-iterating reference. **Do not lift the JSX directly into your app.** Instead:

1. Read the prototype + this README.
2. Recreate each component in your existing **React 18 + TypeScript + Tailwind** stack, using your component primitives, your icon library, your routing, and your real backend bindings.
3. Wire pane state, sessions, and agent narratives to your **Tauri/Rust** backend (file watching, PTY processes, agent lifecycle, etc.).
4. Match the **visual fidelity pixel-for-pixel** — colours, spacing, typography, focus rings, transitions are all specified below.

The prototype's localStorage-backed `tweaks` system, `window.parent.postMessage` edit-mode protocol, and inline-style chains are **prototype-only conveniences**. Drop them in your real implementation.

## 2. Fidelity

**High-fidelity.** Every colour, font size, weight, spacing, border radius, and transition in the prototype is final. Recreate it pixel-for-pixel using Tailwind utilities (extend `tailwind.config.ts` with the design tokens in §6) — or your existing token system if it already mirrors these values.

The only things that are _not_ final and you can iterate on:

- Mock data (sessions, file tree, terminal narrative) — replace with real backend data.
- The "obsidian" / "editorial" / "dense" aesthetic variants exposed in Tweaks — the **obsidian** variant is the canonical default; treat the others as later add-ons.
- The placeholder icons (currently a Material Symbols subset). Use whichever icon library your app already uses (Lucide, Phosphor, etc.) — match the visual weight (1.4–1.6px stroke, 14–18px sizes).

---

## 3. App architecture

Vimeflow is a desktop-class IDE-meets-terminal for orchestrating multiple AI coding agents (Claude Code, Codex CLI, Gemini CLI, plain shell) running in parallel against the same repo. The visual model is **Cursor's split-view, but for agent terminals**.

### Top-level regions (left → right)

```
┌──────┬────────────┬─────────────────────────────────────────┐
│ Icon │  Sidebar   │  Main                                    │
│ Rail │            │  ┌─ Session tabs ──────────────────────┐ │
│      │  Sessions  │  │  [active] [other] [+]               │ │
│      │  Files     │  ├─────────────────────────────────────┤ │
│      │  Context   │  │  Layout switcher  [⌘1-4 / ⌘\]       │ │
│      │            │  ├─────────────────────┬───────────────┤ │
│      │            │  │  TerminalPane(s)    │  Activity     │ │
│      │            │  │  (single / split /  │  Panel        │ │
│      │            │  │   quad / 3-right)   │  (collapsible)│ │
│      │            │  ├─────────────────────┴───────────────┤ │
│      │            │  │  Bottom panel: Editor / Diff / Files│ │
│      │            │  │  (collapsible)                      │ │
│      │            │  ├─────────────────────────────────────┤ │
│      │            │  │  Status bar                         │ │
│      │            │  └─────────────────────────────────────┘ │
└──────┴────────────┴─────────────────────────────────────────┘
```

### Region widths / heights

| Region                 | Size                                                         | Notes                           |
| ---------------------- | ------------------------------------------------------------ | ------------------------------- |
| Icon rail (left)       | 48 px fixed                                                  | brand mark + view shortcuts     |
| Sidebar                | 272 px (272 in `comfortable`, 248 in `dense`)                | sessions / files / context tabs |
| Session tabs           | 38 px tall                                                   | tab strip on top of main        |
| Layout switcher bar    | ~40 px tall                                                  | only in split mode              |
| Terminal area          | flex: `1 1 60%` when bottom panel open, `1 1 100%` otherwise | grid of panes                   |
| Bottom panel           | flex: `1 1 40%` when open                                    | collapsible                     |
| Activity panel (right) | ~284 px when expanded, **36 px when collapsed**              | follows pane focus              |
| Status bar             | 24 px fixed                                                  | global, always visible          |

All widths assume `display: flex` with `flex: 1, minWidth: 0` chains so panes never overflow. **Critical**: any CSS Grid that lays out terminal panes must use `grid-template-columns: minmax(0, 1fr) ...` — bare `1fr` lets content force min-widths and breaks the layout.

---

## 4. Screens & components — exhaustive spec

All hex values are final. Fonts: `Inter` (UI), `JetBrains Mono` (code/terminal), `Instrument Sans` (display headings).

### 4.1 Icon Rail (left, 48 px)

- Background: `#0d0d1c`, border-right: `1px solid rgba(74,68,79,0.25)`
- Brand mark (top): 28×28 `border-radius: 8px`, `linear-gradient(135deg, #e2c7ff 0%, #cba6f7 100%)`. Glyph in centre, color `#2a1646`, weight 700, font `Instrument Sans`.
- Below brand: column of 34×34 icon buttons, gap 4 px, padded 8 px from brand. Icons: `bolt` (agent), `folder_open` (files), `code` (editor), `difference` (diff), `inventory_2` (context), `terminal`, `settings`, `command_palette`.
- States:
  - Idle: bg transparent, icon `#8a8299`
  - Hover: bg `rgba(226,199,255,0.06)`, icon `#cdc3d1`
  - Active: bg `rgba(203,166,247,0.14)`, border `1px solid rgba(203,166,247,0.32)`, icon `#cba6f7`, **left accent bar** absolute at `left:-10, width:2, top/bottom:8, background:#cba6f7, border-radius:2`
- User avatar at bottom: 30×30 `border-radius: 999px`, gradient `linear-gradient(135deg,#57377f,#1a1a2a)`, border `1.5px solid rgba(226,199,255,0.35)`.

### 4.2 Sidebar (272 px)

Three top-tabs with **left accent bar** for the active one (same pattern as icon rail):

- Header (`vimeflow-core` + branch `feat/jose-auth`) — 26×26 brand square gradient `linear-gradient(135deg,#cba6f7,#57377f)`, label color `#e3e0f7` size 13.5 weight 600, branch in JetBrains Mono 10px `#8a8299`.
- Tabs row: `SESSIONS / FILES / CONTEXT` — 11px JetBrains Mono uppercase, active tab `#cba6f7`, inactive `#6c7086`.
- **Sessions tab** (active by default):
  - "ACTIVE" / "RECENT" sub-headers in 10.5px uppercase `#6c7086`, letter-spacing 0.08em.
  - Each row: `padding: 10px 11px` (8px 9px in dense), `border-radius: 8px`, `margin-bottom: 4px`.
  - Active row: `background: rgba(203,166,247,0.10)`, left accent bar `2px #cba6f7`.
  - Row contents: `[StatusDot] [title bold #e3e0f7 13px] [updated time #6c7086]` then below `[subtitle #cdc3d1 11.5px]` then `[StatePill] [+added -removed]`.
  - StatusDot (7px): running `#50fa7b` + 4px glow, idle `#6c7086`, awaiting `#fab387` pulsing, completed `#7defa1`, errored `#ff94a5`.
- **Files tab**: indented tree, folders use `expand_more`/`chevron_right` 14px, files show language icon + git status letter (M, A, D) at right.
- **Context tab**: list of recently-loaded items with `draft` / `bolt` / `bug_report` icons.

### 4.3 Session tabs (top of main, 38 px)

Browser-style chrome tabs. Each tab:

- Height 30 px, sits with `margin-bottom: -1px` so the active tab visually merges with the canvas.
- Default tab: `padding: 0 8px 0 11px`, `background: transparent`, top corners `border-radius: 8px`, no bottom border, side borders `1px solid transparent`.
- **Active tab**: bg `#121221`, side+top border `1px solid rgba(74,68,79,0.25)`, **bottom border removed** (uses negative margin trick), top accent stripe `2px` in the focused agent's accent colour.
- Tab content: `[16px agent glyph chip] [title 12.5px #e3e0f7 truncated] [StatusDot 6px] [close X]`. Glyph chip is a 16×16 rounded square in the agent's `accentDim` background.
- `+` button: 28×28 ghost button at end of strip, icon `add` 14px, hover bg `rgba(226,199,255,0.06)`.
- Bottom of the strip: `border-bottom: 1px solid rgba(74,68,79,0.25)` (the active tab covers this with its negative margin).

### 4.4 Layout switcher (only when split mode is on, ~40 px tall)

- Bg `#121221`, border-bottom `1px solid rgba(74,68,79,0.18)`, padding `8px 14px`, gap 10.
- "LAYOUT" label: 10px JetBrains Mono uppercase `#8a8299` letter-spacing 0.08em.
- 5 layout buttons in a row, each 26×22 with a 14×11 SVG glyph showing the layout shape (single rectangle / vertical split line / horizontal split line / 2-col 2-row with main left / 2×2 grid).
- Active button: bg `rgba(203,166,247,0.15)`, border `1px solid rgba(203,166,247,0.45)`, icon `#cba6f7`. Inactive: transparent, `#8a8299`.
- Right side: keyboard-shortcut hints `⌘+1-4 focus pane · ⌘+\\ toggle split` in 10px JetBrains Mono `#6c7086`. Each `<Kbd>` is a small pill.

### 4.5 SplitView (terminal grid)

CSS Grid with **5 canonical layouts**:

| Layout     | Capacity | `grid-template-columns`           | `grid-template-rows`            | `grid-template-areas` |
| ---------- | -------- | --------------------------------- | ------------------------------- | --------------------- |
| single     | 1        | `minmax(0, 1fr)`                  | `minmax(0, 1fr)`                | `"p0"`                |
| vsplit     | 2        | `minmax(0, 1fr) minmax(0, 1fr)`   | `minmax(0, 1fr)`                | `"p0 p1"`             |
| hsplit     | 2        | `minmax(0, 1fr)`                  | `minmax(0, 1fr) minmax(0, 1fr)` | `"p0" "p1"`           |
| threeRight | 3        | `minmax(0, 1.4fr) minmax(0, 1fr)` | `minmax(0, 1fr) minmax(0, 1fr)` | `"p0 p1" "p0 p2"`     |
| quad       | 4        | `minmax(0, 1fr) minmax(0, 1fr)`   | `minmax(0, 1fr) minmax(0, 1fr)` | `"p0 p1" "p2 p3"`     |

- Outer grid: `gap: 8px`, `padding: 10px`, `flex: 1, minHeight: 0, minWidth: 0`.
- Each grid cell: a `<div style="grid-area: pN; min-height:0; min-width:0; display:flex">` wrapping a `<TerminalPane>` with `flex:1`.

> **Pitfall**: bare `1fr` columns will shrink to content width. Always use `minmax(0, 1fr)`.

### 4.6 TerminalPane

Single agent terminal pane. Composition:

```
┌───────────────────────────────────────────────────┐
│ [∴ CLAUDE] ● auth refactor · feat/jose-auth · +48 −12 · now · [↕] [✕] │  ← header
├───────────────────────────────────────────────────┤
│ — claude-code · attached to sess_auth · lavender  │  ← terminal scroll
│ ~/vimeflow-core · feat/jose-auth $ claude --resume│
│ ▸ Loading auth.ts and the related test fixtures...│
│ ⌥ read   src/middleware/auth.ts ● ok · cached     │
│ ...                                               │
├───────────────────────────────────────────────────┤
│ ● > paused                                        │  ← input footer
└───────────────────────────────────────────────────┘
```

- Container: `background: #121221`, `border-radius: 10px`, `overflow: hidden`.
- **Focus ring**: when this pane is focused, `outline: 2px solid <agent.accent>` with `outline-offset: -2px` AND `box-shadow: 0 0 0 6px <agent.accentDim>, 0 8px 32px rgba(0,0,0,0.35)`. Unfocused: `outline: 1px solid rgba(74,68,79,0.22)`, no shadow. Transition: `outline-color 180ms ease, box-shadow 220ms ease`. **Cursor**: `pointer` when unfocused, `default` when focused.
- Click anywhere on the pane → focus it.

#### Header (collapsible)

- Padding: `8px 12px 8px 10px` expanded, `6px 10px` collapsed.
- Background when focused: `linear-gradient(180deg, <agent.accentDim>, rgba(13,13,28,0.0))` — a subtle wash from agent colour to transparent. Unfocused: transparent.
- Bottom border: `1px solid rgba(74,68,79,0.18)`.
- Font: JetBrains Mono 10.5px, `user-select: none`.
- **Agent identity chip** (always shown):
  - `padding: 3px 8px 3px 6px`, `background: <agent.accentDim>`, `border: 1px solid <agent.accentSoft>`, `border-radius: 6px`.
  - Glyph (12px) + short name (10.5px weight 600 letter-spacing 0.04em), color `<agent.accent>`.
- After chip (always): `[StatusDot 6px] [pane title #cdc3d1]`.
- After title (only when **expanded**): `· [branch #8a8299] · [+added #7defa1] [-removed #ff94a5] · [relative time]`.
- Right side: collapse toggle (icon `unfold_less` / `unfold_more`) and close `✕`. Both 18×18 ghost buttons.

#### Terminal scroll body

- `flex: 1, overflow: auto, padding: 14px 18px 8px`, font JetBrains Mono 11.5px, line-height 1.6, color `#cdc3d1`.
- Lines stream in one at a time on a 1.4–2.3s random interval (capped by `paused` boolean).
- Line types and rendering rules:
  - **meta** (greyed setup line): color `#6c7086`, prefix `— `.
  - **prompt**: `<dim path>` `<accent branch>` `$` `<cmd>` — branch in `#cba6f7`, cmd in `#e3e0f7`. If `cursor: true`, append a blinking `▍` block.
  - **agent**: prefix `▸ ` in `#cba6f7`, body `#e3e0f7`.
  - **tool**: `⌥ <name>(<args>) ● <status> · <detail>` — name `#89b4fa`, args `#f5e0dc`, status pip `#7defa1` if ok else `#ff94a5`, detail `#6c7086`.
  - **output**: padding-left 14px, color `#cdc3d1`, fontSize 11.
  - **patch**: a small two-line block showing before / after snippets, before in `#ff94a5` background `rgba(255,148,165,0.06)`, after in `#7defa1` background `rgba(125,239,161,0.06)`, monospace.
- Auto-scroll to bottom whenever a new line appears (set `scrollTop = scrollHeight + 200`).

#### Input footer

- `border-top: 1px solid rgba(74,68,79,0.18)`, padding `8px 14px`, font JetBrains Mono 11px.
- Composition: `[StatusDot 6px] >` text input, transparent border, `color: #e3e0f7`, no outline. Placeholder when blurred: `paused` if pane state is idle/paused, else `click to focus <agent>`.

### 4.7 Activity Panel (right, 284 px / 36 px collapsed)

Follows pane focus — when user clicks Claude pane, the panel header shows `CLAUDE · auth refactor` in lavender; click Codex and it switches to mint `CODEX · test review`.

- Container: `background: #121221`, border-left `1px solid rgba(74,68,79,0.25)`.
- Header (panel chrome): 38 px tall, padding `8px 12px`, agent glyph chip + agent short name in agent accent + dimmed pane title, then collapse chevron at right.
- **Sections** (expanded only):
  1. **CONTEXT**: bar showing `94.7k / 128k` tokens used. Bar is 6px tall, bg `rgba(74,68,79,0.25)`, fill in agent accent with a subtle gradient tail.
  2. **5-HOUR USAGE**: `142 / 200` window, same bar pattern.
  3. **TURNS**: simple count.
  4. **TOKEN CACHE**:
     - Big `75 %` number (Instrument Sans 28px), label `CACHED THIS TURN` 9px uppercase `#8a8299`.
     - Sparkline (12 points, 64×40 SVG) in agent accent.
     - 3-segment stacked bar showing `cached / wrote / fresh` with labels and counts (8.4k / 740 / 2.1k).
     - "PAST SESSIONS" — 7 vertical bars showing historical hit rate per past session, height proportional to %, color blends accent → mint by hit rate.
     - "NOW" pulsing dot.
- **Collapsed state (36 px wide)**: shows just the agent glyph chip vertically + a 6 px vertical context-meter bar. Click chevron to re-expand.

### 4.8 Bottom panel (Editor / Diff / Files)

- Tab strip at top (28 px): three tabs `<> Editor`, `≡ Diff Viewer`, `📁 Files`. Active tab gets agent-accent underline (2px). Right side: collapse `✕` button.
- **Editor tab**: tab strip of open files (`auth.ts`, `session.ts`, `auth.test.ts`) with dirty dot, then code area with line numbers (44 px gutter `#6c7086`), syntax-highlighted by token type (keyword `#cba6f7`, string `#a6e3a1`, fn `#89b4fa`, var `#f5e0dc`, comment `#6c7086`, type `#fab387`, tag `#f38ba8`).
- **Diff tab**: file list on left (220 px) with `+/-` counts and status badge, side-by-side hunk viewer on right with line numbers and tone-coded backgrounds (add: `rgba(125,239,161,0.08)`, rem: `rgba(255,148,165,0.08)`).
- **Files tab**: same file tree as the sidebar Files tab, but full-width and richer.
- When closed: shows a 26 px "▴ show editor & diff" button at the bottom edge with hover lavender.

### 4.9 Status bar (global, 24 px)

- Bg `#0d0d1c`, border-top `1px solid rgba(74,68,79,0.2)`, padding `0 12px`, gap 14, font JetBrains Mono 10px `#8a8299`.
- Left: `obsidian-cli` (in lavender) `· v0.9.4`.
- Right: `[ContextSmiley emoji] 74% · [⚡ 73% cached] · 37 turns · ⌘ K`.
- ContextSmiley = an emoji that changes by context %: `😀` <50, `🙂` 50-70, `😐` 70-85, `😬` 85-95, `🥵` >95.

### 4.10 Command palette (`⌘K`)

- Centred modal, 560 px wide, top-margin 18% from viewport top. Backdrop: `rgba(13,13,28,0.5)` + `backdrop-filter: blur(6px)`.
- Body: `background: #1a1a2a`, `border: 1px solid rgba(74,68,79,0.4)`, `border-radius: 12px`, `box-shadow: 0 24px 80px rgba(0,0,0,0.5)`.
- Search input at top: 44 px tall, transparent bg, font `Instrument Sans` 16px, placeholder `Type a command…`.
- Below: list of commands. Each row: `[icon 16px] [label] [hint right-aligned dim]`. Selected row: bg `rgba(203,166,247,0.10)`, left accent bar.
- Esc / click outside to dismiss.

---

## 5. Behaviour & state model

### 5.1 Top-level state

```ts
interface VimeflowState {
  // Aesthetic
  aesthetic: 'obsidian' | 'editorial' | 'dense'
  density: 'compact' | 'comfortable' | 'spacious'
  accentHue: number // 0-360, defaults to 285 (lavender)

  // Active session
  activeSessionId: string // sess_auth, sess_tests, ...
  agentState: 'running' | 'idle' | 'awaiting' | 'completed' | 'errored'

  // View
  view: 'terminal' | 'editor' | 'diff' | 'files'
  splitMode: boolean // single pane vs split
  layout: 'single' | 'vsplit' | 'hsplit' | 'threeRight' | 'quad'
  focusedPaneId: string // p1, p2, ...
  activityCollapsed: boolean
  bottomPanelOpen: boolean
  bottomPanelTab: 'editor' | 'diff' | 'files'

  // Open session tabs (browser-style)
  openSessionIds: string[]

  // Pane registry (one entry per visible pane)
  panes: Array<{
    id: string
    agentId: 'claude' | 'codex' | 'gemini' | 'shell'
    sessionId: string
    title: string
  }>
}
```

### 5.2 Keyboard shortcuts

| Key                | Action                                              |
| ------------------ | --------------------------------------------------- |
| `⌘1` – `⌘4`        | Focus pane at index N (no-op if pane doesn't exist) |
| `⌘\`               | Toggle layout `single` ↔ `vsplit`                   |
| `⌘K`               | Toggle command palette                              |
| `⌘W` _(suggested)_ | Close focused pane (auto-shrinks layout)            |
| `⌘T` _(suggested)_ | New pane in current layout (up to layout capacity)  |
| `Esc`              | Dismiss command palette / close any modal           |

All shortcuts respect `e.metaKey || e.ctrlKey` so they work on Linux/Windows too. Always `preventDefault()` after handling.

### 5.3 Pane lifecycle

- **Spawn**: when layout grows (`single → vsplit`), generate a new pane using `VIMEFLOW_DEFAULT_PANES[index]` as a template. Default agents by index: 0=claude, 1=codex, 2=gemini, 3=shell.
- **Close pane**: remove from `panes`, **auto-shrink layout** to fit:
  - 0 panes → no-op (don't allow closing the last pane)
  - 1 pane → `single`
  - 2 panes → keep current `vsplit`/`hsplit`, fall back to `vsplit`
  - 3 panes → `threeRight`
  - 4 panes → `quad`
- **Focus**: clicking a pane sets `focusedPaneId`. Focus changes propagate to:
  - Pane outline (lavender → mint glow swap, 180ms ease)
  - Header background gradient
  - Cursor (pointer → default)
  - Activity panel (re-resolves agent + session)
  - Session tabs accent stripe (matches focused agent)

### 5.4 Session tab interactions

- Click tab → set `activeSessionId`.
- Click `✕` on tab → remove from `openSessionIds`. If was active, fall back to first remaining tab.
- Click `+` → open the first non-open session, or fall back to scratchpad. New tab becomes active.
- **Don't** auto-close the last tab.

### 5.5 Terminal narrative streaming

For the prototype, each pane streams a scripted array of lines on a 1.4–2.3s random interval. In production, replace with **real PTY output via Tauri's process API** — the line types (meta/prompt/agent/tool/output/patch) are a useful structuring abstraction; classify real output into them in your renderer.

Pause rule: when `paused` (i.e., session.state !== 'running'), stop streaming new lines but keep already-streamed lines visible.

### 5.6 Activity panel collapse

- Click chevron in header → set `activityCollapsed: true`.
- Animation: `width 220ms ease`. Section content fades out at `opacity 120ms` so it doesn't clip ugly during the width transition.
- Collapsed rail still shows the agent glyph + a vertical context-meter so the user knows which session is focused.

### 5.7 Bottom panel collapse

- Click `✕` in tab strip → set `bottomPanelOpen: false`.
- Replaced with a 26 px "show editor & diff" button at bottom edge.
- Click that button → re-open. State is persisted.

### 5.8 Edit-mode (Tweaks) — prototype-only

The prototype uses a postMessage protocol for an in-iframe Tweaks panel. **Do not port this.** Your real app should use a native settings dialog or command-palette commands.

---

## 6. Design tokens

Add these to `tailwind.config.ts`:

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        // Surfaces — deepest to brightest. Never pure black or pure white.
        surface: {
          DEFAULT: '#121221',
          'container-lowest': '#0d0d1c',
          'container-low': '#1a1a2a',
          container: '#1e1e2e',
          'container-high': '#292839',
          'container-highest': '#333344',
          bright: '#383849',
          tint: '#e2c7ff',
        },
        // Text on surface
        'on-surface': '#e3e0f7',
        'on-surface-variant': '#cdc3d1',
        'on-surface-muted': '#8a8299',

        // Primary — lavender (Claude's accent + brand colour)
        primary: {
          DEFAULT: '#e2c7ff',
          container: '#cba6f7',
          dim: '#d3b9f0',
          on: '#3f1e66',
        },
        // Secondary — azure (info / Gemini)
        secondary: {
          DEFAULT: '#a8c8ff',
          container: '#57377f',
          dim: '#c39eee',
        },
        // Semantic
        warning: '#ff94a5', // tertiary in design notes
        error: '#ffb4ab',
        'error-dim': '#d73357',
        success: '#50fa7b', // running pip
        'success-muted': '#7defa1', // mint accent (Codex)

        // Outlines (always at ≤15% alpha when used)
        'outline-variant': '#4a444f',

        // Catppuccin syntax subset
        syn: {
          keyword: '#cba6f7',
          string: '#a6e3a1',
          fn: '#89b4fa',
          var: '#f5e0dc',
          comment: '#6c7086',
          type: '#fab387',
          tag: '#f38ba8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        display: ['"Instrument Sans"', '"Manrope"', 'system-ui'],
      },
      fontSize: {
        // Vimeflow's scale — tighter than Tailwind defaults
        '2xs': ['10px', { lineHeight: '14px' }],
        xs: ['10.5px', { lineHeight: '15px' }],
        sm: ['11.5px', { lineHeight: '16px' }],
        base: ['13px', { lineHeight: '19px' }],
        lg: ['16px', { lineHeight: '22px' }],
        xl: ['20px', { lineHeight: '26px' }],
        '2xl': ['28px', { lineHeight: '32px' }],
      },
      borderRadius: {
        pane: '10px',
        tab: '8px 8px 0 0',
        chip: '6px',
        pill: '999px',
        modal: '12px',
      },
      boxShadow: {
        'pane-focus':
          '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
        modal: '0 24px 80px rgb(0 0 0 / 0.5)',
        'pip-glow': '0 0 4px currentColor',
      },
      transitionTimingFunction: {
        pane: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
}
```

### Agent accent registry (TypeScript)

```ts
// src/agents/registry.ts
export const AGENTS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    model: 'sonnet-4',
    accent: '#cba6f7', // lavender
    accentDim: 'rgb(203 166 247 / 0.16)',
    accentSoft: 'rgb(203 166 247 / 0.32)',
    onAccent: '#2a1646',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    model: 'gpt-5-codex',
    accent: '#7defa1', // mint
    accentDim: 'rgb(125 239 161 / 0.16)',
    accentSoft: 'rgb(125 239 161 / 0.32)',
    onAccent: '#0a2415',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    short: 'GEMINI',
    glyph: '✦',
    model: 'gemini-2.5',
    accent: '#a8c8ff', // blue
    accentDim: 'rgb(168 200 255 / 0.16)',
    accentSoft: 'rgb(168 200 255 / 0.32)',
    onAccent: '#0e1c33',
  },
  shell: {
    id: 'shell',
    name: 'shell',
    short: 'SHELL',
    glyph: '$',
    model: null,
    accent: '#f0c674', // yellow
    accentDim: 'rgb(240 198 116 / 0.14)',
    accentSoft: 'rgb(240 198 116 / 0.30)',
    onAccent: '#2a1f08',
  },
} as const
export type AgentId = keyof typeof AGENTS
```

### Spacing scale (in px — pick the closest Tailwind class)

| Token        | Value | Use                                    |
| ------------ | ----- | -------------------------------------- |
| `gap-pane`   | 8     | gap between split-view panes           |
| `pad-pane`   | 10    | padding around split-view              |
| `pad-pane-x` | 12    | TerminalPane header / footer x-padding |
| `pad-pane-y` | 8     | TerminalPane header / footer y-padding |
| `pad-row`    | 11    | sidebar session row x-padding          |

---

## 7. Tauri/Rust integration notes

The prototype mocks all data. Real integration:

| Prototype                       | Replace with                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `VIMEFLOW_PANE_SCRIPTS`         | PTY stream from `tauri::process::Command` per pane, streamed via channel + classified into line types in the JS renderer |
| `VIMEFLOW_SESSIONS`             | Rust-side session registry; expose via `invoke('list_sessions')`                                                         |
| `VIMEFLOW_TREE`                 | `notify` filewatcher + git status from `git2` crate                                                                      |
| `VIMEFLOW_DIFF_HUNK` / `_FILES` | `git2::Repository::diff_workdir_to_index` then serialize to TS                                                           |
| `VIMEFLOW_EDITOR_FILE`          | Read file contents on click, syntax-highlight client-side (Shiki)                                                        |
| Activity panel context/usage    | Subscribe to agent CLI's session telemetry (Claude Code: `~/.claude/sessions/`, Codex: similar)                          |
| Cache history                   | Aggregate from session history files                                                                                     |

The terminal pane's input footer should route keystrokes to the underlying PTY; status pip reflects Tauri-side process health.

---

## 8. Files in this bundle

```
docs/design/handoff/
├── README.md                            ← you are here
├── prototype/
│   ├── Vimeflow.html                    ← entry point. open this to see the design.
│   └── src/
│       ├── tokens.js                    ← Obsidian Lens token registry (port to tailwind.config.ts)
│       ├── agents.js                    ← AGENTS registry + per-pane scripts
│       ├── data.js                      ← all mock data (sessions, tree, diff, editor file, commands)
│       ├── primitives.jsx               ← StatusDot, Icon, RelTime, ContextSmiley, Kbd, etc.
│       ├── shell.jsx                    ← IconRail, Sidebar, SessionTabs
│       ├── views.jsx                    ← TerminalView (single-pane), BottomPanel (Editor/Diff/Files)
│       ├── splitview.jsx                ← VIMEFLOW_LAYOUTS, SplitView, TerminalPane, LayoutSwitcher
│       ├── activity.jsx                 ← ActivityPanel (collapsible, agent-aware)
│       ├── overlays.jsx                 ← CommandPalette, TweaksPanel
│       └── app.jsx                      ← top-level App component, state, keyboard wiring
└── screenshots/
    ├── 01-default-split-vsplit-claude-focused.png  ← canonical default state
    ├── 02-single-pane-bottom-panel-open.png        ← single layout
    ├── 03-vsplit-codex-focused-activity-collapsed.png
    ├── 04-quad-layout-all-panes.png
    └── 05-three-right-main-plus-stack.png
```

To view the prototype locally: serve `docs/design/handoff/prototype/` over any static server (e.g. `python -m http.server` from inside that folder) and open `http://localhost:8000/Vimeflow.html`. **Don't** open the file via `file://` — Babel + the `<script src="src/...">` imports require an HTTP origin.

---

## 9. Implementation order suggestion

1. **Tokens + Tailwind config** (§6) — get the design system loaded.
2. **App shell layout** — icon rail + sidebar + main column + status bar. Empty placeholders for the inner regions. This locks in the proportions.
3. **Sidebar sessions list + session tabs** — read data from Rust mocks.
4. **Single TerminalPane** — header + scroll body + footer, wired to a real PTY for one agent. Ignore split-view at first.
5. **SplitView grid** — add the 5 layouts and pane focus. **Use `minmax(0, 1fr)`**.
6. **Activity panel** — start with always-expanded; add the collapse rail later.
7. **Bottom panel** — Editor first (a Shiki-rendered file), then Diff (use `react-diff-view` or similar), then Files.
8. **Command palette + keyboard shortcuts**.
9. **Polish pass** — focus rings, transitions, status pips, ContextSmiley, RelTime ticking.

---

Questions about anything in this doc? The prototype is the canonical reference — when in doubt, open it and check the actual rendered behaviour.
