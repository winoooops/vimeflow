import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { registerPtySession } from '../../terminal/ptySessionMap'
import { createLogger } from '../../../lib/log'
import { sessionFromInfo } from '../utils/sessionFromInfo'

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

        const restored = list.sessions.map((info, index) => {
          const session = sessionFromInfo(info, index)
          if (info.status.kind !== 'Alive') {
            return session
          }

          const pane = session.panes[0]
          if (!pane.restoreData) {
            return session
          }

          bufferRef.current.registerPending(info.id)
          registerPtySession(info.id, info.id, info.cwd)

          return {
            ...session,
            panes: [
              {
                ...pane,
                restoreData: {
                  ...pane.restoreData,
                  bufferedEvents: bufferRef.current.getBufferedSnapshot(
                    info.id
                  ),
                },
              },
            ],
          } satisfies Session
        })

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
