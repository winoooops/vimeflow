# Handoff delta — Right Activity Panel (Agent Status)

The **right-hand activity panel** in Vimeflow follows the focused terminal
pane: focus Claude and the panel shows Claude's status; focus Codex and it
swaps to Codex's. It can be **collapsed to a 36 px rail** when the user needs
more horizontal space for the panes, and **re-expanded** from that rail.

This bundle is the minimum needed to recreate that panel in your own
React + TypeScript + Tailwind app.

---

## What's inside

```
prototype/src/activity.jsx        ← the ActivityPanel component
prototype/src/primitives.jsx      ← StatusDot, Icon, RelTime, ProgressBar,
                                    ContextSmiley, Kbd, Chip, SectionLabel,
                                    ScrollArea (deps used by activity.jsx)
screenshots/activity-expanded-claude.png    ← Claude pane focused
screenshots/activity-expanded-codex.png     ← Codex pane focused (mint accent)
screenshots/activity-collapsed-rail.png     ← Collapsed to 36 px rail
```

---

## Component contract

```ts
interface ActivityPanelProps {
  session: SessionState // the focused pane's session object
  running: boolean // session.state === 'running'
  agent: {
    glyph: string // '∴'  for Claude, '◇' for Codex, '✦' for Gemini
    short: string // 'CLAUDE' | 'CODEX' | 'GEMINI'
    name: string // 'Claude Code' | 'Codex CLI' | ...
    accent: string // '#cba6f7' | '#7defa1' | '#a8c8ff'
    accentDim: string // 16% alpha of accent
  }
  collapsed: boolean // current collapse state
  onToggleCollapsed: () => void // toggle handler — wire to tweaks.activityCollapsed
}
```

**`session` shape used by the panel:**

```ts
interface SessionState {
  state: 'running' | 'idle' | 'awaiting' | 'completed' | 'errored'
  title: string // 'auth middleware refactor'
  agent: string // 'Claude Code'
  branch: string // 'feat/jose-auth'
  turns: number
  tokens: { used: number; max: number } // context window
  usage: { used: number; max: number } // 5-hour usage window
  cache: { cached: number; wrote: number; fresh: number; history: number[] }
  waitingOn?: string // required when state === 'awaiting'
  error?: string // required when state === 'errored'
}
```

The panel re-renders whenever `agent` or `session` changes — that's how focus
following works. In the parent, derive both from `focusedPaneId`:

```ts
const focusedPane    = panes.find(p => p.id === focusedPaneId);
const focusedSession = sessions.find(s => s.id === focusedPane?.sessionId);
const focusedAgent   = AGENTS[focusedPane?.agentId];

<ActivityPanel
  session={focusedSession}
  running={focusedSession.state === 'running'}
  agent={focusedAgent}
  collapsed={!!tweaks.activityCollapsed}
  onToggleCollapsed={() =>
    updateTweaks({ activityCollapsed: !tweaks.activityCollapsed })
  }
/>
```

---

## Two render branches

### Expanded — 320 px

Stacked sections, all scoped to the focused agent:

1. **Header** (62 px) — agent glyph chip in `agent.accent` over `agent.accentDim` background, `agent.short` label + status dot, then session title + branch in mono dim. Right side: a chevron-right collapse button (`onToggleCollapsed`).
   - Background uses a subtle gradient wash `linear-gradient(180deg, agent.accentDim, transparent 80%)` so the agent identity colors the whole panel header.
2. **Meters** — context bar, 5-hour usage bar, turn count.
3. **Token cache** — big % number + sparkline of in-session hit-rate, stacked bar for `cached / wrote / fresh`, 3-column stat grid, and a row of bars for past sessions (Claude-web style).
4. **Conditional state card** — only when `state === 'awaiting'` (coral approve/deny buttons) or `state === 'errored'` (red mono stacktrace block). When `running`, a "Now" gradient card shows the live edit.
5. **Activity feed** — vertical timeline; each event is `edit | bash | read | think | user` with a 14 px dot in event color and a relative timestamp.

### Collapsed — 36 px rail

Vertical rail showing only:

1. Expand chevron at the top (`onToggleCollapsed` → re-expands).
2. The focused agent's glyph chip (24×24) so the user still knows which agent the rail represents.
3. A 4×64 px vertical context-meter bar — filling height = `tokens.used / tokens.max %`. Warns coral if > 85%.
4. Vertical "% ctx" label (rotated text).
5. At the very bottom (only when running): a pulsing agent-accent dot.

Click the chevron to expand back to 320 px.

---

## Required primitives (in `primitives.jsx`)

These are tiny but the panel pulls them all:

| Primitive       | Used for                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `StatusDot`     | the agent status pip — running pulses + glows, awaiting pulses coral, completed is a hollow mint ring, errored is solid coral, idle is dim. |
| `Icon`          | Material Symbols Outlined wrapper with FILL/wght variation settings.                                                                        |
| `RelTime`       | mono "2m ago" style timestamp.                                                                                                              |
| `ProgressBar`   | the context / usage bars (3 px tall, gradient fill, optional glow).                                                                         |
| `ContextSmiley` | the 😀 → 🥵 face that degrades as context fills.                                                                                            |
| `Kbd`           | the keyboard hint pill.                                                                                                                     |
| `Chip`          | 2-tone pill used by the "live" badge in the now-card.                                                                                       |
| `SectionLabel`  | the small uppercase mono section header (`Cache · Activity · Now · …`).                                                                     |
| `ScrollArea`    | a scroll container with top/bottom mask fades.                                                                                              |

If you already have equivalents in your codebase, swap in your versions —
the panel only cares about props, not implementations.

---

## Toggle wiring

The collapse state is persisted via the existing `tweaks.activityCollapsed`
boolean. The dialog toggle is also accessible:

- From the panel header chevron — calls `onToggleCollapsed`.
- From the global Tweaks panel (future) — toggles the same key.

Animation: width transition `220ms cubic-bezier(.2,.8,.2,1)`. Section content
fades out at `opacity 120ms` so it doesn't clip mid-transition. In production,
wrap the panel in `framer-motion`'s `<motion.aside layout>` or use a CSS
`@starting-style` block — the prototype just snaps for simplicity.

---

## Screenshots

The three captures in `screenshots/` show:

- `activity-expanded-claude.png` — Claude pane focused, lavender header, full cache + meters + feed visible.
- `activity-expanded-codex.png` — Codex pane focused, mint accent flips through the whole header.
- `activity-collapsed-rail.png` — 36 px rail with chevron + glyph + vertical context bar.

Captures are from the live prototype at 924×540 (preview limit). Open the
prototype locally for crisper inspection.

---

## Anti-patterns

- Don't show "Status: Running" text. The pulsing dot + relative timestamp
  encodes the same info more glanceably.
- Don't use absolute timestamps anywhere in this panel — always relative
  ("2m ago", "4h ago"). Hover-tooltip is the right place for the absolute
  value.
- Don't substitute the agent accent for the panel's background — keep it
  to the header gradient + glyph chip + active dots. The rest of the panel
  stays on the neutral `#141424` surface.
