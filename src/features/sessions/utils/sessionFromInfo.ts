import type { SessionInfo } from '../../../bindings'
import type { Session } from '../types'
import { emptyActivity } from '../constants'
import { tabName } from './tabName'

/** Build a `Session` from a Rust `SessionInfo`. */
export const sessionFromInfo = (info: SessionInfo, index: number): Session => ({
  id: info.id,
  projectId: 'proj-1',
  name: tabName(info.cwd, index),
  status: info.status.kind === 'Alive' ? 'running' : 'completed',
  workingDirectory: info.cwd,
  agentType: 'generic',
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  activity: { ...emptyActivity },
})
