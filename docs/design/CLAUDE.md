# Design — Single Source of Truth for Frontend

This directory is the authoritative reference for all Vimeflow UI implementation. Every screen, component, color, and interaction pattern defined here must be followed exactly.

Start with the root `DESIGN.md` for the overview. Come here for the full specs and reference implementations.

## Contents

### `DESIGN.md`

Complete design system specification: color theory, surface hierarchy, typography scale, elevation principles, component primitives, layout rules, and explicit do's/don'ts. This is the unified design language — all screens follow it.

### Screen References

Each subdirectory contains a reference screenshot and the HTML implementation produced by Google Stitch:

| Directory          | Screen             | What It Shows                                                                                                                                                          |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_workspace/` | Agent Workspace    | Primary application view — terminal pane with agent output, session list in sidebar, context switcher (Files/Editor/Diff), agent activity panel with status and usage   |
| `code_editor/`     | Code Editor        | Tabbed file editor, syntax-highlighted code, line number gutter, minimap, vim status bar, file tree in sidebar                                                         |
| `files_explorer/`  | Files Explorer     | File tree with breadcrumbs, folder expand/collapse, git status badges (M/A/D), drag-and-drop with drop zones, glassmorphism context menu                               |
| `git_diff/`        | Git Diff Viewer    | Side-by-side diff with added/removed highlighting, hunk navigation, Stage Hunk/Discard actions, changed files sidebar, floating glassmorphism legend                   |
| `command_palette/` | Command Palette    | Centered overlay modal, search with `:command` syntax, filtered result list, keyboard navigation hints                                                                  |

**Deprecated**: `chat_or_main/` — Chat view replaced by terminal-based agent interaction (see `agent_workspace/`). Kept for historical reference only.

### File Structure Per Screen

```
<screen>/
├── screen.png   # Visual reference — what it should look like
├── code.html    # Full HTML+Tailwind implementation from Stitch
└── DESIGN.md    # Screen-specific design notes (if applicable)
```

The `code.html` files contain the complete Tailwind config with all color tokens, font families, and border radius values. They are the implementation reference for exact class names, spacing, and component structure.

**Important:** The `agent_workspace/code.html` Tailwind config has Stitch-generated color tokens that diverge from the authoritative palette in root `DESIGN.md` and `docs/design/DESIGN.md`. When tokens conflict, the root `DESIGN.md` is authoritative. See the reconciliation notes in `agent_workspace/DESIGN.md`.

## How to Use These References

1. **Building a new component** — Find the screen that contains it, open `code.html`, extract the relevant HTML/Tailwind classes
2. **Checking a color value** — Use root `DESIGN.md` as the authoritative token source. Screen `code.html` files may have Stitch variants.
3. **Verifying layout** — Compare your implementation against `screen.png`
4. **Understanding interaction states** — The HTML shows hover, active, focus, and disabled states inline

## Shared Components Across Screens

These components appear across screens with consistent structure:

- **Icon Rail** (48px, far left) — Project avatars, `+` new project, `⚙` settings
- **Sidebar** (260px) — Agent session list (top), context switcher tabs with content (bottom)
- **Terminal Tab Bar** (terminal zone top) — Agent and shell tabs
- **Agent Activity Panel** (280px, right) — Status, context window, usage, collapsible sections
- **Command Palette** (overlay) — `:` trigger, Lens Blur background

Extract these once as shared React components. The HTML in each screen shows them in context.

## Additional Material

Online design exploration: https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true
