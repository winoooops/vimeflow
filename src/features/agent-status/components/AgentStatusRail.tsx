import type { ReactElement } from 'react'
import type { Agent } from '../../../agents/registry'
import { Bucket } from './Bucket'

export interface AgentStatusRailProps {
  agent: Agent
  contextUsedPercentage: number | null
  cacheHitRate: number | null
  isRunning: boolean
  onExpand: () => void
}

const RAIL_WIDTH_PX = 44

// Bucket fill tones — semantic mapping per the bucket-redesign spec.
// These literals mirror tokens defined in `docs/design/tokens.ts`
// (semantic.tertiary, semantic.error, semantic.successMuted, primary.base);
// `tokens.ts` is the design reference and is NOT imported from `src/` (see
// the rationale in `TokenCache.tsx`). If the palette migrates, update these
// constants in lockstep with tokens.ts.
const TONE_DANGER = '#ff94a5' // semantic.tertiary
const TONE_WARN = '#ffb4ab' // semantic.error
const TONE_HEALTHY = '#7defa1' // semantic.successMuted
const TONE_NEUTRAL = '#e2c7ff' // primary.base

const contextTone = (pct: number, accent: string): string => {
  if (pct > 90) {
    return TONE_DANGER
  }
  if (pct > 75) {
    return TONE_WARN
  }

  return accent
}

const cacheTone = (rate: number): string => {
  if (rate >= 70) {
    return TONE_HEALTHY
  }
  if (rate >= 40) {
    return TONE_NEUTRAL
  }

  return TONE_DANGER
}

export const AgentStatusRail = ({
  agent,
  contextUsedPercentage,
  cacheHitRate,
  isRunning,
  onExpand,
}: AgentStatusRailProps): ReactElement => {
  const ctxPct = contextUsedPercentage
  const cachePct = cacheHitRate

  return (
    <aside
      data-testid="agent-status-rail"
      className="flex h-full flex-col items-center bg-surface-container pb-3 pt-2"
      style={{ width: RAIL_WIDTH_PX }}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand activity panel"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-on-surface-muted transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">
          chevron_left
        </span>
      </button>

      <div
        data-testid="agent-glyph-chip"
        className="mb-3 mt-2 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border font-mono text-[12px] font-bold"
        style={{
          background: agent.accentDim,
          color: agent.accent,
          borderColor: agent.accentSoft,
        }}
      >
        {agent.glyph}
      </div>

      {ctxPct !== null && (
        <Bucket
          pct={ctxPct}
          color={contextTone(ctxPct, agent.accent)}
          label="CTX"
          title={`Context: ${Math.round(ctxPct)}%`}
        />
      )}

      {cachePct !== null && (
        <div className="mt-4">
          <Bucket
            pct={cachePct}
            color={cacheTone(cachePct)}
            label="CACHE"
            title={`Cache hit rate: ${Math.round(cachePct)}%`}
          />
        </div>
      )}

      <span className="flex-1" />

      {isRunning && (
        <span
          data-testid="running-dot"
          className="h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
          style={{
            background: agent.accent,
            boxShadow: `0 0 10px ${agent.accent}`,
          }}
        />
      )}
    </aside>
  )
}
