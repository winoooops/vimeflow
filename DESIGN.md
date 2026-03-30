# Design

The frontend design system for Vimeflow. All implementation must follow these specifications exactly. Full details, screen mockups, and reference HTML live in `docs/design/`.

## Design Resources

**Google AI Studio project** — contains the original Stitch-generated HTML/CSS source for all screens:
https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true

**Stitch MCP Server** — use to generate and iterate on UI components that match this design system:

```bash
# Add the Stitch MCP server (requires STITCH_API_KEY in .env)
claude mcp add stitch \
  --transport http \
  --url "https://stitch.googleapis.com/mcp" \
  --header "X-Goog-Api-Key: ${STITCH_API_KEY}"
```

When building frontend features, agents should:

1. Reference the Google AI Studio project and screen specs in `docs/design/` for the target layout
2. Use the Stitch MCP server to generate components that match the design system
3. Verify output against `docs/design/DESIGN.md` rules (no-line, glassmorphism, token colors, etc.)

## Creative North Star: "The Obsidian Lens"

An atmospheric dark aesthetic — illuminated, translucent layers stacked within a deep nocturnal void. Not "dark mode" but "atmospheric dark." Tonal depth over structural lines, expansive breathing room, premium technical journal feel.

## Color Palette (Catppuccin Mocha)

| Token                       | Hex       | Usage                                          |
| --------------------------- | --------- | ---------------------------------------------- |
| `surface` / `background`    | `#121221` | Level 0 — base, infinite depth                 |
| `surface-container-lowest`  | `#0d0d1c` | Deepest recessed areas                         |
| `surface-container-low`     | `#1a1a2a` | Level 1 — sidebar, icon rail, context panel    |
| `surface-container`         | `#1e1e2e` | Level 2 — cards, main content areas            |
| `surface-container-high`    | `#292839` | Elevated cards, glassmorphism fills            |
| `surface-container-highest` | `#333344` | Level 3 — popovers, modals, inputs             |
| `surface-bright`            | `#383849` | Hover states                                   |
| `primary`                   | `#e2c7ff` | Primary text accent                            |
| `primary-container`         | `#cba6f7` | Active indicators, CTA gradients, brand        |
| `secondary`                 | `#a8c8ff` | Info accents, progress bars, status            |
| `secondary-container`       | `#124988` | Progress bar gradient end                      |
| `on-surface`                | `#e3e0f7` | Titles, active text                            |
| `on-surface-variant`        | `#cdc3d1` | Body text, secondary text (reduced eye strain) |
| `outline-variant`           | `#4a444f` | Ghost borders (15% opacity only)               |
| `error`                     | `#ffb4ab` | Error states                                   |

## Critical Design Rules

1. **No-Line Rule** — No 1px solid borders for sectioning. Use background color shifts only. If accessibility requires a border, use `outline-variant` at 15% opacity.
2. **Glass & Gradient** — Floating elements (modals, tooltips, command palette) use glassmorphism: `surface-container-high` at 60-80% opacity + `backdrop-blur: 12-20px`. Primary CTAs use a 135deg gradient from `primary` to `primary-container`.
3. **No Pure Black/White** — Never use `#000000` or `#FFFFFF`. Use the token system.
4. **No Sharp Corners** — Everything is rounded. Windows: `xl` (1.5rem), cards: `lg` (1rem), buttons/inputs: `md` (0.75rem), icons: `full`.
5. **No Divider Lines** — Separate list items with spacing (1rem), not `<hr>` or borders.
6. **Ambient Shadows** — Extra-diffused: `0px 10px 40px rgba(0,0,0,0.4)`. If the shadow is the first thing you see, it's too dark.
7. **Negative Space** — If a layout feels cluttered, increase padding rather than adding a line.

## Typography

| Role        | Font               | Size     | Color                |
| ----------- | ------------------ | -------- | -------------------- |
| Display-LG  | Manrope 700/800    | 3.5rem   | `on-surface`         |
| Headline-SM | Manrope 700        | 1.5rem   | `on-surface`         |
| Title-MD    | Inter 500/600      | 1.125rem | `on-surface`         |
| Body-MD     | Inter 400          | 0.875rem | `on-surface-variant` |
| Label-MD    | JetBrains Mono 400 | 0.75rem  | `on-surface-variant` |

Body text uses `on-surface-variant` to reduce strain. Titles and active states use `on-surface` to create a "read-first" hierarchy.

