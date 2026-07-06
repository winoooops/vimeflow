# Design System Specification

## 1. Overview & Creative North Star: "The Lens"

This design system transforms the sterile developer environment into a sophisticated, editorial workspace. Our Creative North Star is **The Lens** — an aesthetic that treats the UI not as a flat grid of boxes, but as a series of illuminated, translucent layers stacked within a deep, nocturnal void.

The Lens ships multiple runtime themes (§9). The default, **Catppuccin** (dark), leverages the Catppuccin Mocha palette to move away from traditional "Dark Mode" (which often feels heavy) toward an "Atmospheric Dark" experience; **Flexoki** provides the light baseline, with Gruvbox Dark/Light, Tokyo Night, and Dracula also available. We break the "template" look by favoring tonal depth over structural lines, utilizing expansive breathing room, and employing high-contrast typography scales that feel more like a premium technical journal than a standard IDE.

The **workspace expression** of this system applies The Lens aesthetic to a terminal-first CLI agent management interface — the same depth, glass, and editorial precision, now serving a command-line-native workflow.

---

## 2. Color Theory & Surface Logic

The palette is rooted in deep purples and blues, punctuated by vibrant accents. The secret to this system is not the colors themselves, but how they are layered.

### The "No-Line" Rule

**Tonal-first.** Structural boundaries come from background color shifts, not 1px solid divider lines. Never draw a line to section content _within_ a single surface.

- To separate the sidebar (chrome) from the main canvas, use `surface-container-low` against `surface` — a tonal step, plus the canvas's rounded-left corner.
- To define a code block / well, drop to a lower `surface-container-*` step for the text to sit in.
- **Co-planar seam exception (sanctioned):** where two zones intentionally share _one_ surface and still need a divider — the canvas ↔ right-activity-panel seam, and the top-chrome / status-bar edges — use a **1px `outline-variant` hairline at ~20–25% alpha**. It is the same "felt, not seen" ghost border applied to a _seam_ rather than a _section_, and it is the only sanctioned line. (See `UNIFIED.md` §2.1.)

### Surface Hierarchy & Nesting

Treat the UI as a physical stack of frosted glass. Values below are the **Catppuccin** dark snapshot (`obsidian-lens.ts`); the runtime SSoT for all shipped themes is `src/theme/themes/*.ts`. See `UNIFIED.md` §2.1 for how these levels map onto the two-plane shell.

