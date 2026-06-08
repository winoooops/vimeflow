# Vimeflow — Token Cache Card Migration Kit

> **Paste-to-agent prompt:**
>
> Migrate the **Token Cache card** from the right-hand activity panel into our app. It's a single self-contained React component, `CacheBlock`, plus three tiny dependencies (`SectionLabel`, `Sparkline`, `CacheStackBar`). `Token Cache Card.html` is **runnable** — open it, copy the four functions out. The card is **scoped to the current session only** (no cross-session history). Match the exact colors, fonts, and tone logic below.

---

## Files in this kit

| File                            | What it is                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Token Cache Card.html`         | **Self-contained, runnable.** The card + its 3 dependencies + the right `<link>` tags. Open it; copy from it. |
| `TOKEN-CACHE-CARD-MIGRATION.md` | This doc.                                                                                                     |
| `screenshot.png`                | Reference render of the card.                                                                                 |

---

## What it shows

A compact panel card summarizing prompt-cache efficiency **for the current turn / session**:

1. **Big hit-rate %** ("cached this turn") with a **sparkline** of the session's recent hit-rate readings.
2. A **stacked ratio bar** (cached vs wrote vs fresh) — proportion of the token spend.
3. A **3-column breakdown** — `cached / wrote / fresh` with raw counts + a one-word hint each.

The whole thing is wrapped in **one rounded card** whose background/border tint follows the hit-rate tone.

---

## Dependency graph

```
CacheBlock                 ← the card (the thing you're migrating)
├── SectionLabel           ← uppercase mono "TOKEN CACHE" header   (from src/primitives.jsx)
├── Sparkline              ← inline SVG trend line + area fill      (from src/activity.jsx)
└── CacheStackBar          ← cached/wrote/fresh proportion bar      (from src/activity.jsx)
```

No external chart lib. `Sparkline` and `CacheStackBar` are plain SVG/divs. If your app already has `SectionLabel`, reuse it and drop the copy.

---

## Data shape

```js
cache = {
  cached: 8400, // tokens reused from cache (free)
  wrote: 2100, // tokens uploaded to the cache this turn
  fresh: 740, // brand-new tokens
  history: [42, 51, 49, 58, 63, 61, 69, 72, 70, 75], // hit-rate % readings, THIS session
}
```

The caller computes `rate` and passes it in:

```jsx
const total = cache.cached + cache.wrote + cache.fresh
const rate = total > 0 ? Math.round((cache.cached / total) * 100) : 0

;<CacheBlock cache={cache} rate={rate} />
```

> **Scope note (important):** this card is deliberately **current-session only**. An earlier version had a "past sessions" history-bar row pulling other sessions' numbers — that was removed because the card lives in a panel otherwise bound to the focused session, so mixing in other sessions' data read as off. Keep `history` as _this_ session's own trend (sparkline) and nothing more.

---

## Tone logic (single source of truth)

The hit-rate `rate` drives one tone, reused for the number color, sparkline stroke, card tint, and the leading segment of the ratio bar:

| rate    | tone    | color                  |
| ------- | ------- | ---------------------- |
| `>= 70` | success | `#7defa1` (mint green) |
| `40–69` | primary | `#e2c7ff` (lavender)   |
| `< 40`  | warn    | `#ff94a5` (pink)       |

```js
const tone = rate >= 70 ? 'success' : rate >= 40 ? 'primary' : 'warn'
const toneColor =
  tone === 'success' ? '#7defa1' : tone === 'warn' ? '#ff94a5' : '#e2c7ff'
```

The stacked bar colors its **cached** segment by the _cached share_ (same thresholds); **wrote** is always blue `#a8c8ff → #8aa9d8`, **fresh** is always muted `rgba(205,195,209,0.4)`.

---

## Tokens used

| Token                       | Value                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| Card tint (success)         | `linear-gradient(135deg, rgba(125,239,161,0.06), rgba(13,13,28,0.5))` |
| Card border                 | `${toneColor}26` (the tone at ~15% alpha)                             |
| Breakdown sub-panel bg      | `rgba(13,13,28,0.25)`, top border `rgba(74,68,79,0.2)`                |
| Card outer border-bottom    | `1px solid rgba(74,68,79,0.18)` (the panel section divider)           |
| Big number                  | Instrument Sans 28 / 600, `#e3e0f7`, tabular-nums                     |
| Value figures               | JetBrains Mono 11.5 / 600, `#e3e0f7`                                  |
| Labels (cached/wrote/fresh) | JetBrains Mono 9, `#8a8299`, uppercase, `0.06em`                      |
| Hints (free reuse / …)      | Inter 10, `#6c7086`                                                   |
| "cached this turn"          | JetBrains Mono 9.5, `#8a8299`, uppercase                              |

### Fonts to load

```html
<link
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600&family=Inter:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

`JetBrains Mono` = labels/values · `Instrument Sans` = the big % number · `Inter` = the small hint text. No icon font needed (no Material Symbols here).

---

## Acceptance criteria

- [ ] Card shows the big `%` + "cached this turn", with a sparkline of the session's recent hit-rate.
- [ ] Number, `%`, sparkline, card tint, and ratio-bar lead segment all follow the **same tone** (green ≥70 / lavender 40–69 / pink <40).
- [ ] Stacked bar widths are proportional to cached / wrote / fresh; wrote is blue, fresh is muted.
- [ ] 3-column breakdown shows formatted counts (`8.4k`, `2.1k`, `740`) with label + hint, **no colored legend dots**.
- [ ] **No "past sessions" row, no live/pulse dot** — the card reflects only the current session.
- [ ] Empty state: with no `history`, the sparkline shows "no data yet"; with zero tokens, the bar is a flat empty track.