## App Layout (4-Column)

```
┌──────┬──────────┬─────────────────────┬──────────┐
│ Icon │ Sidebar  │    Main Content     │ Context  │
│ Rail │          │                     │  Panel   │
│ 48px │  260px   │      flexible       │  280px   │
│      │          │                     │          │
│ L0.5 │   L1     │        L0           │    L1    │
└──────┴──────────┴─────────────────────┴──────────┘
```

- **Icon Rail** (48px): `surface-container-low/80` + `backdrop-blur-xl`. Circular project icons, active = pill backlight with `primary-container/20`. "V" brand logo top. User avatar bottom.
- **Sidebar** (260px): `surface-container-low`. Collapsible categories with `uppercase tracking-widest` headers. Search bar with `Cmd+K` shortcut. Conversation items with sub-threads.
- **Main Content** (flexible): `surface`. Top tab bar (Chat/Files/Editor/Diff) with active = `border-b-2 border-primary-container`. Content varies by tab.
- **Context Panel** (280px): `surface-container-low`. Agent status, model info card, recent actions timeline, AI strategy summary. System health footer with version + pulse indicator.

## Screens

Each screen has a reference screenshot (`screen.png`) and implementation HTML (`code.html`) in `docs/design/`. These are the ground truth.

| Screen              | Directory          | Tab Active | Main Content                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat**            | `chat_or_main/`    | Chat       | Conversation thread — user messages (`surface-container`, rounded-xl rounded-tl-none) and agent responses with inline code blocks. Message input with glassmorphism textarea and gradient send button.                                                                                              |
| **Code Editor**     | `code_editor/`     | Editor     | Tabbed file editor with syntax highlighting (Catppuccin colors), line numbers gutter, minimap, vim-style status bar (`-- NORMAL --`). File tree in sidebar.                                                                                                                                         |
| **Files Explorer**  | `files_explorer/`  | Files      | File tree with breadcrumb nav, folder expand/collapse, git status badges (M/A/D), drag-and-drop with drop zones, glassmorphism context menu (Rename/Delete/Copy Path/Open in Editor/View Diff).                                                                                                     |
| **Git Diff**        | `git_diff/`        | Diff       | Side-by-side diff viewer with before/after panes. Added lines = green (`rgba(166,227,161,0.15)`), removed = red (`rgba(243,139,168,0.15)`). Action bar with Side-by-side/Unified toggle, hunk navigation, Stage Hunk/Discard buttons. Floating glassmorphism legend. Changed files list in sidebar. |
| **Command Palette** | `command_palette/` | (overlay)  | Centered modal overlay with `backdrop-blur-sm bg-black/40`. Search input with `:open` prefix syntax. Result list with keyboard navigation hints (arrows + Enter). Footer with Navigate/Select help.                                                                                                 |

## Shared Components

These appear identically across all screens:

- **Icon Rail** — Fixed left, `z-50`, always visible
- **Sidebar** — Fixed left (after rail), `z-40`, macOS traffic light dots on Chat screen
- **Top Tab Bar** — `bg-[#121221]/90 backdrop-blur-md`, 4 tabs, active = primary color + bottom border
- **Context Panel** — Fixed right, `z-40`, agent status + model info + recent actions
- **Status Bar** (Editor/Files) — Bottom bar with file info, encoding, language, git branch

## Syntax Highlighting Colors (Editor)

| Token      | Color     | Catppuccin Name |
| ---------- | --------- | --------------- |
| Keywords   | `#cba6f7` | Mauve           |
| Strings    | `#a6e3a1` | Green           |
| Functions  | `#89b4fa` | Blue            |
| Variables  | `#f5e0dc` | Rosewater       |
| Comments   | `#6c7086` | Overlay0        |
| Types      | `#fab387` | Peach           |
| Tags (JSX) | `#f38ba8` | Red             |

## Interaction Patterns

- **Transitions**: 300-400ms ease-in-out for hover states, `active:scale-90/95` for click feedback
- **Hover**: Background shifts to `surface-bright` or `surface-container-highest/50`
- **Focus**: Input fields get `ring-1 ring-primary/40` (ghost ring, not a border)
- **Scrollbars**: Custom — 6px wide, `#333344` thumb, transparent track, `#4a444f` on hover
- **Selection**: `bg-primary-container/30`
