import type { ReactElement } from 'react'
import type { Session, SessionStatus } from '../../types'

interface StatusCardProps {
  session: Session
}

const getAgentName = (
  agentType: 'claude-code' | 'codex' | 'aider' | 'generic'
): string => {
  const names = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    aider: 'Aider',
    generic: 'Agent',
  }

  return names[agentType]
}

const getStatusConfig = (
  status: SessionStatus
): { symbol: string; color: string; label: string } => {
  const configs = {
    running: {
      symbol: '●',
      color: 'text-success',
      label: 'running',
    },
    paused: {
      symbol: '⏸',
      color: 'text-secondary',
      label: 'paused',
    },
    completed: {
      symbol: '○',
      color: 'text-on-surface',
      label: 'completed',
    },
    errored: {
      symbol: '✗',
      color: 'text-error',
      label: 'errored',
    },
  }

  return configs[status]
}

const StatusCard = ({ session }: StatusCardProps): ReactElement => {
  const agentName = getAgentName(session.agentType)
  const statusConfig = getStatusConfig(session.status)
  const displayAction = session.currentAction ?? 'Idle'

  return (
    <div
      data-testid="status-card"
      className="flex flex-col gap-2 rounded-lg bg-surface-container-high p-3"
    >
      {/* Agent name and status */}
      <div className="flex items-center justify-between">
        <span className="font-label text-sm font-medium text-on-surface">
          {agentName}
        </span>
        <span className={`font-label text-xs ${statusConfig.color}`}>
          {statusConfig.symbol} {statusConfig.label}
        </span>
      </div>

      {/* Current action */}
      <p className="text-xs text-on-surface">{displayAction}</p>
    </div>
  )
}

export default StatusCard
