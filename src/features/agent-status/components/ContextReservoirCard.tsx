import type { CSSProperties, ReactElement } from 'react'
import { useTheme } from '@/theme/useTheme'
import { WaterTank } from './WaterTank'
import { resolveContextTone, tankChrome } from '../utils/contextTone'

export interface ContextReservoirCardProps {
  usedPercentage: number | null
  contextWindowSize: number
}

// Compact token label: `1M` / `562k` / `999`. Distinct from utils/format's
// one-decimal `formatTokens` — the reservoir scale/pill want a tight, rounded
// reading.
const compactTokens = (n: number): string => {
  if (n >= 1_000_000) {
    const decimals = n % 1_000_000 === 0 ? 0 : 1

    return `${(n / 1_000_000).toFixed(decimals)}M`
  }
  if (n >= 1_000) {
    const k = Math.round(n / 1_000)

    // Guard the boundary: 999,500–999,999 rounds to 1000k — show 1M instead.
    return k >= 1000 ? '1M' : `${k}k`
  }

  return `${n}`
}

const formatTokenCount = (n: number): string => n.toLocaleString('en-US')

const DASH = '—'

// cspell:ignore seafoam
/**
 * Context window as a reservoir: the budget is a tank of resource and the
 * bounding waterline is how full it is. Color is the continuous seafoam ->
 * gold -> coral -> rose `ctxTone` sweep keyed to fill (shared with the
 * collapsed rail meter). No emoji — the degrading faces live in the bottom
 * status bar.
 */
export const ContextReservoirCard = ({
  usedPercentage,
  contextWindowSize,
}: ContextReservoirCardProps): ReactElement => {
  const pct = usedPercentage
  const mode = useTheme().kind
  const effectivePct = pct ?? 0
  const tone = resolveContextTone(effectivePct, mode)
  const chrome = tankChrome(mode)

  // Current context occupancy in tokens, reconstructed from the authoritative
  // fill % so the pill, footer count, and headroom all agree with the
  // waterline. (totalInput/Output exclude cache reads and are not the window
  // occupancy, so deriving headroom from them would contradict the tank.)
  const used = Math.round(contextWindowSize * (effectivePct / 100))
  const headroom = contextWindowSize - used

  // Pill rides the waterline (shares the tank's 2% visibility floor).
  const visibleWaterPct =
    effectivePct <= 0 ? 2 : Math.min(100, Math.max(2, effectivePct))
  const waterlineTopPct = (1 - visibleWaterPct / 100) * 100

  // Card chrome matches the sibling TokenCache directly below it in the panel
  // (radius 10, 135deg tone wash, tinted border, no elevation) so the two
  // stacked cards read as one family — keyed here to the live context tone.
  const cardStyle: CSSProperties = {
    borderRadius: 10,
    border: `1px solid color-mix(in srgb, ${tone.base} 15%, transparent)`,
    background: `linear-gradient(135deg, color-mix(in srgb, ${tone.base} ${mode === 'light' ? 11 : 8}%, transparent), color-mix(in srgb, var(--color-surface-container-lowest) 50%, transparent))`,
  }

  // Screen readers announce this as a meter — the context window as a value
  // within a fixed 0-100 range. The visible tank/number are its presentation.
  const valueText =
    pct === null
      ? 'Context usage unknown'
      : `${Math.round(pct)}% used · ${formatTokenCount(used)} of ${formatTokenCount(contextWindowSize)} tokens · ${compactTokens(headroom)} left`

  return (
    <div
      role="meter"
      aria-label="Context window usage"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      aria-valuetext={valueText}
      className="cursor-default overflow-hidden"
      style={cardStyle}
    >
      <div className="px-3.5 pb-3.5 pt-3">
        {/* Header — water-drop identity chip + label + big % */}
        <div className="mb-[11px] flex items-center gap-[9px]">
          <span
            className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-md"
            style={{
              background: `color-mix(in srgb, ${tone.base} 16%, transparent)`,
              color: tone.label,
            }}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[13px] leading-none"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              water_drop
            </span>
          </span>
          <span className="flex-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface-muted">
            Context
          </span>
          <span
            className={`font-display text-[18px] font-bold leading-none tracking-[-0.01em] tabular-nums ${pct === null ? 'text-outline' : ''}`}
            style={pct !== null ? { color: tone.bigNum } : undefined}
          >
            {pct !== null ? (
              <>
                {Math.round(pct)}
                <span className="text-[11px] font-semibold opacity-70">%</span>
              </>
            ) : (
              DASH
            )}
          </span>
        </div>

        {/* Tank with top scale tick + floating waterline value */}
        <div className="relative">
          <WaterTank pct={effectivePct} theme={mode} empty={pct === null} />

          <span
            className="pointer-events-none absolute right-[7px] top-[6px] font-mono text-[8.5px] font-semibold tracking-[0.04em]"
            style={{ color: chrome.tick }}
          >
            {compactTokens(contextWindowSize)}
          </span>

          {pct !== null && (
            <div
              data-testid="context-pill"
              className="pointer-events-none absolute right-[6px] inline-flex -translate-y-1/2 items-center rounded-[5px] px-[6px] py-[1.5px] font-mono text-[9.5px] font-semibold"
              style={{
                top: `${waterlineTopPct}%`,
                background: chrome.pillBg,
                backdropFilter: 'blur(3px)',
                WebkitBackdropFilter: 'blur(3px)',
                border: `1px solid color-mix(in srgb, ${tone.base} 40%, transparent)`,
                color: tone.pillText,
                whiteSpace: 'nowrap',
                boxShadow: `0 2px 8px ${chrome.pillShadow}`,
              }}
            >
              {compactTokens(used)}
            </div>
          )}
        </div>

        {/* Footer — used tokens + headroom remaining */}
        <div className="mt-[11px] flex items-baseline gap-[6px]">
          <span data-testid="token-count-detail" className="font-mono">
            <span className="text-[11px] font-semibold tabular-nums text-on-surface-variant">
              {pct !== null ? formatTokenCount(used) : DASH}
            </span>
            <span className="text-[9.5px] text-on-surface-muted"> tokens</span>
          </span>
          <span className="flex-1" />
          <span
            data-testid="context-headroom"
            className={`font-mono text-[9.5px] ${pct === null ? 'text-on-surface-muted' : ''}`}
            style={pct !== null ? { color: tone.leftText } : undefined}
          >
            {pct !== null ? `${compactTokens(headroom)} left` : DASH}
          </span>
        </div>
      </div>
    </div>
  )
}

export { compactTokens }
