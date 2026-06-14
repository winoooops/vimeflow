# Design — Single Source of Truth for Frontend

This directory is the authoritative reference for all Vimeflow UI. It is
**code-grounded**: the spec is derived from and kept honest against the shipped
frontend in `src/`.

Start with **`UNIFIED.md`** — it is authoritative and complete. Fall back to
`DESIGN.md` for the foundational philosophy/typography it extends, and to
`src/theme/themes/*.ts` for live token values.

## Contents

### `UNIFIED.md` — authoritative, code-grounded SSoT

The canonical spec, derived from the shipped app (verified against `src/`):
the three-zone shell + two-plane surface model, every main-canvas surface
(terminal/SplitView, dock, editor, diff, browser pane, burner popup), the full
agent-session-state contract (`running` / `awaiting` / `completed` / `errored`
/ `idle`), and the component contracts for everything that ships
(`SessionCard`, `AgentStatusPanel`/`Rail`, `StatusDot`, `SplitView`/
`TerminalPane`, `DockPanel`, `CodeEditor`, `DiffPanelContent`, `CommandPalette`,
`StatusBar`/`ContextSmiley`, `GitRefChip`, `Tooltip`, …), plus an anti-patterns
list. **When any value conflicts with another doc, `UNIFIED.md` wins.**

### `DESIGN.md` — foundation

The design-system philosophy: "The Obsidian Lens", color/surface theory,
typography scale, elevation principles, do's/don'ts. Foundational — `UNIFIED.md`
extends rather than contradicts it. (Its hex tables are the `obsidian-lens`
dark snapshot; see tokens below for the runtime source.)

### `src/theme/themes/*.ts` — runtime token SSoT

The live color/shadow values. The system is **multi-theme** at runtime:
`obsidian-lens` (dark) + `flexoki` (light), applied as CSS variables. This is
the source of truth for any color value.

### `tokens.css` / `tokens.ts` — non-color scales + state contract

Kept for the parts that are _not_ runtime color: the type / radius / motion /
layout-dimension scales, plus the `SessionState` union, `stateToken` visual map,
and `contextSmiley()` breakpoints that `UNIFIED.md` §4/§5 cite. Their color
tables are a historical snapshot — use `src/theme` for color.

### `archive/` — historical handoffs & mockups (reference only)

Every superseded design handoff, migration brief, Stitch `code.html` mockup,
and runnable prototype. They predate/drifted from the shipped app (4/5-zone +
icon rail, pre-#442 tokens, dark-only hex, screens that no longer exist). Their
still-valid contracts have been folded into `UNIFIED.md`. **Do not derive new
work from `archive/`** — see `archive/README.md`. Slated for deletion in a
follow-up.

## How to use

- **Building a component** — read `UNIFIED.md` (§5 contracts), then the live
  component in `src/`. Don't copy from `archive/`.
- **Checking a color** — `src/theme/themes/<theme>.ts` (runtime SSoT), not the
  `DESIGN.md` tables.
- **Layout / surface questions** — `UNIFIED.md` §2 (three zones, two planes).
- **Interaction states** — `UNIFIED.md` §4 (agent states) + §6 (interactions).

## Viewing the runnable prototype

The prototype is hosted in the Claude Design project (not in-repo). With the
`claude-in-chrome` MCP:

1. `mcp__claude-in-chrome__tabs_context_mcp` — confirm the MCP tab group; create a tab on `claude.ai` if none.
2. `mcp__claude-in-chrome__navigate` to the project URL below (you must already be logged into `claude.ai` in that profile — don't sign in programmatically).
3. The prototype renders in an iframe whose `src` is a short-lived signed `*.claudeusercontent.com/...` URL — **don't hardcode it**; start from the project URL and let the page hand you a fresh signed `src`.
4. Read with `get_page_text` / `javascript_tool`; capture with `take_screenshot` / `gif_creator`.

**Project URL:** `https://claude.ai/design/p/e9c4e751-f5ca-40eb-9ce7-611948803ce4`

Treat the prototype as historical/contextual; when it diverges from `UNIFIED.md`, this repo wins.
