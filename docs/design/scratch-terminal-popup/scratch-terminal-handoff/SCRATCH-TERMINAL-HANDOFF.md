# Vimeflow — Scratch Terminal Popup (VIM-53)

Design contract for the ephemeral, throwaway per-pane **scratch terminal** popup.
This is the visual spec PR 1 builds against. The full behavioral spec is **Linear
VIM-53**; this doc inlines only what surfaces in the UI.

> **What it is:** a throwaway terminal that opens as a centered popup over the
> workspace — same overlay family as the **command palette** — so a user can run
> ad-hoc commands (`npm run dev`, file search, installs) **without** hijacking the
> pane's agent PTY and **without** spending one of the ≤4 layout slots.

## Files

- `Scratch Terminal Popup.html` — self-contained mockup (markup + CSS, design tokens inlined).
  Defaults to the streaming state. **Press `A` (fresh) · `B` (npm run dev) · `C`
  (live-but-hidden cue) · `Esc` (hide)** to walk the states. No build step — open in a browser.
- `SCRATCH-TERMINAL-HANDOFF.md` — this file.
- `PROMPT.md` — ready-to-paste implementation prompt for the coding agent.

> The mock has **no review chrome** — the old "states" clicker was scaffolding and
> is not part of the product. State switching is keyboard-only in this file.

---

## Identity decision: scratch = the `shell` agent (amber)

The system already registers a **`shell` agent** (`agents.js`) with the amber accent
`#f0c674` and a `$` glyph. A scratch terminal _is_ a raw shell, so the popup wears a
restrained **amber identity** layered on the command-palette overlay structure. This
distinguishes it from agent panes (claude=lavender, codex=mint, gemini=blue) and reads
as "throwaway shell." Amber is used sparingly: the `SCRATCH` chip, the prompt caret `❯`,
a 2px top hairline on the panel, the throwaway marker, and the per-pane scratch button.
**Mint** (`--success`) stays the "running/live" signal.

---

## A. The popup (the new overlay)

```
.overlay                         ← Lens Blur: rgba(13,13,28,.55) + blur(14px) saturate(120%)
                                   fixed inset-0, z-100, centered — SAME family as CommandPalette
└─ .popup  760×600               ← glass panel; amber-tinted border + glow + 2px top hairline
   ├─ .pop-head                  ← identity row + sub-row
   │  ├─ .scratch-chip  "SCRATCH" (terminal icon, amber)
   │  ├─ .pane-pills             ← pane 1 / pane 2 … each with a live dot — glance at / switch
   │  │                            between panes' scratch shells WITHOUT leaving the popup
   │  ├─ .ephemeral  "throwaway" (auto_delete, dashed) — reads as disposable
   │  ├─ .pop-x                  ← hide (NOT kill)
   │  └─ sub-row: cwd (~/vimeflow-core) · "cd stays in scratch" (link_off, isolation affordance)
   ├─ .fresh-banner  (state A)   ← empty-state explainer, OUT of the scroll area, dismissable (✕, persisted)
   ├─ .pop-term                  ← the shell: prompt (A) / streaming npm-run-dev output (B)
   ├─ .pop-input                 ← ❯ prompt + placeholder ("run a command…" / "running · ⌃C to interrupt")
   └─ .pop-foot                  ← key hints: ↵ run · ⌃C cancel · ⌃: ` toggle · "esc hides — shell keeps running"
