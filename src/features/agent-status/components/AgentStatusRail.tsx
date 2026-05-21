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

const contextTone = (pct: number, accent: string): string => {
  if (pct > 90) {
    return '#ff94a5'
  }
  if (pct > 75) {
    return '#ffb4ab'
  }

  return accent
}

const cacheTone = (rate: number): string => {
  if (rate >= 70) {
    return '#7defa1'
  }
  if (rate >= 40) {
    return '#e2c7ff'
  }

  return '#ff94a5'
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
          uid={`ctx-${agent.id}`}
          title={`Context: ${Math.round(ctxPct)}%`}
        />
      )}

      {cachePct !== null && (
        <div className="mt-4">
          <Bucket
            pct={cachePct}
            color={cacheTone(cachePct)}
            label="CACHE"
            uid={`cache-${agent.id}`}
            title={`Cache hit rate: ${Math.round(cachePct)}%`}
          />
        </div>
      )}

      <span className="flex-1" />

      {isRunning && (
        <span
          data-testid="running-dot"
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{
            background: agent.accent,
            boxShadow: `0 0 10px ${agent.accent}`,
          }}
        />
      )}
    </aside>
  )
}
