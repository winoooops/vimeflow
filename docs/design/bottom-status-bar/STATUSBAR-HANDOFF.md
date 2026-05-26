# Vimeflow — StatusBar Component Handoff

> **For the implementing agent.** This document is self-contained. Read it top to bottom and ship. Do not ask clarifying questions — every known conflict between the prototype and the broader design docs is already resolved below.

---

## 0. Task

Implement the bottom `StatusBar` component for Vimeflow. A 24px tall, monospace, read-only strip pinned to the bottom of the app shell that surfaces ambient session state.

**Deliverable:** `src/components/StatusBar.tsx` (or `.jsx`), wired into the app shell, replacing the inline block currently at `src/app.jsx` immediately after `<ActivityPanel />`.

---

## 1. Source-of-truth order

Read in this order. Stop when you have what you need.

1. **This file** — anatomy, contract, edge cases. **Authoritative for this component.**
2. **`docs/design/tokens.css`** — every color / metric below must reference a CSS variable from here. No raw hex.
3. **`docs/design/UNIFIED.md`** — layout zones, type, global rules. ⚠️ **§2's status-bar description is stale** (only lists brand · version · smiley · turns · palette hint). This file supersedes it for content.

### Conflicts already resolved — do not ask

| Question          | Answer                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand text        | `obsidian-cli` (UNIFIED.md says "vimeflow" — **ignore**)                                                                                                                       |
| Palette hint      | Render the shared command-palette shortcut. Current Linux shortcut: `Ctrl` + `:`; Electron intercepts this with `before-input-event` before renderer/global shortcuts can run. |
| Full segment list | Per §3 below, **not** UNIFIED.md §2                                                                                                                                            |

---

## 2. Visual reference — three states

### 2.1 Running session, healthy

```
obsidian-cli · v0.9.4                    🕒 4h 12m · 😐 74% · ⚡ 73% cached · 37 turns · +212 −188 · Ctrl :
```

### 2.2 Idle / new session, no cache yet

```
obsidian-cli · v0.9.4                                            😊 12% · 0 turns · Ctrl :
```

### 2.3 Errored, high context, low cache

```
obsidian-cli · v0.9.4               🕒 1d 03h · 🥵 94% · ⚡ 35% cached · 44 turns · +540 −1.2k · Ctrl :
```

---

## 3. Anatomy — left to right

| #   | Segment                | When shown                                               | Notes                                                                                                                                                       |
| --- | ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | **Brand**              | always                                                   | `obsidian-cli` in `--primary-container`. Never wraps.                                                                                                       |
| 2   | **Separator**          | always                                                   | Literal `·` span in `--outline-variant` tone.                                                                                                               |
| 3   | **Version**            | always                                                   | Static string, e.g. `v0.9.4`, in `--on-surface-muted`.                                                                                                      |
| 4   | **Flex spacer**        | always                                                   | `flex: 1`. Everything to the right is right-aligned.                                                                                                        |
| 5   | **Session duration**   | only when `session.startedAgo` is set and not `"—"`      | Clock icon (`schedule` from Material Symbols Outlined) + relative string like `4h 12m`. Drops the trailing `·` separator when hidden.                       |
| 6   | **Context smiley + %** | always                                                   | Use the existing `ContextSmiley` component from `src/primitives.jsx`. Thresholds: `<50 😊 success` · `<75 😐 neutral` · `<90 😟 tertiary` · `≥90 🥵 error`. |
| 7   | **Cache hit rate**     | only when `cache.cached + cache.wrote + cache.fresh > 0` | Bolt icon + `{rate}%` + the word `cached`. Tone: `≥70` → `--success` · `≥40` → `--primary` · `<40` → `--tertiary`.                                          |
| 8   | **Turn count**         | always                                                   | Integer + the word `turns`. No pluralisation — keep it terse and uniform.                                                                                   |
| 9   | **Diff stats**         | only when `changes.added > 0                             |                                                                                                                                                             | changes.removed > 0` | Format: `+212` in `--success` then `−188` in `--tertiary`, no space between them. Compact to `1.2k` over 999. |
| 10  | **Palette hint**       | always                                                   | One `<Kbd>` per key in `paletteShortcut`. Clickable; opens command palette via `onOpenPalette`. The only interactive region in the bar.                     |

Segments are separated by literal `·` spans, **not** by borders or `::after` pseudo-elements. When a conditional segment is hidden, its **leading** `·` is hidden with it.

---

## 4. Data contract — TypeScript

```ts
interface StatusBarProps {
  session: {
    startedAgo?: string // "4h 12m", "—" or empty = none
    turns: number // integer ≥ 0
    cache?: {
      cached: number
      wrote: number
      fresh: number
    }
    changes?: {
      added: number
      removed: number
    }
  } | null // null = no active agent in selected pane
  contextPct: number // 0–100, drives the smiley
  paletteShortcut: readonly string[] // e.g. ["Ctrl", ":"]
  onOpenPalette: () => void // fired when palette shortcut cluster is clicked
}
```