```

**Size (open Q1 → resolved):** a taller centered panel (760×600), not a palette-sized
card — a terminal needs height for `npm run dev` output. Still unmistakably a centered
overlay (blurred backdrop + glow), never a docked pane / 5th slot.

**Per-pane identity (open Q2 → resolved):** the header names the focused pane's shell and
cwd; the **pane-switcher pills** let you glance at / jump between each pane's scratch shell
from inside the popup (live dot = that pane has a running shell).

**States:**

- **A — fresh / just opened:** prompt only; the explainer banner sits under the header.
- **B — mid-command:** `npm run dev` streaming, with a `● dev server running · ⌃C to stop` strip.
- **C — live-but-hidden:** popup dismissed; cues remain on the workspace (see §B).

**Hide ≠ kill:** the ✕ and `Esc` only **hide** the popup; the shell keeps running. The
footer states this literally.

---

## B. New elements on the pane / workspace (live-but-hidden cue, open Q3 → resolved)

The scratch affordance is woven into the **existing pane header** (do not restructure it):

```
.pane-head  →  [agent chip] [● dot] [task title] … [worktree›branch] [+N −N] [reltime] | [scratch ▸] [collapse] [close]
```

- **`.scratch-btn`** — a **secondary / low-key ghost icon button** (terminal icon) in the
  header's utility cluster, beside collapse/close. It is the click affordance for opening
  the pane's scratch shell (chord `Ctrl+:` then `` ` `` is primary).
- **Live-but-hidden cue** — when a scratch shell is running but the popup is dismissed, the
  button gains a faint amber tint + a small **mint live-dot** badge. Primary cue (closest to
  where the shell lives).
- **`.scratch-tip`** — hover/focus tooltip on that button: header (`SCRATCH · pane N`) + a
  mint status line (`running · npm run dev · 1m 12s`) + **one compact hint**
  (`Throwaway shell · cd stays local · gone on restart`) + the chord hint. Mirrors the
  empty-state banner's UI, condensed.
- **Secondary cues** — a small amber **count badge** on the rail's terminal icon, and
  `● scratch ×N` in the global status bar.

---

## Tokens used (all from `docs/design/tokens.css`)

```
surfaces   --surface #121221  --surface-container-lowest #0d0d1c  --surface-container #1e1e2e
text       --on-surface #e3e0f7  --on-surface-variant #cdc3d1  --on-surface-muted #8a8299  #6c7086
accents    primary/lavender #cba6f7·#e2c7ff   success/mint #50fa7b·#7defa1   secondary/blue #a8c8ff
           tertiary/coral #ff94a5             worktree mauve #c39eee
scratch    --shell accent #f0c674  (dim rgba(240,198,116,.14)  soft .34)
lines      rgba(74,68,79,.30) / .18   (tonal only — NO visible 1px section borders)
glass      fill rgba(30,30,46,.88)  blur 20–24px saturate 150–160%   Lens Blur = blur(14px) saturate(120%)
motion     --ease cubic-bezier(.2,.8,.2,1)   entry 220ms   pulse 2s / 1.4s
type       Instrument Sans (display) · Inter (body) · JetBrains Mono (chrome, terminal)
icons      Material Symbols Outlined  (terminal · bolt · link_off · account_tree · fork_right · auto_delete · close · unfold_less)
```

## Match the command palette (it's the sibling)

Pull overlay + entry animation from **`src/features/command-palette/CommandPalette.tsx`**
(overlay z-index, Lens Blur backdrop, glass card, footer hint strip). The invocation chord
mirrors **`chordRegistry.ts`** + **`hooks/usePaneRenameChord.ts`** (`Ctrl+:` then a key). The
pane-header button slots into the existing pane header component — keep its established order
(agent chip · status dot · title · worktree›branch · diff · reltime · utility icons).

## Behavioral contract that drives the visuals (from VIM-53)

- Lives **per pane**, up to 4. The popup shows **one** shell at a time — the focused pane's.
- **Hide ≠ kill.** Closing only hides; the shell (e.g. `npm run dev`) keeps running → the live cue.
- cwd starts at the host pane's cwd; **`cd` inside is isolated** — never moves the pane or session.
- Toggled by chord (`Ctrl+:` then `` ` ``); `Esc` hides.
- **Ephemeral** — never persisted, gone on restart.

## Anti-patterns (per `docs/design/UNIFIED.md` §8)

No top nav, no bottom drawer, no `#000` backgrounds, no 1px section borders (tonal only),
no emoji as iconography (Material Symbols only; emoji reserved for the context smiley),
no "Status: Running" text — show the dot + relative time.
