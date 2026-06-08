import type { SessionInfo } from '../../../bindings'
import type { Pane, Session } from '../types'
import { emptyActivity } from '../constants'
import { tabName } from './tabName'
import { readActivityPanelCollapsed } from './activityPanelCollapsedStore'
import { readCacheHistory } from './cacheHistoryStore'

/** Build a `Session` from a Rust `SessionInfo`. */
export const sessionFromInfo = (info: SessionInfo, index: number): Session => {
  const status = info.status.kind === 'Alive' ? 'running' : 'completed'

  const paneBase = {
    kind: 'shell',
    id: 'p0',
    ptyId: info.id,
    cwd: info.cwd,
    agentType: 'generic',
    status,
    cacheHistory: readCacheHistory(info.id),
    active: true,
  } satisfies Pane

  const pane: Pane =
    info.status.kind === 'Alive'
      ? {
          ...paneBase,
          pid: info.status.pid,
          restoreData: {
            sessionId: info.id,
            cwd: info.cwd,
            pid: info.status.pid,
            replayData: info.status.replay_data,
            replayEndOffset: Number(info.status.replay_end_offset),
            bufferedEvents: [],
          },
        }
      : paneBase

  return {
    id: info.id,
    projectId: 'proj-1',
    name: tabName(info.cwd, index),
    status,
    layout: 'single',
    activityPanelCollapsed: readActivityPanelCollapsed(info.id),
    panes: [pane],
    workingDirectory: info.cwd,
    browserSessionId: info.id,
    agentType: 'generic',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activity: { ...emptyActivity },
  }
}
