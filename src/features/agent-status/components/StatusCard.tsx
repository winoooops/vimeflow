import type { ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import type { CostState, RateLimitsState } from '../types'
import { BudgetMetrics } from './BudgetMetrics'

type AgentType = 'claude-code' | 'codex' | 'kimi' | 'aider' | 'generic'
type StatusType = 'running' | 'awaiting' | 'idle' | 'completed' | 'errored'

interface ActiveStatusCardProps {
  mode?: 'active'
  agentType: AgentType
  modelId: string | null
  modelDisplayName: string | null
  status: StatusType
  cost: CostState | null
  rateLimits: RateLimitsState | null
  totalInputTokens: number
  totalOutputTokens: number
}

interface IdleStatusCardProps {
  mode: 'idle'
  title: string
}

export type StatusCardProps = ActiveStatusCardProps | IdleStatusCardProps

const agentNames: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi',
  aider: 'Aider',
  generic: 'Agent',
}

const idleStatusConfig = {
  color: 'bg-on-surface/30',
  glowClass: '',
  label: 'Idle',
}

const getStatusConfig = (
  status: StatusType
): { color: string; glowClass: string; label: string } => {
  const configs: Record<
    StatusType,
    { color: string; glowClass: string; label: string }
  > = {
    running: {
      color: 'bg-success',
      glowClass: 'shadow-[0_0_6px_theme(colors.success)]',
      label: 'Running',
    },
    awaiting: {
      color: 'bg-warning',
      glowClass: '',
      label: 'Awaiting you',
    },
    idle: {
      color: 'bg-on-surface-muted',
      glowClass: '',
      label: 'Idle',
    },
    completed: {
      color: 'bg-on-surface',
      glowClass: '',
      label: 'Completed',
    },
    errored: {
      color: 'bg-error',
      glowClass: '',
      label: 'Errored',
    },
  }

  return configs[status]
}

export const StatusCard = (props: StatusCardProps): ReactElement => {
  const isIdle = props.mode === 'idle'
  const statusConfig = isIdle ? idleStatusConfig : getStatusConfig(props.status)
  const title = isIdle ? props.title : agentNames[props.agentType]
  const displayModel = isIdle ? null : (props.modelDisplayName ?? props.modelId)

  const titleClassName = isIdle
    ? 'truncate font-headline text-[13.5px] font-[800] text-on-surface'
    : 'shrink-0 whitespace-nowrap font-headline text-sm font-[800] text-on-surface'

  return (
    <div
      data-testid="agent-status-card"
      data-agent-state={isIdle ? 'idle' : 'active'}
      className="flex min-h-44 flex-col gap-3 rounded-xl bg-surface-container-high p-3"
    >
      {/* Agent identity row */}
      <div className="flex items-center gap-2.5">
        {/* Gradient icon placeholder */}
        <div className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-primary-container to-secondary" />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className={titleClassName}>{title}</span>
            {displayModel ? (
              <Tooltip content={displayModel} placement="bottom">
                <span
                  tabIndex={0}
                  className="min-w-0 flex-1 truncate font-mono text-[10px] text-outline outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
                >
                  {displayModel}
                </span>
              </Tooltip>
            ) : null}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span
              data-testid="status-dot"
              className={`inline-block h-2 w-2 rounded-full ${statusConfig.color} ${statusConfig.glowClass}`}
            />
            <span className="text-[10px] font-medium text-outline">
              {statusConfig.label}
            </span>
          </div>
        </div>
      </div>

      {/* Budget metrics */}
      {isIdle ? null : (
        <BudgetMetrics
          cost={props.cost}
          rateLimits={props.rateLimits}
          totalInputTokens={props.totalInputTokens}
          totalOutputTokens={props.totalOutputTokens}
        />
      )}
    </div>
  )
}
