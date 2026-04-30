import type { ReactElement } from 'react'
import type { CurrentUsageState } from '../types'
import {
  cacheBuckets,
  cacheHitRate,
  cacheTone,
  type CacheTone,
} from '../utils/cacheRate'
import { formatTokens } from './BudgetMetrics'

// Pulse animation: use Tailwind's built-in `animate-pulse` to match the
// existing pulse-dot pattern (ActivityEvent.tsx:180, ToolCallSummary.tsx:45,
// FileStatusBar.tsx:37). Do NOT import `stateToken` from docs/design/tokens —
// that file is the design reference, not a runtime token source, and is not
// imported anywhere in src/.

export interface TokenCacheProps {
  usage: CurrentUsageState | null
}

const TONE_TEXT: Record<CacheTone, string> = {
  healthy: 'text-success',
  warming: 'text-primary-container',
  cold: 'text-tertiary',
}

const TONE_BG: Record<CacheTone, string> = {
  healthy: 'bg-success',
  warming: 'bg-primary-container',
  cold: 'bg-tertiary',
}

const StackBar = ({
  cached,
  wrote,
  fresh,
  total,
}: {
  cached: number
  wrote: number
  fresh: number
  total: number
}): ReactElement => {
  if (total === 0) {
    // Tonal empty band — no segments, no border. Per UNIFIED.md §8
    // ("1px borders for sectioning — tonal shift only") and DESIGN.md §23
    // (ghost borders only at 15% opacity), the empty state uses a slightly
    // raised tonal background instead of a full-opacity outline.
    return (
      <div
        data-testid="token-cache-stack-empty"
        className="h-1.5 w-full rounded-full bg-surface-container-high"
      />
    )
  }

  const cachedPct = (cached / total) * 100
  const wrotePct = (wrote / total) * 100
  const freshPct = (fresh / total) * 100

  return (
    <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full">
      <div
        data-testid="token-cache-stack-cached"
        className="bg-success"
        style={{ width: `${cachedPct}%` }}
      />
      <div
        data-testid="token-cache-stack-wrote"
        className="bg-primary-container"
        style={{ width: `${wrotePct}%` }}
      />
      <div
        data-testid="token-cache-stack-fresh"
        className="bg-tertiary"
        style={{ width: `${freshPct}%` }}
      />
    </div>
  )
}

const StatCell = ({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint: string
  testId: string
}): ReactElement => (
  <div className="flex flex-col gap-1 rounded-lg bg-surface-container px-2.5 py-2">
    <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
      {label}
    </span>
    <span
      data-testid={testId}
      className="font-mono text-sm font-semibold tabular-nums text-on-surface"
    >
      {value}
    </span>
    <span className="text-[8px] text-outline-variant">{hint}</span>
  </div>
)

export const TokenCache = ({ usage }: TokenCacheProps): ReactElement => {
  const buckets = cacheBuckets(usage)
  const rate = cacheHitRate(usage)
  const tone = cacheTone(rate)
  const isEmpty = rate === null

  return (
    <div
      data-testid="token-cache"
      className="flex flex-col gap-2 rounded-lg bg-surface-container-low px-2.5 py-2"
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-outline">
        Token Cache
      </span>

      <StackBar {...buckets} />

      <div className="flex items-center gap-2">
        <span
          data-testid="token-cache-percent"
          data-tone={tone ?? 'empty'}
          className={`font-mono text-[2.25rem] leading-none font-semibold tabular-nums ${
            tone ? TONE_TEXT[tone] : 'text-outline-variant'
          }`}
        >
          {isEmpty ? '—' : `${Math.round(rate * 100)}%`}
        </span>
        {!isEmpty && tone ? (
          <span
            data-testid="token-cache-pulse"
            className={`h-2 w-2 animate-pulse rounded-full ${TONE_BG[tone]}`}
          />
        ) : null}
      </div>

      <span
        className={`text-[8px] font-bold uppercase tracking-[0.08em] ${
          isEmpty ? 'text-outline-variant' : 'text-outline'
        }`}
      >
        {isEmpty ? 'no data yet' : 'cached this turn'}
      </span>

      <div className="grid grid-cols-3 gap-2">
        <StatCell
          label="cached"
          value={formatTokens(buckets.cached)}
          hint="free reuse"
          testId="token-cache-stat-cached"
        />
        <StatCell
          label="wrote"
          value={formatTokens(buckets.wrote)}
          hint="uploaded"
          testId="token-cache-stat-wrote"
        />
        <StatCell
          label="fresh"
          value={formatTokens(buckets.fresh)}
          hint="new tokens"
          testId="token-cache-stat-fresh"
        />
      </div>
    </div>
  )
}

export default TokenCache
