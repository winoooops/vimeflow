import type { ReactElement } from 'react'
import type { SessionStatus } from '../types'

export interface StatusDotProps {
  status: SessionStatus
  size?: number
  /**
   * Visually demote the dot — used in Recent rows so completed/errored
   * sessions read as secondary chrome instead of competing with the
   * Active group's bright running dots.
   */
  dim?: boolean
  'aria-label'?: string
}

// Bright tones — used in Active group rows + the SessionTabs strip.
const TONE_CLASS: Record<SessionStatus, string> = {
  running: 'bg-success shadow-[0_0_4px_theme(colors.success)] animate-pulse',
  paused: 'bg-warning animate-pulse',
  completed: 'bg-success-muted',
  errored: 'bg-error',
}

// Dim tones — used in Recent group rows. No glow, no pulse, hollow
// outline so the dot reads as a marker rather than a heartbeat.
const DIM_TONE_CLASS: Record<SessionStatus, string> = {
  running: 'border border-success/60',
  paused: 'border border-warning/60',
  completed: 'border border-success-muted/60',
  errored: 'border border-error/60',
}

export const StatusDot = ({
  status,
  size = 7,
  dim = false,
  'aria-label': ariaLabel,
}: StatusDotProps): ReactElement => (
  <span
    data-testid="status-dot"
    data-status={status}
    data-dim={dim || undefined}
    role={ariaLabel ? 'img' : undefined}
    aria-label={ariaLabel}
    aria-hidden={ariaLabel ? undefined : true}
    className={`inline-block shrink-0 rounded-full ${dim ? DIM_TONE_CLASS[status] : TONE_CLASS[status]}`}
    style={{ width: size, height: size }}
  />
)
