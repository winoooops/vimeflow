import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { getActivePane } from '../utils/activeSessionPane'

export interface UseActiveSessionControllerOptions {
  service: ITerminalService
  sessionsRef: { current: Session[] }
}

export interface ActiveSessionController {
  activeSessionId: string | null
  setActiveSessionId: (id: string) => void
  /** Restore-time write that bypasses the IPC roundtrip. */
  setActiveSessionIdRaw: (id: string | null) => void
  /** Latest active React session id for async manager mutations. */
  activeSessionIdRef: { readonly current: string | null }
}

export const useActiveSessionController = ({
  service,
  sessionsRef,
}: UseActiveSessionControllerOptions): ActiveSessionController => {
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const activeRequestIdRef = useRef(0)

  const setActiveSessionId = useCallback(
    (id: string): void => {
      const myReq = ++activeRequestIdRef.current
      const prev = activeSessionIdRef.current
      activeSessionIdRef.current = id
      setActiveSessionIdState(id)

      const session = sessionsRef.current.find((s) => s.id === id)
      if (!session) {
        return
      }

      const ptyId = getActivePane(session).ptyId

      // eslint-disable-next-line promise/prefer-await-to-then
      service.setActiveSession(ptyId).catch((err) => {
        if (myReq === activeRequestIdRef.current) {
          // eslint-disable-next-line no-console
          console.warn('setActiveSession IPC failed; reverting', err)
          activeSessionIdRef.current = prev
          setActiveSessionIdState(prev)
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            'setActiveSession IPC failed but newer request superseded; not reverting',
            err
          )
        }
      })
    },
    [service, sessionsRef]
  )

  const setActiveSessionIdRaw = useCallback((id: string | null): void => {
    activeRequestIdRef.current += 1
    activeSessionIdRef.current = id
    setActiveSessionIdState(id)
  }, [])

  return {
    activeSessionId,
    setActiveSessionId,
    setActiveSessionIdRaw,
    activeSessionIdRef,
  }
}
