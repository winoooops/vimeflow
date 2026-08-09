# Session Card — Agent Rows · design handoff

**Scope:** visual pass for `AgentRows.tsx` / `AgentRow` in the sidebar Sessions tab (List → Card).
**Reference mockup:** `Session Card Agent Rows.html` (same folder — open it, switch Lens themes and the motion toggle).
**Behaviour is unchanged** except where called out in §7 (contract deltas approved during review).

---

## 1. Anatomy

```
┌ card (bg-surface-container, rounded-xl, px-2.5 py-2.5) ──────────────┐
│ title            13.5 semibold  display font            [badge]      │
│ subtitle         11.5           text-on-surface-muted                │
│ meta             10 mono        state · elapsed · panes               │
│ ┌ rows recess (bg-wash-recess, rounded-lg, p-1, gap-px) ───────────┐ │
│ │ [chip 22]  agent name        11 medium                           │ │
│ │            latest message    10.5  truncate                      │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Type ladder, strictly descending so rows read as subsidiary:
**13.5 title → 11.5 subtitle → 11 agent name → 10.5 message.**

No borders anywhere. Grouping is tonal only: one shared recess panel behind all rows
(`bg-wash-recess`), 6px below the meta row. A single-agent card gets the same panel — no special case.

---

## 2. Container + row classes

```tsx
/* AgentRows — one recess panel wraps every row */
<div className="mt-1.5 flex flex-col gap-px rounded-lg bg-wash-recess p-1">

/* AgentRow — button, two columns, 33px tall */
className="group grid w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2
           rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-wash-faint
           focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"

/* line 1 — agent name only; state lives in the chip */
"min-w-0 flex-1 truncate text-[11px] font-medium leading-none text-on-surface-variant"

/* line 2 — latest contextual message, full remaining width */
"mt-[3px] block truncate text-[10.5px] leading-[1.25] text-on-surface-muted"
```

`min-w-0 flex-1 truncate` on the name is load-bearing — `shrink-0 truncate` collapses it to 0.

---

## 3. State chip — universal, agent-agnostic

22px square, radius 6 (two-thirds of the 33px row). One vocabulary for every agent: the agent's
**name** says who, the **chip** says what's happening. Agent registry accents are no longer used in
the row.

```tsx
"grid h-[22px] w-[22px] place-items-center rounded-[6px] font-mono text-[11px] leading-none"

chipState = { running:  "bg-state-running/[0.14]  text-state-running",
              awaiting: "bg-state-awaiting/[0.16] text-state-awaiting",
              error:    "bg-state-error/[0.16]    text-state-error",
              done:     "bg-state-done/[0.14]     text-state-done",
              idle:     "bg-state-idle/[0.10]     text-state-idle" }

stateGlyph = { awaiting:'!', error:'✕', done:'✓', idle:'◦' }   // running has no glyph

/* running — rotating hairline ring instead of a glyph */
"block h-3 w-3 rounded-full border-[1.5px] border-state-running/25
 border-t-state-running animate-spin motion-reduce:animate-none"
```

Fills stay ≤16% so a row never competes with the **card-level** notification badge, which remains
the loud signal. `awaiting` is the loudest in-row state; `done`/`idle` recede.

---

## 4. Shared state palette (add to the token layer)

The row references only `state-*`. Each aliases an existing semantic token, so every Lens theme
recolours the whole state vocabulary by overriding the semantics — never the component.

```css
:root {
  --rgb-state-running: var(--rgb-secondary); /* work in flight  */
  --rgb-state-awaiting: var(--rgb-tertiary); /* needs the human */
  --rgb-state-error: var(--rgb-error);
  --rgb-state-done: var(--rgb-success-muted);
  --rgb-state-idle: var(--rgb-on-surface-muted);
}
```

```js
// tailwind.config.js → theme.extend.colors
'state-running':  'rgb(var(--rgb-state-running) / <alpha-value>)',
'state-awaiting': 'rgb(var(--rgb-state-awaiting) / <alpha-value>)',
'state-error':    'rgb(var(--rgb-state-error) / <alpha-value>)',
'state-done':     'rgb(var(--rgb-state-done) / <alpha-value>)',
'state-idle':     'rgb(var(--rgb-state-idle) / <alpha-value>)',
'wash-recess':    'var(--color-wash-recess)',   // rgba(0,0,0,.22) dark · rgba(16,15,15,.045) Flexoki
```

All `--rgb-*` custom properties must be **space-separated** channels (`18 18 33`), not commas —
comma triples + slash alpha is invalid CSS and silently drops the declaration.

Verified across Obsidian (default), Editorial, Dense, Navigator, Flexoki (light) and a synthetic
sixth palette; nothing in the row is hardcoded.

---

## 5. Density

| Card     | Height |
| -------- | ------ |
| 0 agents | 83px   |
| 1 agent  | 164px  |
| 3 agents | 198px  |
| 4 agents | 232px  |

33px rows + 4px panel padding. **Three rows is the ceiling** in a 288px rail; at 4+ the Active group
stops being scannable. Recommendation for v2: cap at 3 rows and append a muted "+N more panes" line
rather than growing the card.

---

## 6. Motion

Only `running` animates: `animate-spin` on the chip ring. `motion-reduce:animate-none` leaves a
static hairline circle — same footprint, no layout change. No pulses, glows or transitions elsewhere;
`transition-colors` on row hover only.

---

## 7. Contract deltas approved in review

1. **Status word + status dot removed.** The chip carries state on its own; line 1 is the agent name.
2. **Right slot removed** (relative time _and_ mini progress bar, so no `role="progressbar"` in the
   row). Elapsed time already lives on the card's meta row and the spinning chip already signals work
   in flight; the freed ~44px goes to the message line.
3. **Agent accent no longer used in the row** — state tone replaces it.

Everything else holds: one row per coding-agent pane, always visible, no expand/collapse, rows are
buttons that focus the pane, Recent and zero-agent cards untouched.
