import type { ReactElement } from 'react'
import type { SessionStatus } from '../types'

export interface StatusDotProps {
  status: SessionStatus
  size?: number
  'aria-label'?: string
}

const TONE_CLASS: Record<SessionStatus, string> = {
  running: 'bg-success shadow-[0_0_4px_theme(colors.success)] animate-pulse',
  paused: 'bg-warning animate-pulse',
  completed: 'bg-success-muted',
  errored: 'bg-error',
}

export const StatusDot = ({
  status,
  size = 7,
  'aria-label': ariaLabel,
}: StatusDotProps): ReactElement => (
  <span
    data-testid="status-dot"
    data-status={status}
    role={ariaLabel ? 'img' : undefined}
    aria-label={ariaLabel}
    aria-hidden={ariaLabel ? undefined : true}
    className={`inline-block shrink-0 rounded-full ${TONE_CLASS[status]}`}
    style={{ width: size, height: size }}
  />
)
