# Implementation prompt — Burner Terminal Popup (VIM-53)

Paste the block below into a Claude Code session that has this app checked out.

---

```
Implement the ephemeral per-pane "burner" terminal popup (Linear VIM-53). This is an
IMPLEMENTATION task with a finished visual contract — match it, don't redesign it.

VISUAL CONTRACT (read first)
- burner-terminal-handoff/Burner Terminal Popup.html  — the approved mockup. Open it and
  press A / B / C / Esc to see all states. Lift exact structure, spacing, colors, and copy from it.
- burner-terminal-handoff/BURNER-TERMINAL-HANDOFF.md  — component anatomy, tokens, and the
  resolved design decisions. Authoritative for layout/states.

RESPECT THE ESTABLISHED DESIGN SYSTEM (do not invent new patterns)
- Obsidian Lens / Catppuccin Mocha. Pull every value from docs/design/tokens.css + tokens.ts;
  do NOT hardcode hexes. docs/design/UNIFIED.md is authoritative for the 5-zone layout and the
  anti-patterns (no top nav / no bottom drawer / no #000 / no 1px section borders / Material
  Symbols only / dot+reltime, never "Status: Running").
- The popup is the COMMAND PALETTE's sibling. Reuse its overlay + entry animation:
  src/features/command-palette/CommandPalette.tsx (overlay z-index, Lens Blur backdrop
  = blur(14px) saturate(120%) on rgba(13,13,28,.55), glass card, footer hint strip).
- The invocation chord mirrors the existing chord system:
  src/features/command-palette/chordRegistry.ts and hooks/usePaneRenameChord.ts — Ctrl+: then `.
- Fonts: Instrument Sans / Inter / JetBrains Mono. Icons: Material Symbols Outlined only.

WHAT TO BUILD (new UI)
1) The popup overlay — centered 760×600 glass panel, NOT a docked pane and NOT a 5th layout
   slot. Amber "shell" identity (#f0c674, the existing `shell` agent accent) on the BURNER
   chip, prompt caret ❯, top hairline, and throwaway marker; mint = running/live.
   Anatomy: header (BURNER chip · pane-switcher pills with live dots · throwaway marker · hide ✕;
   sub-row: cwd · "cd stays in burner" isolation note) → dismissable empty-state banner →
   terminal body (fresh prompt / streaming npm-run-dev output) → input bar → footer key hints
   (↵ run · ⌃C cancel · ⌃: ` toggle · "esc hides — shell keeps running").
2) Pane-header burner affordance — add a SECONDARY, low-key ghost icon button (terminal icon)
   to the EXISTING pane header's utility cluster, next to collapse/close. Do NOT restructure the
   header (keep: agent chip · status dot · title · worktree›branch · diff · reltime · icons).
3) Live-but-hidden cue — when a burner shell runs while its popup is hidden, the pane button
   gains a faint amber tint + a small mint live-dot. Add the hover/focus tooltip (compact:
   BURNER·pane N, a mint status line, one hint line, the chord). Secondary cues: amber count
   badge on the rail terminal icon + "● burner ×N" in the status bar.

BEHAVIOR (drives the visuals — full spec in VIM-53)
- Per pane, up to 4; popup shows ONE shell at a time (the focused pane's).
- Hide ≠ kill: Esc / ✕ only hide; the shell keeps running (that's what the live cue means).
- cwd starts at the pane's cwd; `cd` inside is isolated — never moves the pane or session.
- Ephemeral: never persisted, gone on restart.

DO NOT
- Do not port the mock's keyboard "states" switcher or any review chrome — it was scaffolding.
- Do not add new colors, fonts, borders, or layout zones. Reuse tokens + existing components.

Deliver against VIM-53's PR plan. Ask me before adding any content/UI beyond the contract above.
```
