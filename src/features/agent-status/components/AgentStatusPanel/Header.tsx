import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { AgentGlyph } from '@/components/AgentGlyph'
import type { SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'

export interface AgentStatusPanelHeaderProps {
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
}

export const AgentStatusPanelHeader = ({
  agent,
  status,
  onCollapse,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className="flex items-center gap-2.5 px-3 py-2.5"
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md font-mono text-[13px] font-bold"
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      <AgentGlyph agent={agent} size={14} />
    </div>
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="font-headline text-[13px] font-semibold text-on-surface">
        {agent.short}
      </span>
      <StatusDot status={status} size={6} aria-label={`agent ${status}`} />
    </div>
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse activity panel"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-base">chevron_right</span>
    </button>
  </div>
)
