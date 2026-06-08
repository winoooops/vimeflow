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
}: SidebarStatusHeaderProps): ReactElement =>
  status.isActive && status.agentType ? (
    <StatusCard
      {...mapStatusToCardProps({ ...status, agentType: status.agentType })}
    />
  ) : (
    <StatusCard mode="idle" title={activeSessionName ?? 'No session'} />
  )
