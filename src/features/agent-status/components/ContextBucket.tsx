import type { ReactElement } from 'react'

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

const getColorClass = (
  pct: number | null
): { fill: string; bar: string; text: string } => {
  if (pct !== null && pct >= 90) {
    return {
      fill: 'from-error/50 to-error',
      bar: 'bg-error',
      text: 'text-error',
    }
  }
  if (pct !== null && pct >= 80) {
    return {
      fill: 'from-tertiary/50 to-tertiary',
      bar: 'bg-tertiary',
      text: 'text-tertiary',
    }
  }

  return {
    fill: 'from-primary-container/50 to-primary-container',
    bar: 'bg-primary-container',
    text: 'text-primary-container',
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
  const colors = getColorClass(pct)
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
          className={`font-mono text-xs font-semibold ${pct !== null ? colors.text : 'text-outline'}`}
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
          <div
            className={`relative w-full bg-gradient-to-t ${colors.fill}`}
            data-testid="bucket-fill"
            style={{
              height: `${effectivePct}%`,
              transition: 'height 500ms ease',
              boxShadow:
                pct !== null && effectivePct > 0
                  ? '0 -4px 12px var(--tw-shadow-color, rgba(203, 166, 247, 0.25))'
                  : 'none',
            }}
          />
        </div>

        {/* Scale */}
        <div className="flex flex-col justify-between py-0.5 font-mono text-[8px] text-outline">
          <span>{formatContextSize(contextWindowSize)}</span>
          <span className={pct !== null ? colors.text : 'text-outline'}>
            {pct !== null ? `${formatTokens(totalTokens)}` : '\u2014'}
          </span>
          <span>0k</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-[5px] overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${colors.bar}`}
          data-testid="progress-bar-fill"
          style={{
            width: `${effectivePct}%`,
            boxShadow:
              pct !== null && effectivePct > 0
                ? '0 0 8px var(--tw-shadow-color, rgba(203, 166, 247, 0.4))'
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

export { formatTokens, formatTokensDetailed, formatContextSize }
