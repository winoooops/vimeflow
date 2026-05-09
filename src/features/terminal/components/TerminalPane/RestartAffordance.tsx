import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'

export interface RestartAffordanceProps {
  agent: Agent
  sessionId: string
  exitedAt: string
  onRestart: (sessionId: string) => void
}

export const RestartAffordance = ({
  agent,
  sessionId,
  exitedAt,
  onRestart,
}: RestartAffordanceProps): ReactElement => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface text-on-surface/70">
    <p className="font-mono text-sm">Session exited.</p>
    <button
      type="button"
      aria-label={`Restart session ${sessionId}`}
      onClick={() => onRestart(sessionId)}
      className="inline-flex items-center rounded-pill bg-surface-container px-3 py-1.5 font-label text-sm text-on-surface hover:bg-surface-container/80 focus-visible:outline focus-visible:outline-2"
      style={{ outlineColor: agent.accent }}
    >
      <span
        className="material-symbols-outlined mr-1 text-[14px]"
        aria-hidden="true"
      >
        restart_alt
      </span>
      Restart
    </button>
    <span className="text-xs text-on-surface/50">
      ended {formatRelativeTime(exitedAt)}
    </span>
  </div>
)