Pure presentational. No fetching, no internal state, no derived effects.
`WorkspaceView` owns the active-pane binding: pass a non-null `session` only
when `useAgentStatus(activePane.ptyId)` reports an active, non-exited agent whose
`sessionId` matches the selected pane PTY id. Shell panes and stale statuses from
other panes must pass `session: null`, hiding context, turns, cache, duration,
and diff segments while keeping brand/version/palette visible.

---

## 5. Tokens & metrics — no new values

All values come from `docs/design/tokens.css`. Do not introduce new tokens; do not hardcode hex.

```css
/* container */
height:        var(--status-bar-h);              /* 24px */
background:    var(--surface-container-lowest);  /* #0d0d1c */
border-top:    1px solid rgba(74, 68, 79, 0.2);  /* outline-variant @ ~20% */
padding:       0 12px;
gap:           14px;

/* type */
font-family:   var(--font-mono);                 /* JetBrains Mono */
font-size:     10px;                             /* below --text-label-sm; this is intentional */
font-variant-numeric: tabular-nums;              /* every numeric span */

/* color roles */
brand text:        var(--primary-container)
version, labels:   var(--on-surface-muted)
duration value:    var(--on-surface-variant)
separators (·):    var(--outline-variant) @ ~70%
diff added:        var(--success)
diff removed:      var(--tertiary)
cache tone ≥70:    var(--success)
cache tone ≥40:    var(--primary)
cache tone <40:    var(--tertiary)
```

---

## 6. Behaviour & edge cases

| Case                        | Expected                                                            | Why                                                                                |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No active session           | Brand + version + palette hint only                                 | Right cluster collapses to just the palette hint. Don't render placeholder dashes. |
| Cache total = 0             | Skip the cache segment entirely (and its leading `·`)               | Don't show "0% cached".                                                            |
| Turns = 0                   | Show `0 turns`                                                      | Turn count is the heartbeat — presence matters even at zero.                       |
| `changes` missing or both 0 | Skip diff segment (and its leading `·`)                             | Same rule as cache.                                                                |
| Narrow viewport (<760px)    | Right cluster wraps to a 2nd row; bar grows to 44px                 | Never truncate or ellipsize numbers. Palette hint stays bottom-right.              |
| Numbers update mid-run      | Animate in place — no layout shift                                  | Achieved by `font-variant-numeric: tabular-nums` on every numeric span.            |
| Palette hint cluster        | `cursor: pointer` + hover background `var(--surface-container-low)` | Discoverability — most users won't know the shortcut until they hover.             |

---

## 7. Anti-patterns — do not add

- ❌ Icons next to "turns" or "+212/−188"
- ❌ Plural forms (`1 turn` vs `2 turns`)
- ❌ Tooltips on segments (the bar is ambient — anything that demands attention belongs in the activity panel above)
- ❌ Click handlers on anything other than the palette hint
- ❌ Top shadows, entry animations, gradient fills
- ❌ Borders between segments (use `·` separators only)
- ❌ Pure `#000` background — use `--surface-container-lowest`
- ❌ Absolute timestamps anywhere — duration is relative (`4h 12m`), full stop

---

## 8. Acceptance criteria

All five must pass visually before this component is done:

1. **Running session** — all data present — matches §2.1
2. **Idle / no cache** — cache, diff, duration omitted with no orphan separators — matches §2.2
3. **High-context errored** — smiley `🥵`, cache tone `--tertiary` — matches §2.3
4. **<760px viewport** — right cluster wraps, palette hint stays bottom-right, no horizontal overflow
5. **Selected shell pane** — no active agent in the selected pane hides context, turns, cache, duration, and diff; brand/version/palette remain visible

When all five pass:

- The inline `<div style={{ height: 24, ... }}>` block in `src/app.jsx` (immediately after `<ActivityPanel />`) is replaced with `<StatusBar {...} />`.
- Props are passed from the selected pane's active agent status plus the shared command-palette shortcut and `() => setPaletteOpen(true)`; do not fall back to workspace session activity for context or turns.
- No new dependencies are added.

---

## 9. Reference implementation

The current inline implementation lives in `src/app.jsx`, in the block:

```jsx
{/* Global status bar */}
<div style={{
  height: 24, flexShrink: 0,
  background: '#0d0d1c',
  borderTop: '1px solid rgba(74,68,79,0.2)',
  ...
}}>
  ...
</div>
```

Treat it as the **functional** reference (segment order, conditionals, formatting), but **not** as the styling reference — replace raw hex with `var(--...)` from `tokens.css` per §5.