- **Level 0 — Canvas:** `surface` (#121221) — the work plane: main canvas, terminal/SplitView, dock, the 44px top-chrome banner, the 24px status bar, **and** the right activity panel (all co-planar).
- **Level 1 — Chrome:** `surface-container-low` (#1a1a2a) — the distinct-chrome plane: the left sidebar + the backdrop. One step off the canvas (lighter in dark, darker in light).
- **Level 0.5 (Recessed):** `surface-container-lowest` (#0d0d1c) — deepest recessed wells (terminal pane footer, dock-tab strip).
- **Level 2 (Content):** `surface-container` (#1e1e2e) — cards on either plane.
- **Level 2.5 (Elevated):** `surface-container-high` (#292839) — elevated cards, glassmorphism fills, active-session highlight.
- **Level 3 (Immediate):** `surface-container-highest` (#333344) — popovers, modals, inputs.
- **Hover state:** `surface-bright` (#383849) — interactive element hover.

### The "Glass & Gradient" Rule

Floating elements (Modals, Tooltips, Command Palette) must utilize **Glassmorphism**.

- **Fill:** `surface-container-high` at 60%–80% opacity.
- **Backdrop Blur:** 12px to 20px.
- **Backdrop Saturation:** 150% to ensure depth feels rich, not washed out.
- **Gradients:** For primary CTAs, use a linear gradient from `primary` (#e2c7ff) to `primary-container` (#cba6f7) at a 135deg angle.

### Extended Color Tokens

Beyond the core surface hierarchy, the system includes these semantic tokens:

| Token                | Hex       | Usage                                 |
| -------------------- | --------- | ------------------------------------- |
| `surface-tint`       | `#e2c7ff` | Tinted overlays and focus rings       |
| `primary-dim`        | `#d3b9f0` | Subdued icon states, inactive accents |
| `secondary-dim`      | `#c39eee` | Dimmed accent states                  |
| `tertiary`           | `#ff94a5` | Warning accents, attention states     |
| `tertiary-container` | `#fd7e94` | Warning badge backgrounds             |
| `error-dim`          | `#d73357` | Error backgrounds, dimmed error       |
| `success`            | `#50fa7b` | Agent running status, live indicators |
| `success-muted`      | `#7defa1` | Diff added lines, softer success text |

### Complete Token Reference

#### Core Surface Hierarchy

| Token                       | Hex       | Usage                                                    |
| --------------------------- | --------- | -------------------------------------------------------- |
| `surface` / `background`    | `#121221` | Level 0 — base, infinite depth                           |
| `surface-container-lowest`  | `#0d0d1c` | Deepest recessed areas                                   |
| `surface-container-low`     | `#1a1a2a` | Level 1 — left sidebar + grid backdrop (distinct chrome) |
| `surface-container`         | `#1e1e2e` | Level 2 — cards, main content areas                      |
| `surface-container-high`    | `#292839` | Elevated cards, glassmorphism fills                      |
| `surface-container-highest` | `#333344` | Level 3 — popovers, modals, inputs                       |
| `surface-bright`            | `#383849` | Hover states                                             |
| `surface-tint`              | `#e2c7ff` | Tinted overlays and focus rings                          |

#### Primary & Secondary

| Token                 | Hex       | Usage                                   |
| --------------------- | --------- | --------------------------------------- |
| `primary`             | `#e2c7ff` | Primary text accent                     |
| `primary-container`   | `#cba6f7` | Active indicators, CTA gradients, brand |
| `primary-dim`         | `#d3b9f0` | Subdued icon states, inactive accents   |
| `secondary`           | `#a8c8ff` | Info accents, progress bars, status     |
| `secondary-container` | `#57377f` | Contained accent backgrounds            |
| `secondary-dim`       | `#c39eee` | Dimmed accent states                    |

#### Semantic & Feedback

| Token                | Hex       | Usage                                      |
| -------------------- | --------- | ------------------------------------------ |
| `tertiary`           | `#ff94a5` | Warning accents, attention states          |
| `tertiary-container` | `#fd7e94` | Warning badge backgrounds                  |
| `error`              | `#ffb4ab` | Error states, destructive actions          |
| `error-dim`          | `#d73357` | Error backgrounds, dimmed error indicators |
| `success`            | `#50fa7b` | Agent running status, live indicators      |
| `success-muted`      | `#7defa1` | Diff added lines, softer success text      |

#### Text & Borders

| Token                | Hex       | Usage                                                                   |
| -------------------- | --------- | ----------------------------------------------------------------------- |
| `on-surface`         | `#e3e0f7` | Titles, active text                                                     |
| `on-surface-variant` | `#cdc3d1` | Body text, secondary text (reduced eye strain)                          |
| `outline-variant`    | `#4a444f` | Ghost hairline; ~15–25% alpha (incl. the sanctioned co-planar seam, §2) |

---

## 3. Typography: Editorial Precision

We pair the structural clarity of **Inter** with the geometric elegance of **Manrope** for high-level displays, creating a hierarchy that feels authoritative yet warm. **JetBrains Mono** creates a clear mental shift between "The System" (Inter/Manrope) and "The Work" (terminal/code).

| Role            | Font Family        | Size     | Color                | Intent                                     |
| :-------------- | :----------------- | :------- | :------------------- | :----------------------------------------- |
| **Display-LG**  | Manrope 700/800    | 3.5rem   | `on-surface`         | Hero moments and empty-state headlines     |
| **Headline-SM** | Manrope 700        | 1.5rem   | `on-surface`         | Section headers and panel titles           |
| **Title-MD**    | Inter 500/600      | 1.125rem | `on-surface`         | Modal titles and card headers              |
| **Body-MD**     | Inter 400          | 0.875rem | `on-surface-variant` | Standard UI text and descriptions          |
| **Label-MD**    | JetBrains Mono 400 | 0.75rem  | `on-surface-variant` | Code, metadata, technical labels, terminal |

**The Hierarchy Rule:** Use `on-surface-variant` (#cdc3d1) for body text to reduce eye strain, reserving `on-surface` (#e3e0f7) for titles and active states.

---

## 4. Elevation & Depth: Tonal Layering

In this system, depth is a feeling, not a feature. "Up" is "Brighter," not "Shadowier."

- **The Layering Principle:** Instead of a shadow, place a `surface-container-lowest` card on a `surface-container-low` section. The subtle contrast creates a "recessed" premium look.
- **Ambient Shadows:** For _overlay_ floating elements (command palette, burner popup, tooltips, modals), use an extra-diffused shadow: `0px 10px 40px rgba(0, 0, 0, 0.4)` + glass. If the shadow is the first thing you see, it's too dark. The **main canvas uses no shadow** — it "floats" over the sidebar via the tonal step + its rounded-left corner alone (see `UNIFIED.md` §2.1).
- **Roundedness Scale:**
  - Windows/Main Panels: `xl` (1.5rem)
  - Cards/Secondary Panels: `lg` (1rem)
  - Buttons/Inputs: `md` (0.75rem)
  - Status badges/Chips: `full` (pill)

---

## 5. Components & Primitive Logic

### Buttons & Navigation

- **Primary Button:** Gradient fill (`primary` to `primary-container`), no border, `on-primary` text.
- **Secondary Button:** `surface-container-highest` background, no border, `primary` text.
- **Tertiary Button:** Transparent, underline on hover only.
- **Tabs:** Active indicated by `border-b-2 border-primary` and weight shift. No full-width bottom lines.

### Layout: Current Workspace Shell

The shell is **three zones** — no icon rail (removed in VIM-76). See `UNIFIED.md` §2 for the canonical layout.

1. **Left Sidebar (272px, resizable, collapsible):** `surface-container-low` (chrome). Sessions + Files tabs; file tree follows the active pane cwd.
2. **Main Canvas (center, flex):** `surface` (canvas). A 44px top-chrome (layout pills), the `SplitView` terminal canvas (`single`/`vsplit`/`hsplit`/`threeRight`/`quad`), and the dockable `DockPanel` (Editor / Diff). Rounded-left corners.
3. **Right Activity Panel (280px ↔ 44px rail, collapsible):** `surface` (canvas, co-planar). Pinned status/context/cache + collapsible tools/files/tests/activity, scoped to the active pane's PTY.
4. **Status Bar (bottom, 24px):** `surface` (canvas), inside the main column. Global readouts + the palette / dock action buttons.

### Session List Items

- **Active:** `surface-container-high` background, left `2px border-primary` accent, `on-surface` bold name, `success` status dot with `animate-pulse`.
- **Inactive:** Transparent background, `on-surface-variant` name; status shown as a text label + tone per the five-state contract (`completed` / `errored` / `idle`) — see `UNIFIED.md` §4. (No `paused` state exists.)

### Agent Activity Sections

- **Collapsible headers:** Chevron icon (`keyboard_arrow_down`/`keyboard_arrow_right`), `headline` font at `xs`, count badge with `primary-container/20` background.
- **File items:** Mono font, `+` prefix in `success`/`success-muted`, `~` in `secondary`, `-` in `error`. Line diff summary on hover.

### Terminal

- **Prompt:** `success-muted` (#7defa1) for path, `on-surface-variant` for directory, `secondary` for git branch.
- **Output:** `on-surface-variant` for standard output, `primary-container` for agent structured output.
- **Cursor:** `primary-container` (#cba6f7) solid block, `opacity-80`.
- **Inline code blocks:** `surface-container-low/50` background, `xl` rounded corners.

### Data & Inputs

- **Input Fields:** `surface-container-highest` background. No border. On focus, ghost ring: `ring-1 ring-primary/40`.
- **Progress Bars:** 3px height. Track: `surface-container`. Fill: gradient `primary` to `primary-container`.
- **Lists:** **Forbidden: Divider Lines.** Use spacing (`1rem`) to separate items. Hover: `surface-bright` with 300ms transition.

---

## 6. Do's and Don'ts

### Do

- **Do** use `JetBrains Mono` for any value, ID, file path, or terminal content.
- **Do** use "Negative Space" as a separator. If cluttered, increase padding, not lines.
- **Do** apply `backdrop-blur` to any element above the main content.
- **Do** use asymmetrical margins in documentation views for editorial feel.
- **Do** use `primary-dim` for icons to prevent overpowering text.

### Don't

- **Don't** use pure black (#000000) or pure white (#FFFFFF). Use `surface` and `on-surface` tokens.
- **Don't** use sharp corners. Everything is "honed" and "softened."
- **Don't** use high-intensity shadows. Shadows should be ambient glows.
- **Don't** use 1px borders for sectioning. Use color shifts.
- **Don't** use standard "Material" shadows. Higher = lighter shade, not darker shadow.

---

## 7. Signature Interactions

### The Lens Blur

When a modal or "Lens" view is triggered (Command Palette, full-width editor overlay), the background workspace blurs (`12px`) and shifts slightly toward the `primary-container` hue. This reinforces The Lens metaphor.

### Status Indicators

Agent session status uses the five-state `StatusDot` contract (`running` / `awaiting` / `completed` / `errored` / `idle`). **`UNIFIED.md` §4 is authoritative** — it carries the canonical `tokens.ts::stateToken` intent and the note on where the shipped component currently diverges (solid fills, glow only on `running`, uniform pulse).

### Context Window Smiley

The context window indicator uses emoji that degrades as context fills:

- 😊 Fresh (<50%)
- 😐 Moderate (50-75%)
- 😟 High (75-90%)
- 🥵 Critical (>90%)

### Interaction Patterns

- **Transitions**: 300-400ms ease-in-out for hover states, `active:scale-90/95` for click feedback
- **Hover**: Background shifts to `surface-bright` or `surface-container-highest/50`
- **Focus**: Input fields get `ring-1 ring-primary/40` (ghost ring, not a border)
- **Scrollbars**: Custom — 6px wide, `#333344` thumb, transparent track, `#4a444f` on hover
- **Selection**: `bg-primary-container/30`

---

## 8. Syntax Highlighting Colors (Editor)

| Token      | Color     | Catppuccin Name |
| ---------- | --------- | --------------- |
| Keywords   | `#cba6f7` | Mauve           |
| Strings    | `#a6e3a1` | Green           |
| Functions  | `#89b4fa` | Blue            |
| Variables  | `#f5e0dc` | Rosewater       |
| Comments   | `#6c7086` | Overlay0        |
| Types      | `#fab387` | Peach           |
| Tags (JSX) | `#f38ba8` | Red             |

---

## 9. Themes & Design Resources

**Themes.** The Lens ships six runtime themes (`src/theme/themes/*.ts`), all exposing identical token keys so `bg-surface` etc. resolve per active theme:

- **Catppuccin** (dark, default) — file/id `obsidian-lens` (legacy slug), `label: 'Catppuccin'`. Atmospheric dark on the Catppuccin Mocha palette; the hex tables above are its snapshot.
- **Flexoki** (light baseline), **Gruvbox Dark**, **Gruvbox Light**, **Tokyo Night**, and **Dracula**.

Color SSoT is `src/theme/themes/*.ts` — see `UNIFIED.md` §9 for the runtime mechanism.

**Historical — Google Stitch (first draft).** The original screen mockups were generated with Google Stitch (Google AI Studio) as a first draft. They are superseded and now live in `docs/design/archive/` for visual archaeology only. **Do not generate new UI from Stitch** — current work derives from `UNIFIED.md` §5 + the live components in `src/`.

---

## 10. Critical Design Rules (Quick Reference)

1. **No-Line Rule** — Tonal shifts section content; the only sanctioned line is a 1px `outline-variant` ghost hairline on a _co-planar seam_ (see §2).
2. **Glass & Gradient** — Glassmorphism on floating elements. CTA gradients at 135deg.
3. **No Pure Black/White** — Never use `#000000` or `#FFFFFF`. Token system only.
4. **No Sharp Corners** — Windows: `xl`, cards: `lg`, buttons: `md`, badges: `full`.
5. **No Divider Lines for content** — Spacing separates list items, not borders or `<hr>` (the co-planar seam hairline is the one exception).
6. **Ambient Shadows** — Extra-diffused: `0px 10px 40px rgba(0,0,0,0.4)`.
7. **Negative Space** — If cluttered, increase padding, not lines.
