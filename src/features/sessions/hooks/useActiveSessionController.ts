import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pane, Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { isShellPane } from '../utils/paneKind'
import { isLiveStatus } from '../utils/sessionStatus'
import { focusBrowserPane } from '../../browser/browserBridge'

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

      const activePane = session.panes.find((pane) => pane.active)

      const isLiveShell = (pane: Pane): boolean =>
        isShellPane(pane) && isLiveStatus(pane.status)

      // Resolve the LIVE shell PTY to activate. Prefer the session's active
      // pane when it is a live shell so restore (and a tab switch) target the
      // pane the UI shows — otherwise Rust's active PTY diverges from the
      // restored active pane. Fall back to ANY live shell so a session whose
      // active pane is a dead placeholder is still selectable (not
      // findBackendSessionPane's `?? shellPanes[0]`, which can return a dead
      // placeholder the backend rejects). Spec §4.
      const liveShell =
        activePane && isLiveShell(activePane)
          ? activePane
          : session.panes.find(isLiveShell)

      // Bump the request id BEFORE branching so a prior in-flight shell
      // rollback (older myReq) can no longer revert this selection.
      const myReq = ++activeRequestIdRef.current
      const prev = activeSessionIdRef.current
      activeSessionIdRef.current = id
      setActiveSessionIdState(id)

      if (liveShell) {
        // eslint-disable-next-line promise/prefer-await-to-then
        service.setActiveSession(liveShell.ptyId).catch((err) => {
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

        return
      }

      // No live shell — a browser-only session, or shells that are all
      // restartable placeholders (dead PTYs from a graceful-quit restore).
      // Skip the PTY IPC (its rollback would revert this selection) and focus
      // the browser pane when the active pane is one.
      if (activePane && !isShellPane(activePane)) {
        void focusBrowserPane({ sessionId: session.id, paneId: activePane.id })
      }
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
