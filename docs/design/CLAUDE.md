# Design — Single Source of Truth for Frontend

This directory is the authoritative reference for all Vimeflow UI implementation. Every screen, component, color, and interaction pattern defined here must be followed exactly.

Start with the root `DESIGN.md` for the overview. Come here for the full specs and reference implementations.

## Contents

### `DESIGN.md`

Complete design system specification: color theory, surface hierarchy, typography scale, elevation principles, component primitives, layout rules, and explicit do's/don'ts.

### Screen References

Each subdirectory contains a reference screenshot and the HTML implementation produced by Google Stitch:

| Directory          | Screen          | What It Shows                                                                                                                                        |
| ------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_or_main/`    | Chat / Main     | Conversation thread with user and agent messages, inline code blocks, status badges, message input with glassmorphism, sub-thread UI in sidebar      |
| `code_editor/`     | Code Editor     | Tabbed file editor, syntax-highlighted code, line number gutter, minimap, vim status bar, file tree in sidebar                                       |
| `files_explorer/`  | Files Explorer  | File tree with breadcrumbs, folder expand/collapse, git status badges (M/A/D), drag-and-drop with drop zones, glassmorphism context menu             |
| `git_diff/`        | Git Diff Viewer | Side-by-side diff with added/removed highlighting, hunk navigation, Stage Hunk/Discard actions, changed files sidebar, floating glassmorphism legend |
| `command_palette/` | Command Palette | Centered overlay modal, search with `:command` syntax, filtered result list, keyboard navigation hints                                               |

### File Structure Per Screen

```
<screen>/
├── screen.png   # Visual reference — what it should look like
└── code.html    # Full HTML+Tailwind implementation from Stitch
```

The `code.html` files contain the complete Tailwind config with all color tokens, font families, and border radius values. They are the implementation reference for exact class names, spacing, and component structure.

## How to Use These References

1. **Building a new component** — Find the screen that contains it, open `code.html`, extract the relevant HTML/Tailwind classes
2. **Checking a color value** — The Tailwind config in any `code.html` has the full token-to-hex mapping
3. **Verifying layout** — Compare your implementation against `screen.png`
4. **Understanding interaction states** — The HTML shows hover, active, focus, and disabled states inline

## Shared Components Across Screens

These components appear in every screen with identical structure:

- **Icon Rail** (48px, far left) — Brand logo, project icons, user avatar
- **Sidebar** (260px) — Conversation categories, search, settings
- **Top Tab Bar** (full width) — Chat / Files / Editor / Diff tabs
- **Context Panel** (280px, right) — Agent status, model info, recent actions
- **Status Bar** (Editor/Files screens) — File info, encoding, language, git branch

Extract these once as shared React components. The HTML in each screen shows them in context but they are identical across screens.

## Additional Material

Online design exploration: https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true
