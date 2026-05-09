import type { SessionStatus } from '../../../sessions/types'

export type PtyStatus = 'idle' | 'running' | 'exited' | 'error'

export const ptyStatusToSessionStatus = (status: PtyStatus): SessionStatus => {
  switch (status) {
    case 'running':
      return 'running'
    case 'exited':
      return 'completed'
    case 'error':
      return 'errored'
    case 'idle':
    default:
      return 'paused'
  }
}
