# Sub-spec 6: Frontend Context Bucket

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 4 (types + hook)
**Scope:** The bucket gauge visual component for context window status.

## Files to Create

```
src/features/agent-status/components/
└── ContextBucket.tsx     // Bucket gauge + progress bar + emoji
```

## Files to Modify

- `src/features/agent-status/components/AgentStatusPanel.tsx` — render `ContextBucket` after `StatusCard`

## Design Reference

- Visual: `docs/design/agent_status_sidebar/code.html` — "Context Bucket" section
- Original concept: `docs/design/context_bucket/code.html` and `screen.png`

## Props

```typescript
interface ContextBucketProps {
  usedPercentage: number | null // 0-100, null before first API call
  contextWindowSize: number // 200000 or 1000000
  totalInputTokens: number
  totalOutputTokens: number
}
```

## Layout (top to bottom)

### 1. Header row

- Left: emoji + "CURRENT CONTEXT" label
- Right: percentage in mono font (e.g., "74%")
- Emoji selection based on `usedPercentage`:
  - `null` or `< 60`: 😊
  - `60-79`: 😐
  - `80-89`: 😟
  - `90+`: 🥵

### 2. Bucket gauge

- Container: `h-[72px]`, flex row with gauge + scale
- **Gauge (flex-1)**:
  - Background: `bg-surface-container-low`, `rounded-lg`, `overflow-hidden`
  - Grid dot pattern overlay: radial gradient at 4% opacity (cosmetic)
  - Fill: `div` anchored to bottom, height = `usedPercentage%`
  - Fill gradient: `linear-gradient(to top, primary-container/50, primary-container)`
  - Fill glow: `box-shadow: 0 -4px 12px primary-container/25`
  - CSS `transition: height 500ms ease` for smooth updates
- **Scale (right side)**:
  - `font-mono text-[8px] text-outline`
  - Three labels: max (e.g., "128k"), percentage (highlighted in `text-primary-container`), "0k"
  - Max label derived from `contextWindowSize`: 200000 → "200k", 1000000 → "1M"

### 3. Progress bar

- Track: `h-[5px] bg-surface rounded-full`
- Fill: `bg-primary-container`, width = `usedPercentage%`, `rounded-full`
- Fill glow: `box-shadow: 0 0 8px primary-container/40`

### 4. Token count labels

- Left: current tokens formatted (e.g., "94,720 tokens")
- Right: max formatted (e.g., "128k max")
- `font-mono text-[9px] text-on-surface-variant`

### Color shifts at high usage

When `usedPercentage >= 80`:

- Fill gradient shifts toward warning: `from-tertiary/50 to-tertiary`
- Progress bar fill: `bg-tertiary`
- Percentage text: `text-tertiary`

When `usedPercentage >= 90`:

- Fill gradient shifts to error: `from-error/50 to-error`
- Progress bar fill: `bg-error`
- Percentage text: `text-error`

### Null/loading state

When `usedPercentage` is null (before first API call):

- Show empty bucket (0% fill)
- Percentage text: "—"
- Token counts: "— tokens" / "max" label still shown

## Container styling

- Outer: `bg-surface-container-high/50 rounded-2xl p-3.5` with subtle border: `border border-primary-container/[0.08]`
- This matches the design reference

## Formatting helpers

```typescript
// Format token count for display
const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

// Format token count with commas for detail label
const formatTokensDetailed = (n: number): string => n.toLocaleString()

// Format context window size for scale label
const formatContextSize = (n: number): string => {
  if (n >= 1_000_000) return `${n / 1_000_000}M`
  return `${n / 1_000}k`
}
```

## Acceptance Criteria

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Tests: renders 0% fill when usedPercentage is null
- [ ] Tests: renders correct fill height at 50%, 74%, 90%
- [ ] Tests: emoji changes at thresholds (60, 80, 90)
- [ ] Tests: color shifts to warning at 80%+, error at 90%+
- [ ] Tests: formats 200000 → "200k", 1000000 → "1M"
- [ ] Tests: formats 94720 → "94,720 tokens" (detailed), "94.7k" (compact)
- [ ] Visual: bucket fill has CSS transition for smooth animation
- [ ] Visual: grid dot pattern visible as subtle texture
- [ ] Test file co-located: `ContextBucket.test.tsx`

## Notes

- The bucket gauge is purely CSS — no canvas or SVG needed
- The grid dot pattern uses CSS `radial-gradient` and doesn't affect interactivity
- Ensure the fill div uses `flex-direction: column; justify-content: flex-end` so it grows from the bottom
- This is the most visually distinctive component — match the reference closely
