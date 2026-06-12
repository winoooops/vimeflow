import type { ReactElement } from 'react'
import { LiquidFill } from './LiquidFill'
import {
  LIQUID_COLOR_ERROR,
  LIQUID_COLOR_PRIMARY_CONTAINER,
  LIQUID_COLOR_TERTIARY,
} from './liquidColors'

export interface ContextBucketProps {
  usedPercentage: number | null
  contextWindowSize: number
  totalInputTokens: number
  totalOutputTokens: number
}

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }

  return n.toString()
}

const formatTokensDetailed = (n: number): string => n.toLocaleString()

const formatContextSize = (n: number): string => {
  if (n >= 1_000_000) {
    return `${n / 1_000_000}M`
  }

  return `${n / 1_000}k`
}

const getEmoji = (pct: number | null): string => {
  if (pct === null || pct < 60) {
    return '\u{1F60A}'
  }
  if (pct < 80) {
    return '\u{1F610}'
  }
  if (pct < 90) {
    return '\u{1F61F}'
  }

  return '\u{1F975}'
}

type ColorTier = 'primary' | 'tertiary' | 'error'

const getColorTier = (pct: number | null): ColorTier => {
  if (pct !== null && pct >= 90) {
    return 'error'
  }
  if (pct !== null && pct >= 80) {
    return 'tertiary'
  }

  return 'primary'
}

const getTierColors = (
  pct: number | null
): { bar: string; text: string; hex: string } => {
  switch (getColorTier(pct)) {
    case 'error':
      return {
        bar: 'bg-error',
        text: 'text-error',
        hex: LIQUID_COLOR_ERROR,
      }
    case 'tertiary':
      return {
        bar: 'bg-tertiary',
        text: 'text-tertiary',
        hex: LIQUID_COLOR_TERTIARY,
      }
    case 'primary':
    default:
      return {
        bar: 'bg-primary-container',
        text: 'text-primary-container',
        hex: LIQUID_COLOR_PRIMARY_CONTAINER,
      }
  }
}

export const ContextBucket = ({
  usedPercentage,
  contextWindowSize,
  totalInputTokens,
  totalOutputTokens,
}: ContextBucketProps): ReactElement => {
  const pct = usedPercentage
  const effectivePct = pct ?? 0
  const tierColors = getTierColors(pct)
  const emoji = getEmoji(pct)
  const totalTokens = totalInputTokens + totalOutputTokens

  return (
    <div className="rounded-2xl border border-primary-container/[0.08] bg-surface-container-high/50 p-3.5">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant">
          <span role="img" aria-label="context status">
            {emoji}
          </span>{' '}
          CURRENT CONTEXT
        </span>
        <span
          className={`font-mono text-xs font-semibold ${pct !== null ? tierColors.text : 'text-outline'}`}
          data-testid="context-percentage"
        >
          {pct !== null ? `${Math.round(pct)}%` : '\u2014'}
        </span>
      </div>

      {/* Bucket gauge */}
      <div className="mb-2 flex h-[72px] gap-1.5">
        {/* Gauge */}
        <div
          className="relative flex flex-1 flex-col justify-end overflow-hidden rounded-lg bg-surface-container-low"
          data-testid="bucket-gauge"
        >
          {/* Grid dot pattern overlay */}
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              backgroundImage:
                'radial-gradient(circle, currentColor 0.5px, transparent 0.5px)',
              backgroundSize: '8px 8px',
              opacity: 0.04,
            }}
          />
          {/* Fill */}
          <LiquidFill
            mode="fill"
            pct={effectivePct}
            color={tierColors.hex}
            glow
            className="h-full w-full"
            testId="bucket-fill"
          />
        </div>

        {/* Scale */}
        <div className="flex flex-col justify-between py-0.5 font-mono text-[8px] text-outline">
          <span>{formatContextSize(contextWindowSize)}</span>
          <span className={pct !== null ? tierColors.text : 'text-outline'}>
            {pct !== null ? `${formatTokens(totalTokens)}` : '\u2014'}
          </span>
          <span>0k</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-[5px] overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${tierColors.bar}`}
          data-testid="progress-bar-fill"
          style={{
            width: `${effectivePct}%`,
            boxShadow:
              pct !== null && effectivePct > 0
                ? '0 0 8px var(--tw-shadow-color, color-mix(in srgb, var(--color-primary-container) 40%, transparent))'
                : 'none',
          }}
        />
      </div>

      {/* Token counts */}
      <div className="flex items-center justify-between font-mono text-[9px] text-on-surface-variant">
        <span data-testid="token-count-detail">
          {pct !== null
            ? `${formatTokensDetailed(totalTokens)} tokens`
            : '\u2014 tokens'}
        </span>
        <span>{formatContextSize(contextWindowSize)} max</span>
      </div>
    </div>
  )
}

export { formatTokens, formatContextSize }
