import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { findActivePane } from '../utils/activeSessionPane'

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
      // F5 (claude MEDIUM): look up the session BEFORE mutating ref+state.
      // F11 (claude MEDIUM): use the non-throwing `findActivePane` and
      // resolve the ptyId BEFORE the mutations. The previous code called
      // `getActivePane(session).ptyId` AFTER the ref+state writes — if
      // 5b's multi-pane edits transiently produced a no-active-pane state,
      // the throw would leave React pointing at the new id while Rust's
      // active stayed on the old one (no IPC fired, no rollback reached).
      const session = sessionsRef.current.find((s) => s.id === id)
      if (!session) {
        return
      }
      const pane = findActivePane(session)
      if (!pane) {
        return
      }
      const ptyId = pane.ptyId

      const myReq = ++activeRequestIdRef.current
      const prev = activeSessionIdRef.current
      activeSessionIdRef.current = id
      setActiveSessionIdState(id)

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
