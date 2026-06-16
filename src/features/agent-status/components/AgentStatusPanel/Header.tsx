import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import type { Agent } from '../../../../agents/registry'
import type { SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'

export interface AgentStatusPanelHeaderProps {
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
  reserveWindowControls?: boolean
}

export const AgentStatusPanelHeader = ({
  agent,
  status,
  onCollapse,
  reserveWindowControls = false,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className={`flex items-center gap-2.5 px-3 py-2.5 ${
      reserveWindowControls ? 'vf-app-drag-region' : ''
    }`}
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md font-mono text-[13px] font-bold"
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      {agent.glyph}
    </div>
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="font-headline text-[13px] font-semibold text-on-surface">
        {agent.short}
      </span>
      <StatusDot status={status} size={6} aria-label={`agent ${status}`} />
    </div>
    <IconButton
      icon="chevron_right"
      label="Collapse activity panel"
      onClick={onCollapse}
      className="vf-app-no-drag shrink-0"
    />
  </div>
)
