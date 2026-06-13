# Handoff delta — Collapsed activity rail: bucket redesign

The right-hand agent activity panel can be collapsed to a thin rail. The
**old rail** used a 4 px vertical bar with rotated `% ctx` text below it —
the rotated text was hard to read and the thin bar didn't carry enough
visual weight.

The **new rail** replaces both with a **bucket metaphor**: a glass beaker
that fills from the bottom in the agent's accent color, with a big
horizontal percentage above and a horizontal label below. The liquid is
alive — two layered sine waves ripple across the meniscus and the whole
liquid mass gently slosh-rotates.

## Visual contract

```
┌───┐
│ ‹ │           ← expand chevron (28×28 ghost)
└───┘

  ⬢            ← agent identity chip (26×26, agent.accent on agent.accentDim)


 74%           ← BIG horizontal % (Instrument Sans 14px, '%' in accent)
┌──────┐
│██████│       ← Bucket (22×110): glass back + animated wavy liquid
│██████│         - Two sine waves, opposing phases
│██████│         - 25/50/75 tick marks inside
│██████│         - Meniscus line at the liquid surface
│██████│         - Whole liquid slosh-rotates < 1°
│██████│
│ ░░░░ │
└──────┘
 CTX           ← horizontal label (mono 8px, 0.18em letter-spacing, #8a8299)



 75%           ← second bucket — CACHE hit rate
┌──────┐
│██████│
│██████│
│ ░░░░ │
└──────┘
CACHE



  •            ← running pulse dot (only when session.state === 'running')
```

Rail width: **44 px** (was 36 px, widened so the beaker breathes).
Padding: 8 px top, 12 px bottom.
Both buckets are the **same size** (22 × 110, `size='md'`) — cache bucket
isn't shorter; both feel equal-weight in the rail.

### Tone rules

| Token          | When                                                          |
| -------------- | ------------------------------------------------------------- |
| Context fill   | agent.accent normally · `#ffb4ab` if >75% · `#ff94a5` if >90% |
| Cache fill     | `#7defa1` ≥70% · `#e2c7ff` 40-70% · `#ff94a5` <40%            |
| Tick marks     | `rgba(255,255,255,0.18)`                                      |
| Meniscus line  | bucket's fill color @ 0.85 alpha                              |
| Bucket outline | `rgba(255,255,255,0.18)`                                      |
| Label          | `#8a8299` mono 8px `0.18em` tracking                          |

### Animation budget

```css
@keyframes vfWaveA {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
@keyframes vfWaveB {
  from {
    transform: translateX(-50%);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes vfSlosh {
  0%,
  100% {
    transform: translateX(0) rotate(0deg);
  }
  50% {
    transform: translateX(0.4px) rotate(0.6deg);
  }
}
```

- Wave A loop: **3.4 s linear** (lighter, faster, fillOpacity 0.55)
- Wave B loop: **4.8 s linear** (heavier, slower, fillOpacity 0.95, gradient fill)
- Slosh: **2.6 s ease-in-out** infinite, ≤ 0.6° tilt
- Wave amplitude is capped at `Math.min(1.8, dims.w * 0.09)` so it reads as
  breath, not a tide.
- Honors `prefers-reduced-motion` via global handling (wrap the
  `<g style={{ animation }}>` in a media query if you want it explicit).

## Why this works

1. **Number-first.** The percentage is now the heaviest element — the eye
   lands on `74%` before anything else. The bucket reinforces but doesn't
   carry the meaning alone.
2. **No rotated text.** Labels are horizontal mono — readable at a glance.
3. **Two buckets, equal weight.** Both context and cache are visible in
   the collapsed rail. Previously the user lost cache entirely on collapse.
4. **Liquid is alive.** The waves give the panel a sense of "the agent is
   working" — a tiny but constant signal of life, even when the panel is
   collapsed and the main feed is hidden.

## Files in this delta

```
prototype/src/activity.jsx   ← Bucket + BucketLiquid + new collapsed branch
prototype/Vimeflow.html      ← three new @keyframes (vfWaveA, vfWaveB, vfSlosh)
screenshots/bucket-rail-claude.png  ← lavender bucket (Claude focused)
screenshots/bucket-rail-codex.png   ← mint bucket (Codex focused)
```

Drop these over the matching paths in your existing handoff bundle. The
component contract for `<ActivityPanel>` is unchanged — same `collapsed`
boolean, same `onToggleCollapsed` callback. The redesign is purely
internal to the `if (collapsed) { ... }` branch.

---

## Prompt to send to your coding agent

> **Redesign the collapsed activity rail with a bucket metaphor.**
>
> When the right-hand agent activity panel is collapsed (the 44 px vertical
> rail on the right edge), replace the current thin 4 px vertical bar +
> rotated `% ctx` text with a **glass beaker** that fills from the bottom
> in the focused agent's accent color.
>
> Composition top → bottom:
>
> 1. Expand chevron (`<` icon, 28×28 ghost button) at the top.
> 2. Agent identity chip (26×26 rounded square showing `agent.glyph` in
>    `agent.accent` on an `agent.accentDim` background).
> 3. **Context bucket** — a 22×110 SVG beaker with rounded corners,
>    a glass back gradient, agent-accent liquid filling from the bottom.
>    Above it: a big horizontal `74%` (Instrument Sans 14 px, the `%`
>    glyph in the accent color). Below it: a `CTX` label (mono 8 px,
>    `0.18em` letter-spacing, `#8a8299`).
> 4. **Cache bucket** — same dimensions, same composition, label
>    `CACHE`. Tone: mint `#7defa1` if rate ≥70%, lavender `#e2c7ff`
>    40–70%, coral `#ff94a5` <40%. Hide the whole bucket when the session
>    has no cache data.
> 5. Spacer.
> 6. Pulsing dot (agent.accent, 0 0 10px glow) at the bottom when
>    `session.state === 'running'`.
>
> The liquid is **animated** with two layered sine-wave paths and a
> subtle slosh:
>
> - Wave A: a sine path 2× the bucket width, fillOpacity 0.55. Animated
>   with `vfWaveA` — `translateX(0) → translateX(-50%)` on a **1.6 s
>   linear infinite** loop.
> - Wave B: same path, fillOpacity 0.95 (gradient fill). Animated with
>   `vfWaveB` — the opposing direction, **2.4 s linear infinite**.
> - The whole liquid `<g>` slosh-rotates with `vfSlosh` — a
>   **1.8 s ease-in-out infinite** loop tilting up to `0.6deg` from
>   centre-bottom.
> - Wave amplitude is `Math.min(2.4, bucketWidth * 0.12)` — visible
>   motion without breaking the bucket silhouette.
> - Honor `prefers-reduced-motion: reduce` — disable the animations
>   for users who opt out.
>
> Inside the beaker, render **horizontal tick marks at 25 / 50 / 75 %**
> (4 px wide, both edges, `rgba(255,255,255,0.18)`).
>
> The **expanded panel is unchanged** — only the `if (collapsed) { ... }`
> branch of `<ActivityPanel>` is touched.
>
> Reference files:
>
> - `docs/design/handoff-bucket/prototype/src/activity.jsx`
>   (contains the new `<Bucket>` and `<BucketLiquid>` components in full)
> - `docs/design/handoff-bucket/prototype/Vimeflow.html`
>   (contains the new `@keyframes vfWaveA / vfWaveB / vfSlosh`)
> - `docs/design/handoff-bucket/screenshots/bucket-rail-claude.png`
>   and `bucket-rail-codex.png` for the visual target.
