import type { ReactElement } from 'react'
import type { Agent } from '../../../agents/registry'
import { AgentGlyph } from '@/components/AgentGlyph'
import { RailMeter } from './RailMeter'
import { CacheRing } from './CacheRing'
import { ctxTone } from '../utils/contextTone'

export interface AgentStatusRailProps {
  agent: Agent
  contextUsedPercentage: number | null
  cacheHitPercentage: number | null
  reserveWindowControls?: boolean
}

// Exported so WorkspaceView can drive the `transition-[width]` animation on
// the activity-panel shell against the rail's actual width, instead of a
// duplicated magic number that can drift if the rail is resized.
export const RAIL_WIDTH_PX = 44

// Cache-bucket fill tones — semantic mapping per the bucket-redesign spec.
// These literals mirror tokens in `docs/design/tokens.ts` (success-muted,
// primary, tertiary); `tokens.ts` is the design reference and is NOT imported
// from `src/` (see the rationale in `TokenCache.tsx`). If the palette migrates,
// update these in lockstep. The context meter no longer uses tiered tokens —
// it shares the continuous `ctxTone` sweep with the expanded reservoir card so
// the context color agrees across collapsed and expanded states.
const TONE_DANGER = 'var(--color-tertiary)' // tertiary (strong pink, low cache)
const TONE_HEALTHY = 'var(--color-success-muted)' // success-muted (high cache)
const TONE_NEUTRAL = 'var(--color-primary)' // primary (mid cache)

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
  cacheHitPercentage,
  reserveWindowControls = false,
}: AgentStatusRailProps): ReactElement => {
  const ctxPct = contextUsedPercentage
  const cachePct = cacheHitPercentage

  return (
    <aside
      data-testid="agent-status-rail"
      className={`relative flex h-full flex-col items-center bg-surface pb-3 pt-[40px] ${
        reserveWindowControls ? 'vf-app-drag-region' : ''
      }`}
      style={{ width: RAIL_WIDTH_PX }}
    >
      {/* No-drag clearance for the workspace-root activity toggle that floats
          above this rail (top:7/right:8/28²). The floating toggle is a sibling
          of the drag region, so it cannot subtract from it on its own — this
          descendant span carves the hole, mirroring the sidebar toggle. */}
      {reserveWindowControls && (
        <span
          aria-hidden="true"
          data-testid="activity-toggle-clearance"
          className="vf-app-no-drag pointer-events-none absolute"
          style={{ top: 7, right: 8, width: 28, height: 28 }}
        />
      )}

      <div
        data-testid="agent-glyph-chip"
        className="mb-3 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border font-mono text-[12px] font-bold"
        style={{
          background: agent.accentDim,
          color: agent.accent,
          borderColor: agent.accentSoft,
        }}
      >
        <AgentGlyph agent={agent} size={14} />
      </div>

      {ctxPct !== null && (
        <div className="vf-app-no-drag">
          <RailMeter
            pct={ctxPct}
            color={ctxTone(ctxPct).base}
            label="CTX"
            tooltip={`Context: ${Math.round(ctxPct)}%`}
          />
        </div>
      )}

      {cachePct !== null && (
        <div className="vf-app-no-drag mt-4">
          <CacheRing pct={cachePct} color={cacheTone(cachePct)} />
        </div>
      )}

      <span className="flex-1" />
    </aside>
  )
}
