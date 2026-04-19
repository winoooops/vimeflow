# Design — Single Source of Truth for Frontend

This directory is the authoritative reference for all Vimeflow UI implementation. Every screen, component, color, and interaction pattern defined here must be followed exactly.

Start with `UNIFIED.md` — it's authoritative and resolves Stitch drift. Fall back to `DESIGN.md` for the foundational token/typography tables it extends.

## Contents

### `UNIFIED.md` — authoritative

Canonical spec layered on top of `DESIGN.md`. Defines the 5-zone layout (icon rail · sidebar · view tabs · main canvas · activity panel · status bar), the full agent-session-state contract (`running` / `awaiting` / `completed` / `errored` / `idle`), TypeScript component APIs (`SessionCard`, `StatusDot`, `ActivityPanel`, `CommandPalette`, `ContextSmiley`), and an anti-patterns list. When any value conflicts with Stitch `code.html` files, UNIFIED wins.

### `tokens.css` / `tokens.ts`

Copy-pasteable token values. Same data in two formats: CSS custom properties for stylesheets, typed TS export (with `stateToken` map and `contextSmiley()` helper) for programmatic use. Keep them in sync when evolving.

### `DESIGN.md`

Complete design system specification: color theory, surface hierarchy, typography scale, elevation principles, component primitives, layout rules, and explicit do's/don'ts. Foundational — `UNIFIED.md` extends rather than contradicts it.

### Screen References — Stitch (illustrative, superseded)

> **STATUS:** The Stitch-generated screens below are kept as visual references only. The single source of truth is the **Claude Design** project, exported into this repo as `UNIFIED.md` + `tokens.css` + `tokens.ts`. Each `code.html` now carries a banner saying the same thing. When a Stitch screen disagrees with `UNIFIED.md` — on layout, tokens, state visuals, or anything else — **UNIFIED wins, always**. Don't use them to derive new components; use them only to cross-check visual intent.

Each subdirectory contains a reference screenshot and the HTML implementation produced by Google Stitch:

| Directory          | Screen          | What It Shows                                                                                                                                                         |
| ------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_workspace/` | Agent Workspace | Primary application view — terminal pane with agent output, session list in sidebar, context switcher (Files/Editor/Diff), agent activity panel with status and usage |
| `code_editor/`     | Code Editor     | Tabbed file editor, syntax-highlighted code, line number gutter, minimap, vim status bar, file tree in sidebar                                                        |
| `files_explorer/`  | Files Explorer  | File tree with breadcrumbs, folder expand/collapse, git status badges (M/A/D), drag-and-drop with drop zones, glassmorphism context menu                              |
| `git_diff/`        | Git Diff Viewer | Side-by-side diff with added/removed highlighting, hunk navigation, Stage Hunk/Discard actions, changed files sidebar, floating glassmorphism legend                  |
| `command_palette/` | Command Palette | Centered overlay modal, search with `:command` syntax, filtered result list, keyboard navigation hints                                                                |

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

## Viewing the Runnable Prototype (Claude Design)

`UNIFIED.md` §9 calls out a runnable prototype — streaming terminal, state transitions, command palette, all five zones wired together. It lives in the **Claude Design** project, not this repo. We don't mirror it locally (would drag in HTML, JS, and asset files that drift from the spec the moment it's re-generated). View it via `claude-in-chrome` CDP instead.

**Project URL:** `https://claude.ai/design/p/e9c4e751-f5ca-40eb-9ce7-611948803ce4`

**Recipe for an agent with the `claude-in-chrome` MCP available:**

1. `mcp__claude-in-chrome__tabs_context_mcp` — confirms the MCP tab group exists. If no tab is open on `claude.ai`, create one with `tabs_create_mcp`.
2. `mcp__claude-in-chrome__navigate` to the project URL above. The user must already be logged into `claude.ai` in that browser profile; the session cookie carries auth — don't attempt to sign in programmatically.
3. Inside the page, the prototype renders in an iframe whose `src` is a signed `*.claudeusercontent.com/v1/design/projects/<id>/serve/Vimeflow.html?t=<token>` URL. The token is short-lived, so **don't hardcode it** — always start from the `claude.ai` project URL and let the page hand you a fresh signed iframe `src`.
4. To read rendered text: `get_page_text` on the tab, or `javascript_tool` to pull the iframe's `src` then `navigate` that URL to inspect raw HTML.
5. To capture visuals for spec comparison: `take_screenshot` (or `gif_creator` for interaction sequences).

**Other files in the Claude Design project:** `Handoff.html` (the merge guide — already consumed into this repo) and `tokens.ts` (empty placeholder; real content lives in `docs/design/tokens.ts`).

## Additional Material

Online design exploration: https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true
