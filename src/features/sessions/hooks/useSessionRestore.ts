import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { registerPtySession } from '../../terminal/ptySessionMap'
import { createLogger } from '../../../lib/log'
import { groupSessionsFromInfos } from '../utils/groupSessionsFromInfos'
import { tabName } from '../utils/tabName'

const log = createLogger('restore')

export interface UseSessionRestoreOptions {
  service: ITerminalService
  buffer: PtyBufferDrain
  onRestore: (sessions: Session[]) => void
  onActiveResolved: (sessionId: string) => void
  onActiveFallback?: (sessionId: string) => void
}

export interface SessionRestoreState {
  loading: boolean
}

export const useSessionRestore = ({
  service,
  buffer,
  onRestore,
  onActiveResolved,
  onActiveFallback,
}: UseSessionRestoreOptions): SessionRestoreState => {
  const [loading, setLoading] = useState(true)
  const bufferRef = useRef(buffer)
  const onRestoreRef = useRef(onRestore)
  const onActiveResolvedRef = useRef(onActiveResolved)
  const onActiveFallbackRef = useRef(onActiveFallback)

  bufferRef.current = buffer
  onRestoreRef.current = onRestore
  onActiveResolvedRef.current = onActiveResolved
  onActiveFallbackRef.current = onActiveFallback

  useEffect(() => {
    let cancelled = false
    let stopBuffering: (() => void) | null = null

    void (async (): Promise<void> => {
      try {
        stopBuffering = await service.onData(
          (sessionId, data, offsetStart, byteLen) => {
            bufferRef.current.bufferEvent(sessionId, data, offsetStart, byteLen)
          }
        )
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          stopBuffering()
          stopBuffering = null

          return
        }

        const list = await service.listSessions()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) {
          return
        }

        log.info(
          `listSessions returned ${list.sessions.length} PTY session(s)`,
          {
            ptySessionIds: list.sessions.map((info) => info.id),
            activeSessionId: list.activeSessionId,
          }
        )

        // Reconstruct workspace sessions, collapsing grouped PTYs back into
        // the multi-pane shape they had before the reload. Ungrouped PTYs
        // (legacy cache entries) keep the single-pane shape via
        // `groupSessionsFromInfos` -> `sessionFromInfo`.
        const grouped = groupSessionsFromInfos(list.sessions)

        // Reconcile the active pane against `list.activeSessionId`. Two
        // cache fields can disagree on which pane is active when the
        // grouping-snapshot push and `set_active_session` IPCs interleave
        // (or when the snapshot push fails): `set_active_session` lands
        // immediately, but the grouping snapshot carries the old pane.active
        // flags. After a reload, `list.activeSessionId` holds the canonical
        // active PTY while the grouping says otherwise. Trust the backend's
        // `activeSessionId` as the source of truth for which pane is focused
        // within the workspace it belongs to.
        //
        // Recompute every session-level field that was derived from the
        // previous active pane in `groupSessionsFromInfos`: `agentType`,
        // `workingDirectory`, and the fallback `name`. Without this,
        // `addPane` later spawns from the stale `workingDirectory` and new
        // panes open in the wrong directory.
        const activePtyId = list.activeSessionId

        const reconciled = activePtyId
          ? grouped.map((session, idx) => {
              const newActivePane = session.panes.find(
                (pane) => pane.ptyId === activePtyId
              )
              if (!newActivePane) {
                return session
              }

              return {
                ...session,
                panes: session.panes.map((pane) => ({
                  ...pane,
                  active: pane.ptyId === activePtyId,
                })),
                agentType: newActivePane.agentType,
                workingDirectory: newActivePane.cwd,
                name: tabName(newActivePane.cwd, idx),
              }
            })
          : grouped

        // Register the buffer + ptySessionMap side effects for every Alive
        // pane, then attach the buffered-events snapshot to each pane's
        // restoreData. Doing this AFTER reconstruction (instead of inline as
        // the previous one-pass map did) keeps `groupSessionsFromInfos` pure
        // and testable, and naturally extends to multi-pane sessions.
        const restored = reconciled.map((session) => ({
          ...session,
          panes: session.panes.map((pane) => {
            if (!pane.restoreData) {
              return pane
            }
            bufferRef.current.registerPending(pane.ptyId)
            registerPtySession(pane.ptyId, pane.ptyId, pane.cwd)

            return {
              ...pane,
              restoreData: {
                ...pane.restoreData,
                bufferedEvents: bufferRef.current.getBufferedSnapshot(
                  pane.ptyId
                ),
              },
            }
          }),
        })) satisfies Session[]

        // Observability for the fragmentation bug: compare PTY count to the
        // number of reconstructed workspace sessions. While the cache stores
        // no pane grouping, this is 1:1 (every PTY becomes its own single-pane
        // session) — which is exactly the symptom. Once grouping is persisted
        // and reconstructed, a quad session of 4 PTYs collapses back to 1
        // workspace session and this line shows `4 PTY → 1 workspace`.
        log.info(
          `reconstructed ${restored.length} workspace session(s) from ` +
            `${list.sessions.length} PTY session(s)`,
          {
            workspaceSessions: restored.map((session) => ({
              id: session.id,
              layout: session.layout,
              paneCount: session.panes.length,
              paneIds: session.panes.map((pane) => pane.id),
            })),
          }
        )

        onRestoreRef.current(restored)

        if (list.activeSessionId !== null) {
          const matched = restored.find((session) =>
            session.panes.some((pane) => pane.ptyId === list.activeSessionId)
          )
          if (matched) {
            onActiveResolvedRef.current(matched.id)
          } else if (restored.length > 0) {
            onActiveFallbackRef.current?.(restored[0].id)
          }
        } else if (restored.length > 0) {
          onActiveFallbackRef.current?.(restored[0].id)
        }

        setLoading(false)
      } catch (err) {
        log.error('listSessions failed; starting empty', err)
        // F15 (claude LOW): intentionally do NOT call stopBuffering() here.
        // The pty-data buffering listener stays alive for the lifetime of
        // useSessionManager so createSession (post-restore) still benefits
        // from the buffer→drain protocol when spawn outpaces the pane's
        // useTerminal subscription. Tearing it down on restore failure
        // would silently lose early pty-data on every fresh tab. Cleanup
        // happens via the effect's return path on unmount (see below).
        setLoading(false)
      }
    })()

    return (): void => {
      cancelled = true
      stopBuffering?.()
    }
  }, [service])

  return { loading }
}
