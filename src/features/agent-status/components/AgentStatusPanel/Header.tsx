import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import type { SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'

export interface AgentStatusPanelHeaderProps {
  agent: Agent
  isRefreshing?: boolean
  status: SessionStatus
  onCollapse: () => void
}

export const AgentStatusPanelHeader = ({
  agent,
  isRefreshing = false,
  status,
  onCollapse,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className="relative flex h-11 shrink-0 items-center gap-2.5 px-2 pr-2 pl-3.5"
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      data-refreshing={isRefreshing ? 'true' : 'false'}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border font-mono text-xs font-bold ${isRefreshing ? 'vf-activity-glyph-refresh' : ''}`}
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      {agent.glyph}
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-headline text-[13px] font-semibold text-on-surface">
          {agent.short}
        </span>
        <StatusDot status={status} size={6} aria-label={`agent ${status}`} />
        {isRefreshing && (
          <span
            className="material-symbols-outlined text-[11px] text-on-surface-muted motion-safe:animate-spin"
            aria-hidden="true"
          >
            sync
          </span>
        )}
      </div>
      <span className="h-3 truncate font-mono text-[10px] leading-3 text-on-surface-muted">
        {isRefreshing ? 'fetching latest' : 'updated now'}
      </span>
    </div>
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse activity panel"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-base">chevron_right</span>
    </button>
    <div
      className="absolute right-0 bottom-0 left-0 h-px overflow-hidden bg-outline-variant/25"
      aria-hidden="true"
    >
      {isRefreshing && <div className="vf-activity-refresh-comet h-full" />}
    </div>
  </div>
)
