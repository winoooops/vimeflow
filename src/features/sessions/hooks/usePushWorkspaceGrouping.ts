// Push the current workspace-session grouping to the Rust cache whenever the
// React `sessions[]` shape changes. The backend rebuilds its `groupings` map
// from each snapshot, so the cache mirrors the live React structure with at
// most one short debounce of lag — and a later restore can reconstruct the
// multi-pane layout instead of fragmenting each PTY into its own single-pane
// session (see useSessionRestore + groupSessionsFromInfos for the read side).
//
// Deliberately ONE integration point instead of threading the snapshot push
// through every structural mutation (createSession / addPane / removePane /
// setSessionLayout / setSessionActivePane / reorderSessions / restartSession).
// The cost is a few extra writes when unrelated fields update (cwd, agent
// type, activity feed) — harmless because `set_workspace_sessions` is
// idempotent, and the debounce coalesces bursts.

import { useEffect } from 'react'
import type {
  SetWorkspaceSessionsRequest,
  WorkspaceSessionSnapshot,
} from '../../../bindings'
import { createLogger } from '../../../lib/log'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { Session } from '../types'

const log = createLogger('grouping')

/**
 * Pure conversion of the in-memory `Session[]` shape into the IPC payload.
 * Exposed for testability — call sites should use the hook below.
 */
export const buildGroupingSnapshot = (
  sessions: readonly Session[]
): SetWorkspaceSessionsRequest => ({
  sessions: sessions.map(
    (session): WorkspaceSessionSnapshot => ({
      id: session.id,
      layout: session.layout,
      panes: session.panes.map((pane, paneIndex) => ({
        ptyId: pane.ptyId,
        paneId: pane.id,
        paneIndex,
        agentType: pane.agentType,
        active: pane.active,
      })),
    })
  ),
})

export interface UsePushWorkspaceGroupingOptions {
  service: ITerminalService
  sessions: readonly Session[]
  /** Skip pushes while the initial restore is still loading — pushing an
   *  empty snapshot before the restored sessions land would clobber the
   *  cache `groupings` we are about to read from. */
  loading: boolean
}

export const usePushWorkspaceGrouping = ({
  service,
  sessions,
  loading,
}: UsePushWorkspaceGroupingOptions): void => {
  useEffect(() => {
    if (loading) {
      return
    }
    // No live sessions in React state: rely on per-PTY kill_pty cleanup that
    // already drops grouping entries individually. Pushing an empty snapshot
    // here would race the restore window if `sessions` is transiently empty.
    if (sessions.length === 0) {
      return
    }

    // Fire immediately, no debounce. A timer-based debounce can be cancelled
    // by an unmount that happens before it fires (e.g. the user adds a pane
    // and hits Cmd+R within the debounce window), which would leave the cache
    // without the grouping for that last pane and reload would fragment it
    // back into a single-pane session. Pushing on every `sessions` change is
    // idempotent on the backend and only fires on structural mutations + a
    // handful of low-frequency UI updates — well within IPC headroom.
    const snapshot = buildGroupingSnapshot(sessions)
    log.info(
      `pushing grouping snapshot: ${snapshot.sessions.length} workspace ` +
        `session(s), ${snapshot.sessions.reduce(
          (n, s) => n + s.panes.length,
          0
        )} pane(s)`,
      {
        workspaces: snapshot.sessions.map((s) => ({
          id: s.id,
          layout: s.layout,
          panes: s.panes.length,
        })),
      }
    )

    // eslint-disable-next-line promise/prefer-await-to-then
    service.setWorkspaceSessions(snapshot).catch((err) => {
      log.warn('setWorkspaceSessions IPC failed', err)
    })
  }, [service, sessions, loading])
}
