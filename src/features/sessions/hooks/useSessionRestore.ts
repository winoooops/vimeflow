import { useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import { registerPtySession } from '../../terminal/ptySessionMap'
import { sessionFromInfo } from '../utils/sessionFromInfo'

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
        // eslint-disable-next-line no-console
        console.warn('listSessions failed; starting empty', err)
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
