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
  healthy: '#7defa1',
  warming: '#e2c7ff',
  cold: '#ff94a5',
}

const TONE_TINT: Record<CacheTone, string> = {
  healthy: 'rgba(125,239,161,0.06)',
  warming: 'rgba(203,166,247,0.06)',
  cold: 'rgba(255,148,165,0.06)',
}

// Kit formatter — one decimal at >=1k (8.4k, 2.0k), raw below.
const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const cachedShareHex = (sharePct: number): string =>
  sharePct >= 70 ? '#7defa1' : sharePct >= 40 ? '#cba6f7' : '#ff94a5'

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
        style={{ background: 'rgba(74,68,79,0.25)' }}
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
        background: 'rgba(13,13,28,0.6)',
        border: '1px solid rgba(74,68,79,0.25)',
      }}
    >
      <div
        data-testid="token-cache-stack-cached"
        style={{
          width: `${cPct}%`,
          background: `linear-gradient(90deg, ${cTone}, ${cTone}cc)`,
          boxShadow: `inset 0 0 6px ${cTone}55`,
        }}
      />
      <div
        data-testid="token-cache-stack-wrote"
        style={{
          width: `${wPct}%`,
          background: 'linear-gradient(90deg, #a8c8ff, #8aa9d8)',
        }}
      />
      <div
        data-testid="token-cache-stack-fresh"
        style={{ width: `${fPct}%`, background: 'rgba(205,195,209,0.4)' }}
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
    <div data-testid={testId} className="flex flex-col gap-0.5">
      <span
        className="text-[11.5px] font-semibold tabular-nums text-on-surface"
        style={{ fontFamily: JETBRAINS }}
      >
        {value}
      </span>
      <span
        className="text-[9px] uppercase tracking-[0.06em] text-on-surface-muted"
        style={{ fontFamily: JETBRAINS }}
      >
        {label}
      </span>
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
    border: `1px solid ${toneHex}26`,
    background: `linear-gradient(135deg, ${TONE_TINT[tone]}, rgba(13,13,28,0.5))`,
  }

  return (
    <div data-testid="token-cache" className="flex flex-col gap-2.5">
      <div
        className="px-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-muted"
        style={{ fontFamily: JETBRAINS }}
      >
        Token cache
      </div>

      <div className="overflow-hidden" style={cardStyle}>
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
            borderTop: '1px solid rgba(74,68,79,0.2)',
            background: 'rgba(13,13,28,0.25)',
          }}
        >
          <StackBar {...buckets} />
          <div className="mt-2.5 grid grid-cols-3 gap-2">
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
          </div>
        </div>
      </div>
    </div>
  )
}
