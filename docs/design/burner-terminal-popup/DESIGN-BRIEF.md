# Burner Terminal Popup — Design Brief

Design brief for the ephemeral, throwaway per-pane burner terminal popup.

- **Tracking issue:** [VIM-53](https://linear.app/vimeflow/issue/VIM-53/featterminal-ephemeral-per-pane-burner-terminal-popup-ctrl-then) — `feat(terminal): ephemeral per-pane burner terminal popup (Ctrl+: then backtick)`
- **Status:** design pre-requisite — to be mocked before PR 1. UI is **not decided**.
- **Why this exists:** the popup's visuals are undecided; this brief is the handoff prompt for a design pass (hand-built HTML mockup in the Obsidian Lens system, rendered in-browser and iterated), so PR 1 has a real visual contract to build against — the same way the Settings dialog handoff bundle worked.

## How to use

Paste the prompt block below into a Claude Code session that already has this app's context. It is scoped to the popup's UI only; it points at VIM-53 for the full behavioral contract but inlines the behaviors that drive the visuals, so it works even without Linear access.

## Prompt

```
Design task — NOT implementation. Produce a standalone, throwaway HTML/CSS mockup
(drop it in /tmp, open in a browser, iterate) for a new ephemeral "burner" terminal
popup. The full written spec is Linear VIM-53 — read it for the behavioral contract;
this is just the design brief.

WHAT IT IS
A throwaway terminal that opens as a centered popup over the workspace — same overlay
family as the command palette (fixed inset-0, blurred backdrop, centered panel) — so a
user can run ad-hoc commands (npm run dev, file search, npm install) WITHOUT hijacking
the pane's agent PTY and WITHOUT spending one of the ≤4 layout slots.

BEHAVIORS THAT DRIVE THE VISUAL DESIGN (only the parts that surface in UI)
- Lives per pane — up to 4. The popup shows ONE shell at a time: the focused pane's.
  So it needs a header identifying which pane/shell and its cwd.
- Hide ≠ kill: closing the popup only HIDES it; the shell keeps running (npm run dev
  stays alive). So there must be a cue — on the pane and/or icon rail — that a burner
  shell is live-but-hidden.
- cwd starts at the host pane's cwd; `cd` inside stays isolated (does NOT move the pane
  or session). Worth a subtle "this won't change your pane" affordance.
- Toggled by a chord (Ctrl+: then backtick); Esc hides. Show the key hints in a footer
  the way the command palette does.
- Ephemeral — never persisted, gone on restart. A small "burner / throwaway" marker so
  it reads as disposable, not a real session.

DESIGN SYSTEM
Obsidian Lens — Catppuccin Mocha, Manrope/Inter/JetBrains Mono, glassmorphism, NO visible
borders (tonal depth only). Pull values from docs/design/tokens.css / tokens.ts. Match
the existing command-palette component's overlay + entry animation so this feels like its
sibling. docs/design/UNIFIED.md is authoritative for the 5-zone layout it floats over.

OPEN QUESTIONS — make a call, show it, note the tradeoff
1. Size: command-palette-sized card, or a taller centered panel? A terminal wants height
   for npm run dev output — lean larger, but keep it clearly a centered overlay, not a
   docked pane.
2. Per-pane identity: how the header shows e.g. "pane 2 · burner · ~/projects/foo", and
   whether you can glance at / switch between panes' burner shells from inside the popup.
3. Live-but-hidden cue: what the pane (or icon rail) shows when a hidden burner shell is
   still running in the background.

DELIVERABLE
One self-contained HTML file mocking these states:
  (a) fresh/empty popup just opened,
  (b) mid-command — npm run dev streaming output,
  (c) the live-but-hidden indicator on the pane behind it (popup dismissed, shell alive).
Render it, screenshot each state, and iterate with me. Do NOT wire it into the real app —
this is the design pre-req that precedes PR 1 in VIM-53.
```

## Optional anchor (add to the prompt if the session needs pointing)

To anchor it to the right component immediately, append:

```
Anchor to the existing overlay so this reads as a sibling:
- src/features/command-palette/CommandPalette.tsx — overlay shell + entry animation
- src/features/command-palette/chordRegistry.ts + hooks/usePaneRenameChord.ts — the
  Ctrl+: chord shape this invocation mirrors
```
