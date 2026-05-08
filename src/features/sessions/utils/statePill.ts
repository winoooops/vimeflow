import type { Session } from '../../workspace/types'

export const STATE_PILL_LABEL: Record<Session['status'], string> = {
  running: 'running',
  paused: 'awaiting',
  completed: 'completed',
  errored: 'errored',
}

// Bright pills — Active group rows. Vivid bg + saturated text.
export const STATE_PILL_TONE: Record<Session['status'], string> = {
  running: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success-muted bg-success-muted/10',
  errored: 'text-error bg-error/15',
}

// Dim pills — Recent group rows.
export const STATE_PILL_TONE_DIM: Record<Session['status'], string> = {
  running: 'text-success/70 bg-success/5',
  paused: 'text-warning/70 bg-warning/5',
  completed: 'text-success-muted/70 bg-success-muted/5',
  errored: 'text-error/80 bg-error/8',
}
