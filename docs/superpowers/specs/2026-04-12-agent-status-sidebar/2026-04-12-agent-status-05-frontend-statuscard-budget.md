# Sub-spec 5: Frontend StatusCard + BudgetMetrics

**Parent:** `CLAUDE.md`
**Depends on:** Sub-spec 4 (types + hook)
**Scope:** Agent identity card and adaptive budget metrics grid.

## Files to Create

```
src/features/agent-status/components/
├── StatusCard.tsx          // Agent identity + budget wrapper
└── BudgetMetrics.tsx       // Adaptive budget grid
```

## Files to Modify

- `src/features/agent-status/components/AgentStatusPanel.tsx` — render `StatusCard` as first child

## Design Reference

- Visual: `docs/design/agent_status_sidebar/code.html` — "Status Card with Budget" section
- Tailwind classes: extract from the reference HTML

## StatusCard

### Props

```typescript
interface StatusCardProps {
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  modelId: string | null
  modelDisplayName: string | null
  status: 'running' | 'paused' | 'completed' | 'errored'
  cost: CostState | null
  rateLimits: RateLimitsState | null
}
```

### Layout

1. **Agent identity row**: gradient icon placeholder + agent name (Manrope 800) + status indicator
2. **Status indicator**: colored dot + label. Running = `success` green with glow. Errored = `error` red.
3. **Model badge**: small text next to status, e.g., "opus-4-6" from `modelId`
4. **BudgetMetrics** component rendered below identity row

### Agent name mapping

```typescript
const agentNames: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  aider: 'Aider',
  generic: 'Agent',
}
```

## BudgetMetrics

### Props

```typescript
interface BudgetMetricsProps {
  cost: CostState | null
  rateLimits: RateLimitsState | null
  totalInputTokens: number
  totalOutputTokens: number
}
```

### Adaptive rendering

Detection: check `rateLimits` first (present = subscriber), then fall back to API key layout.

**Variant A — Claude.ai subscriber** (when `rateLimits` is not null):

- 5h rate limit bar: label "5h Limit" + percentage + thin progress bar
- 7d rate limit bar: same, only if `rateLimits.sevenDay` exists
- 1x2 grid below: API Time, Tokens (combined in/out)

**Variant B — API key user** (when `rateLimits` is null):

- 2x2 grid: Cost ($), API Time, Tokens In, Tokens Out
- Cost formatted: `$X.XX` (2 decimal places)
- API Time formatted: `X.Xs` (from `totalApiDurationMs / 1000`, 1 decimal)
- Tokens formatted: `X.Xk` for thousands (e.g., `94.7k`)

**Variant C — Fallback** (no cost data yet, no rate limits):

- 1x2 grid: Tokens In (0), Tokens Out (0)

### Styling

- Grid cells: `bg-surface-container` background, `rounded-lg`, `px-2.5 py-2`
- Labels: `text-[8px] font-bold text-outline uppercase tracking-[0.08em]`
- Values: `text-sm font-mono font-semibold`
- Cost value uses `text-primary` color, others use `text-on-surface`
- Rate limit bar: `h-[3px]`, track `bg-surface`, fill `bg-primary-container`

## Acceptance Criteria

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Tests: StatusCard renders agent name and status correctly
- [ ] Tests: BudgetMetrics renders subscriber variant when rateLimits provided
- [ ] Tests: BudgetMetrics renders API key variant when only cost provided
- [ ] Tests: BudgetMetrics renders fallback when neither provided
- [ ] Token formatting works: 0 → "0", 1500 → "1.5k", 94720 → "94.7k"
- [ ] Cost formatting: 0.42 → "$0.42", 0 → "$0.00"
- [ ] API time formatting: 2300 → "2.3s"
- [ ] Test files co-located

## Notes

- Reuse the existing `getStatusConfig` pattern from `src/features/workspace/components/AgentActivity/StatusCard.tsx` for status dot colors — but extend it, don't import (the old component stays until cleanup)
- The gradient icon is a placeholder `div` with `bg-gradient-to-br from-primary-container to-secondary` — not a real logo image
