import type { CSSProperties, ReactElement } from 'react'
import type { CurrentUsageState } from '../types'
import {
  cacheBuckets,
  cacheToneFromPercent,
  type CacheTone,
} from '../utils/cacheRate'
import { Sparkline } from './Sparkline'
import { Tooltip } from '../../../components/Tooltip'

export interface TokenCacheProps {
  usage: CurrentUsageState | null
  history: number[]
}

const JETBRAINS = "'JetBrains Mono', monospace"

const TONE_HEX: Record<CacheTone, string> = {
  healthy: 'var(--color-agent-codex-accent)',
  warming: 'var(--color-primary)',
  cold: 'var(--color-tertiary)',
}

const TONE_TINT: Record<CacheTone, string> = {
  healthy:
    'color-mix(in srgb, var(--color-agent-codex-accent) 6%, transparent)',
  warming: 'color-mix(in srgb, var(--color-primary-container) 6%, transparent)',
  cold: 'color-mix(in srgb, var(--color-tertiary) 6%, transparent)',
}

// Kit formatter — one decimal at >=1k (8.4k, 2.0k), raw below.
const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const cachedShareHex = (sharePct: number): string =>
  sharePct >= 70
    ? 'var(--color-agent-codex-accent)'
    : sharePct >= 40
      ? 'var(--color-primary-container)'
      : 'var(--color-tertiary)'

const WROTE_STACK_GRADIENT =
  'linear-gradient(90deg, var(--color-secondary), color-mix(in srgb, var(--color-secondary) 70%, var(--color-surface-container)))'

const FRESH_STACK_GRADIENT =
  'linear-gradient(90deg, var(--color-warning), color-mix(in srgb, var(--color-warning) 70%, var(--color-surface-container)))'

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
    return (
      <div
        data-testid="token-cache-stack-empty"
        className="h-2 w-full rounded-full"
        style={{
          background:
            'color-mix(in srgb, var(--color-outline-variant) 25%, transparent)',
        }}
      />
    )
  }

  const cPct = (cached / total) * 100
  const wPct = (wrote / total) * 100
  const fPct = (fresh / total) * 100
  const cTone = cachedShareHex(cPct)

  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full"
      style={{
        background:
          'color-mix(in srgb, var(--color-surface-container-lowest) 60%, transparent)',
        border:
          '1px solid color-mix(in srgb, var(--color-outline-variant) 25%, transparent)',
      }}
    >
      <div
        data-testid="token-cache-stack-cached"
        style={{
          width: `${cPct}%`,
          background: `linear-gradient(90deg, ${cTone}, color-mix(in srgb, ${cTone} 80%, transparent))`,
          boxShadow: `inset 0 0 6px color-mix(in srgb, ${cTone} 33%, transparent)`,
        }}
      />
      <div
        data-testid="token-cache-stack-wrote"
        style={{
          width: `${wPct}%`,
          background: WROTE_STACK_GRADIENT,
        }}
      />
      <div
        data-testid="token-cache-stack-fresh"
        style={{
          width: `${fPct}%`,
          background: FRESH_STACK_GRADIENT,
        }}
      />
    </div>
  )
}

const StatCell = ({
  label,
  value,
  tooltip,
  testId,
}: {
  label: string
  value: string
  tooltip: string
  testId: string
}): ReactElement => (
  <Tooltip content={tooltip} placement="bottom">
    <div data-testid={testId} className="flex cursor-pointer flex-col gap-0.5">
      <dd
        className="text-[11.5px] font-semibold tabular-nums text-on-surface"
        style={{ fontFamily: JETBRAINS }}
      >
        {value}
      </dd>
      <dt
        className="text-[9px] uppercase tracking-[0.06em] text-on-surface-muted"
        style={{ fontFamily: JETBRAINS }}
      >
        {label}
      </dt>
    </div>
  </Tooltip>
)

export const TokenCache = ({
  usage,
  history,
}: TokenCacheProps): ReactElement => {
  const buckets = cacheBuckets(usage)

  const pct =
    buckets.total > 0 ? Math.round((buckets.cached / buckets.total) * 100) : 0
  const tone = cacheToneFromPercent(pct)
  const toneHex = TONE_HEX[tone]

  const cardStyle: CSSProperties = {
    borderRadius: 10,
    border: `1px solid color-mix(in srgb, ${toneHex} 15%, transparent)`,
    background: `linear-gradient(135deg, ${TONE_TINT[tone]}, color-mix(in srgb, var(--color-surface-container-lowest) 50%, transparent))`,
  }

  return (
    <div
      data-testid="token-cache"
      className="cursor-default overflow-hidden"
      style={cardStyle}
    >
      <div className="flex items-end gap-3 px-3.5 py-3">
        <div>
          <div className="flex items-baseline gap-1">
            <span
              data-testid="token-cache-percent"
              data-tone={tone}
              className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-on-surface"
            >
              {pct}
            </span>
            <span
              className="text-[13px] font-semibold"
              style={{ fontFamily: JETBRAINS, color: toneHex }}
            >
              %
            </span>
          </div>
          <div
            className="mt-0.5 text-[9.5px] uppercase tracking-[0.06em] text-on-surface-muted"
            style={{ fontFamily: JETBRAINS }}
          >
            cached this turn
          </div>
        </div>
        <div className="h-9 min-w-0 flex-1">
          <Sparkline data={history} color={toneHex} />
        </div>
      </div>

      <div
        style={{
          padding: '11px 14px 13px',
          borderTop:
            '1px solid color-mix(in srgb, var(--color-outline-variant) 20%, transparent)',
          background:
            'color-mix(in srgb, var(--color-surface-container-lowest) 25%, transparent)',
        }}
      >
        <StackBar {...buckets} />
        <dl className="mt-2.5 grid grid-cols-3 gap-2">
          <StatCell
            label="cached"
            value={fmt(buckets.cached)}
            tooltip="Tokens reused from the prompt cache — free, no new cost"
            testId="token-cache-stat-cached"
          />
          <StatCell
            label="wrote"
            value={fmt(buckets.wrote)}
            tooltip="Tokens written to the prompt cache this turn"
            testId="token-cache-stat-wrote"
          />
          <StatCell
            label="fresh"
            value={fmt(buckets.fresh)}
            tooltip="Brand-new tokens sent this turn — full price"
            testId="token-cache-stat-fresh"
          />
        </dl>
      </div>
    </div>
  )
}
