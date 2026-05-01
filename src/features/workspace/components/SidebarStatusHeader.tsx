import type { ReactElement } from 'react'
import { StatusCard } from '../../agent-status/components/StatusCard'
import type {
  AgentStatus,
  CostState,
  RateLimitsState,
} from '../../agent-status/types'

export interface SidebarStatusHeaderProps {
  status: AgentStatus
  activeSessionName: string | null
}

interface ActiveCardProps {
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  modelId: string | null
  modelDisplayName: string | null
  status: 'running' | 'paused' | 'completed' | 'errored'
  cost: CostState | null
  rateLimits: RateLimitsState | null
  totalInputTokens: number
  totalOutputTokens: number
}

const mapStatusToCardProps = (
  status: AgentStatus & {
    agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
  }
): ActiveCardProps => ({
  agentType: status.agentType,
  modelId: status.modelId,
  modelDisplayName: status.modelDisplayName,
  // The StatusType discriminator does not yet have a feed from
  // AgentStatus — see spec section 5.1. Hard-coded to 'running' to
  // mirror the existing AgentStatusPanel behavior.
  status: 'running',
  cost: status.cost,
  rateLimits: status.rateLimits,
  totalInputTokens: status.contextWindow?.totalInputTokens ?? 0,
  totalOutputTokens: status.contextWindow?.totalOutputTokens ?? 0,
})

export const SidebarStatusHeader = ({
  status,
  activeSessionName,
}: SidebarStatusHeaderProps): ReactElement => {
  if (status.isActive && status.agentType) {
    return (
      <StatusCard
        {...mapStatusToCardProps({ ...status, agentType: status.agentType })}
      />
    )
  }

  const title = activeSessionName ?? 'No session'

  return (
    <div
      data-testid="sidebar-status-header-idle"
      className="flex flex-col gap-3 rounded-xl bg-surface-container-high p-3"
    >
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-primary-container to-secondary" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-headline text-sm font-[800] text-on-surface">
            {title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-on-surface/30" />
            <span className="text-[10px] font-medium text-outline">Idle</span>
          </div>
        </div>
      </div>
    </div>
  )
}
