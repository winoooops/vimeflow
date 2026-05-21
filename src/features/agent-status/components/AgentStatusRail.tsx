import type { CSSProperties, ReactElement } from 'react'
import type { Agent } from '../../../agents/registry'
import { vendorMarkFor } from '../../../agents/registry'

export interface AgentStatusRailProps {
  agent: Agent
  contextUsedPercentage: number | null
  isRunning: boolean
  onExpand: () => void
}

const RAIL_WIDTH_PX = 36

const VERTICAL_LABEL_STYLE: CSSProperties = {
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
}

export const AgentStatusRail = ({
  agent,
  contextUsedPercentage,
  isRunning,
  onExpand,
}: AgentStatusRailProps): ReactElement => {
  const mark = vendorMarkFor(agent.id)
  const pct = contextUsedPercentage
  const warning = (pct ?? 0) > 85
  const labelText = pct === null ? '-- ctx' : `${Math.round(pct)}% ctx`

  return (
    <aside
      data-testid="agent-status-rail"
      className="flex h-full flex-col items-center gap-2.5 bg-surface-container py-2.5"
      style={{ width: RAIL_WIDTH_PX }}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand activity panel"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">
          chevron_left
        </span>
      </button>

      {mark !== null && (
        <span
          data-testid="vendor-mark"
          aria-hidden="true"
          className="block h-3.5 w-3.5 bg-current text-outline-variant"
          style={{
            maskImage: `url(${mark})`,
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
            maskPosition: 'center',
            WebkitMaskImage: `url(${mark})`,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
          }}
        />
      )}

      <div
        data-testid="agent-glyph-chip"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md font-mono text-[12px] font-bold"
        style={{ background: agent.accentDim, color: agent.accent }}
      >
        {agent.glyph}
      </div>

      <div
        data-testid="context-bar-track"
        className="relative h-16 w-1 overflow-hidden rounded-full bg-outline/30"
      >
        {pct !== null &&
          (warning ? (
            <div
              data-testid="context-bar-fill"
              className="absolute bottom-0 left-0 right-0 bg-error"
              style={{ height: `${pct}%` }}
            />
          ) : (
            <div
              data-testid="context-bar-fill"
              className="absolute bottom-0 left-0 right-0"
              style={{ height: `${pct}%`, background: agent.accent }}
            />
          ))}
      </div>

      <span
        data-testid="context-pct-label"
        className="font-mono text-[9px] text-on-surface-muted"
        style={VERTICAL_LABEL_STYLE}
      >
        {labelText}
      </span>

      <span className="flex-1" />

      {isRunning && (
        <span
          data-testid="running-dot"
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{
            background: agent.accent,
            boxShadow: `0 0 8px ${agent.accent}`,
          }}
        />
      )}
    </aside>
  )
}
