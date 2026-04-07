# Design System Specification

## 1. Overview & Creative North Star: "The Obsidian Lens"

This design system transforms the sterile developer environment into a sophisticated, editorial workspace. Our Creative North Star is **The Obsidian Lens** — an aesthetic that treats the UI not as a flat grid of boxes, but as a series of illuminated, translucent layers stacked within a deep, nocturnal void.

By leveraging the Catppuccin Mocha palette, we move away from traditional "Dark Mode" (which often feels heavy) toward an "Atmospheric Dark" experience. We break the "template" look by favoring tonal depth over structural lines, utilizing expansive breathing room, and employing high-contrast typography scales that feel more like a premium technical journal than a standard IDE.

**The Obsidian Terminal** is the workspace expression of this system — applying the Obsidian Lens aesthetic to a terminal-first CLI agent management interface. The same depth, glass, and editorial precision, now serving a command-line-native workflow.

---

## 2. Color Theory & Surface Logic

The palette is rooted in deep purples and blues, punctuated by vibrant accents. The secret to this system is not the colors themselves, but how they are layered.

### The "No-Line" Rule

**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning. Structural boundaries must be defined solely through background color shifts.

- To separate a sidebar from the main stage, use `surface-container-low` against the `background` (`#121221`).
- To define a code block, use `surface-container-highest` to create a natural "well" for the text to sit in.
- **Ghost border fallback:** If accessibility requires a border, use `outline-variant` (#4a444f) at **15% opacity**. It should be felt, not seen.

### Surface Hierarchy & Nesting

Treat the UI as a physical stack of frosted glass.

- **Level 0 (Base):** `surface` (#121221) — The infinite depth. Terminal zone background.
- **Level 0.5 (Recessed):** `surface-container-lowest` (#0d0d1c) — Deepest recessed areas, terminal tab bar.
- **Level 1 (Navigation):** `surface-container-low` (#1a1a2a) — Sidebar, icon rail, agent activity panel.
- **Level 2 (Content):** `surface-container` (#1e1e2e) — Cards, active workspace areas.
- **Level 2.5 (Elevated):** `surface-container-high` (#292839) — Elevated cards, glassmorphism fills, active session highlight.
- **Level 3 (Immediate):** `surface-container-highest` (#333344) — Popovers, modals, inputs.
- **Hover state:** `surface-bright` (#383849) — Interactive element hover.

### The "Glass & Gradient" Rule

Floating elements (Modals, Tooltips, Command Palette) must utilize **Glassmorphism**.

- **Fill:** `surface-container-high` at 60%–80% opacity.
- **Backdrop Blur:** 12px to 20px.
- **Backdrop Saturation:** 150% to ensure depth feels rich, not washed out.
- **Gradients:** For primary CTAs, use a linear gradient from `primary` (#e2c7ff) to `primary-container` (#cba6f7) at a 135deg angle.

### Extended Color Tokens

Beyond the core surface hierarchy, the system includes these semantic tokens:

| Token | Hex | Usage |
|-------|-----|-------|
| `surface-tint` | `#e2c7ff` | Tinted overlays and focus rings |
| `primary-dim` | `#d3b9f0` | Subdued icon states, inactive accents |
| `secondary-dim` | `#c39eee` | Dimmed accent states |
| `tertiary` | `#ff94a5` | Warning accents, attention states |
| `tertiary-container` | `#fd7e94` | Warning badge backgrounds |
| `error-dim` | `#d73357` | Error backgrounds, dimmed error |
| `success` | `#50fa7b` | Agent running status, live indicators |
| `success-muted` | `#7defa1` | Diff added lines, softer success text |

### Complete Token Reference

#### Core Surface Hierarchy

| Token                       | Hex       | Usage                                          |
| --------------------------- | --------- | ---------------------------------------------- |
| `surface` / `background`    | `#121221` | Level 0 — base, infinite depth                 |
| `surface-container-lowest`  | `#0d0d1c` | Deepest recessed areas                         |
| `surface-container-low`     | `#1a1a2a` | Level 1 — sidebar, icon rail, activity panel   |
| `surface-container`         | `#1e1e2e` | Level 2 — cards, main content areas            |
| `surface-container-high`    | `#292839` | Elevated cards, glassmorphism fills            |
| `surface-container-highest` | `#333344` | Level 3 — popovers, modals, inputs             |
| `surface-bright`            | `#383849` | Hover states                                   |
| `surface-tint`              | `#e2c7ff` | Tinted overlays and focus rings                |

#### Primary & Secondary

| Token                       | Hex       | Usage                                          |
| --------------------------- | --------- | ---------------------------------------------- |
| `primary`                   | `#e2c7ff` | Primary text accent                            |
| `primary-container`         | `#cba6f7` | Active indicators, CTA gradients, brand        |
| `primary-dim`               | `#d3b9f0` | Subdued icon states, inactive accents          |
| `secondary`                 | `#a8c8ff` | Info accents, progress bars, status            |
| `secondary-container`       | `#57377f` | Contained accent backgrounds                   |
| `secondary-dim`             | `#c39eee` | Dimmed accent states                           |

#### Semantic & Feedback

| Token                       | Hex       | Usage                                          |
| --------------------------- | --------- | ---------------------------------------------- |
| `tertiary`                  | `#ff94a5` | Warning accents, attention states              |
| `tertiary-container`        | `#fd7e94` | Warning badge backgrounds                      |
| `error`                     | `#ffb4ab` | Error states, destructive actions              |
| `error-dim`                 | `#d73357` | Error backgrounds, dimmed error indicators     |
| `success`                   | `#50fa7b` | Agent running status, live indicators          |
| `success-muted`             | `#7defa1` | Diff added lines, softer success text          |

#### Text & Borders

| Token                       | Hex       | Usage                                          |
| --------------------------- | --------- | ---------------------------------------------- |
| `on-surface`                | `#e3e0f7` | Titles, active text                            |
| `on-surface-variant`        | `#cdc3d1` | Body text, secondary text (reduced eye strain) |
| `outline-variant`           | `#4a444f` | Ghost borders (15% opacity only)               |

---

## 3. Typography: Editorial Precision

We pair the structural clarity of **Inter** with the geometric elegance of **Manrope** for high-level displays, creating a hierarchy that feels authoritative yet warm. **JetBrains Mono** creates a clear mental shift between "The System" (Inter/Manrope) and "The Work" (terminal/code).

| Role            | Font Family    | Size     | Color              | Intent                                        |
| :-------------- | :------------- | :------- | :----------------- | :-------------------------------------------- |
| **Display-LG**  | Manrope 700/800 | 3.5rem  | `on-surface`       | Hero moments and empty-state headlines        |
| **Headline-SM** | Manrope 700    | 1.5rem   | `on-surface`       | Section headers and panel titles              |
| **Title-MD**    | Inter 500/600  | 1.125rem | `on-surface`       | Modal titles and card headers                 |
| **Body-MD**     | Inter 400      | 0.875rem | `on-surface-variant` | Standard UI text and descriptions           |
| **Label-MD**    | JetBrains Mono 400 | 0.75rem | `on-surface-variant` | Code, metadata, technical labels, terminal |

**The Hierarchy Rule:** Use `on-surface-variant` (#cdc3d1) for body text to reduce eye strain, reserving `on-surface` (#e3e0f7) for titles and active states.

---

## 4. Elevation & Depth: Tonal Layering

In this system, depth is a feeling, not a feature. "Up" is "Brighter," not "Shadowier."

- **The Layering Principle:** Instead of a shadow, place a `surface-container-lowest` card on a `surface-container-low` section. The subtle contrast creates a "recessed" premium look.
- **Ambient Shadows:** For floating elements, use an extra-diffused shadow: `0px 10px 40px rgba(0, 0, 0, 0.4)`. If the shadow is the first thing you see, it's too dark.
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
- **Icon Rail:** Project avatars (2-letter abbreviation, rounded-lg). Active = pill-shaped backlight using `primary-container` at 20% opacity.
- **Tabs:** Active indicated by `border-b-2 border-primary` and weight shift. No full-width bottom lines.

### Layout: The 4-Zone Architecture

1. **Icon Rail (Far Left, 48px):** `surface-container-low/80` + `backdrop-blur-xl`. Project avatars top, `+` and `⚙` bottom.
2. **Sidebar (Left, 260px):** `surface-container-low`. Top: agent session list. Bottom: context switcher (Files/Editor/Diff) with content panel.
3. **Terminal Zone (Center, flexible):** `surface`. Tabbed terminal panes. One agent PTY + optional shell tabs.
4. **Agent Activity (Right, 280px):** `surface-container-low`. Pinned status/context/usage. Collapsible sections for files, tools, tests, usage details.

### Session List Items

- **Active:** `surface-container-high` background, left `2px border-primary` accent, `on-surface` bold name, `success` status dot with `animate-pulse`.
- **Inactive:** Transparent background, `on-surface-variant` name, status in `secondary` (paused) or `on-surface-variant` (completed).

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

When a modal or "Lens" view is triggered (Command Palette, full-width editor overlay), the background workspace blurs (`12px`) and shifts slightly toward the `primary-container` hue. This reinforces the "Obsidian Lens" metaphor.

### Status Indicators

Agent session status uses animated indicators:
- **Running:** `success` (#50fa7b) dot with `animate-pulse` and `shadow-[0_0_8px]` glow.
- **Paused:** `secondary` (#a8c8ff) static dot.
- **Completed:** `on-surface-variant` (#cdc3d1) hollow circle.
- **Errored:** `error` (#ffb4ab) static dot.

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

## 9. Design Resources

**Google AI Studio project** — contains the original Stitch-generated HTML/CSS source for all screens:
https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true

**Stitch MCP Server** — use to generate and iterate on UI components that match this design system:

```bash
# Add the Stitch MCP server (requires STITCH_API_KEY in .env)
claude mcp add stitch https://stitch.googleapis.com/mcp \
  --transport http \
  --scope project \
  --header "X-Goog-Api-Key: \${STITCH_API_KEY}"
```

When building frontend features, agents should:

1. Reference the Google AI Studio project and screen specs in `docs/design/` for the target layout
2. Use the Stitch MCP server to generate components that match the design system
3. Verify output against this document's rules (no-line, glassmorphism, token colors, etc.)

---

## 10. Critical Design Rules (Quick Reference)

1. **No-Line Rule** — No 1px solid borders for sectioning. Background color shifts only.
2. **Glass & Gradient** — Glassmorphism on floating elements. CTA gradients at 135deg.
3. **No Pure Black/White** — Never use `#000000` or `#FFFFFF`. Token system only.
4. **No Sharp Corners** — Windows: `xl`, cards: `lg`, buttons: `md`, badges: `full`.
5. **No Divider Lines** — Spacing separates, not borders or `<hr>`.
6. **Ambient Shadows** — Extra-diffused: `0px 10px 40px rgba(0,0,0,0.4)`.
7. **Negative Space** — If cluttered, increase padding, not lines.
