# Design System Specification

## 1. Overview & Creative North Star: "The Obsidian Lens"

This design system is built to transform the sterile developer environment into a sophisticated, editorial workspace. Our Creative North Star is **The Obsidian Lens**—an aesthetic that treats the UI not as a flat grid of boxes, but as a series of illuminated, translucent layers stacked within a deep, nocturnal void.

By leveraging the Catppuccin Mocha palette, we move away from traditional "Dark Mode" (which often feels heavy) toward a "Atmospheric Dark" experience. We break the "template" look by favoring tonal depth over structural lines, utilizing expansive breathing room, and employing high-contrast typography scales that feel more like a premium technical journal than a standard IDE.

---

## 2. Color Theory & Surface Logic

The palette is rooted in deep purples and blues, punctuated by vibrant accents. However, the secret to this system is not the colors themselves, but how they are layered.

### The "No-Line" Rule

**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning. Structural boundaries must be defined solely through background color shifts.

- To separate a sidebar from the main stage, use `surface-container-low` against the `background` (`#121221`).
- To define a code block, use `surface-container-highest` to create a natural "well" for the text to sit in.

### Surface Hierarchy & Nesting

Treat the UI as a physical stack of frosted glass.

- **Level 0 (Base):** `surface` (#121221) — The infinite depth.
- **Level 1 (Navigation/Sidebar):** `surface-container-low` (#1a1a2a) — A subtle lift from the base.
- **Level 2 (Cards/Main Content):** `surface-container` (#1e1e2e) — The active workspace.
- **Level 3 (Popovers/Modals):** `surface-container-highest` (#333344) — The most immediate layer.

### The "Glass & Gradient" Rule

Floating elements (Modals, Tooltips, Active Tab Indicators) must utilize **Glassmorphism**.

- **Fill:** `surface-container-high` at 60%–80% opacity.
- **Backdrop Blur:** 12px to 20px.
- **Gradients:** For primary CTAs, use a linear gradient from `primary` (#e2c7ff) to `primary-container` (#cba6f7) at a 135° angle. This adds "visual soul" and prevents the UI from feeling "flat."

---

## 3. Typography: Editorial Precision

We pair the structural clarity of **Inter** with the geometric elegance of **Manrope** for high-level displays, creating a hierarchy that feels authoritative yet warm.

| Role            | Font Family    | Size     | Intent                                         |
| :-------------- | :------------- | :------- | :--------------------------------------------- |
| **Display-LG**  | Manrope        | 3.5rem   | Hero moments and empty-state headlines.        |
| **Headline-SM** | Manrope        | 1.5rem   | Section headers and primary navigation titles. |
| **Title-MD**    | Inter          | 1.125rem | Modal titles and important card headers.       |
| **Body-MD**     | Inter          | 0.875rem | Standard UI text and descriptions.             |
| **Label-MD**    | JetBrains Mono | 0.75rem  | Code snippets, metadata, and technical labels. |

**The Hierarchy Rule:** Use `on-surface-variant` (#cdc3d1) for body text to reduce eye strain, reserving `on-surface` (#e3e0f7) for titles and active states to create a clear "read-first" path.

---

## 4. Elevation & Depth: Tonal Layering

In this system, depth is a feeling, not a feature. We move away from structural rigidity toward "Ambient Physics."

- **The Layering Principle:** Instead of a shadow, place a `surface-container-lowest` card on a `surface-container-low` section. The subtle contrast (Darker on Dark) creates a "recessed" look that feels premium.
- **Ambient Shadows:** For floating elements (like the Icon Rail or active Modals), use an extra-diffused shadow:
  - _Shadow:_ `0px 10px 40px rgba(0, 0, 0, 0.4)`
- **The "Ghost Border" Fallback:** If accessibility requires a border, use `outline-variant` (#4a444f) at **15% opacity**. It should be felt, not seen.
- **Roundedness Scale:**
  - Windows/Main Panels: `xl` (1.5rem)
  - Cards/Secondary Panels: `lg` (1rem)
  - Buttons/Inputs: `md` (0.75rem)

---

## 5. Components & Primitive Logic

### Buttons & Navigation

- **Primary Button:** Gradient fill (`primary` to `primary-container`), no border, `on-primary` text.
- **Icon Rail:** Circular project icons (radius: `full`). The **Active State** is a pill-shaped "backlight" using `primary-container` at 20% opacity behind the circle.
- **Tabs:** No bottom lines. Active tabs are indicated by a `glassmorphism` pill background and a weight shift in typography.

### Layout: The Multi-Column Architecture

1.  **Icon Rail (Far Left):** Narrow, `surface-container-lowest`. Contains circular project avatars.
2.  **Sidebar (Left):** `surface-container-low`. Collapsible categories using `title-sm` for headers.
3.  **Main Content (Center):** `surface`. The largest area. Uses `xl` rounded corners to create a "window-within-a-window" effect.
4.  **Context Panel (Right):** `surface-container-low`. Displays metadata and progress bars for resource usage.

### Data & Inputs

- **Input Fields:** `surface-container-highest` background. No border. On focus, a 1px "Ghost Border" of `primary` at 40% opacity appears.
- **Progress Bars:** Background is `surface-variant`. Fill is a gradient of `secondary` (#a8c8ff) to `secondary-container` (#124988).
- **Lists:** **Forbidden: Divider Lines.** Use the Spacing Scale (`4` or `1rem`) to separate items. Interaction is shown through a `surface-bright` hover state with a 400ms ease-in-out transition.

---

## 6. Do’s and Don’ts

### Do

- **Do** use `JetBrains Mono` for any data that looks like a value, ID, or file path.
- **Do** use "Negative Space" as a separator. If a layout feels cluttered, increase the padding rather than adding a line.
- **Do** apply `backdrop-blur` to any element that sits "above" the main content.

### Don’t

- **Don't** use pure black (#000000) or pure white (#FFFFFF). Use the provided `surface` and `on-surface` tokens.
- **Don't** use sharp corners. Everything in this system should feel "honed" and "softened" to the touch.
- **Don't** use high-intensity shadows. If the shadow is the first thing a user sees, it is too dark. It should be an ambient "glow" of darkness.
