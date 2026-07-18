import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pane, Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { isShellPane } from '../utils/paneKind'
import { isLiveStatus } from '../utils/sessionStatus'
import { focusBrowserPane } from '../../browser/browserBridge'

export interface UseActiveSessionControllerOptions {
  service: ITerminalService
  sessionsRef: { current: Session[] }
  onActivationCommitted?: (id: string) => void
  onActivationRolledBack?: (id: string | null) => void
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
  onActivationCommitted = undefined,
  onActivationRolledBack = undefined,
}: UseActiveSessionControllerOptions): ActiveSessionController => {
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(
    null
  )
  const activeSessionIdRef = useRef(activeSessionId)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const generationRef = useRef(0)
  const inFlightRef = useRef<{ id: string; generation: number } | null>(null)
  const pendingIdRef = useRef<string | null>(null)
  const lastCommittedIdRef = useRef<string | null>(null)
  const committedCallbackRef = useRef(onActivationCommitted)
  const rolledBackCallbackRef = useRef(onActivationRolledBack)
  committedCallbackRef.current = onActivationCommitted
  rolledBackCallbackRef.current = onActivationRolledBack

  const dispatchRef = useRef<(id: string) => void>(() => undefined)

  const settleSuccess = useCallback((id: string, generation: number): void => {
    inFlightRef.current = null
    if (generation === generationRef.current) {
      lastCommittedIdRef.current = id
      committedCallbackRef.current?.(id)
    }
    const next = pendingIdRef.current
    pendingIdRef.current = null
    if (next !== null) {
      dispatchRef.current(next)
    }
  }, [])

  const settleFailure = useCallback((generation: number): void => {
    inFlightRef.current = null
    const next = pendingIdRef.current
    pendingIdRef.current = null

    if (generation === generationRef.current && next === null) {
      const restored = lastCommittedIdRef.current
      activeSessionIdRef.current = restored
      setActiveSessionIdState(restored)
      rolledBackCallbackRef.current?.(restored)
      if (restored !== null) {
        committedCallbackRef.current?.(restored)
      }

      return
    }

    if (next !== null) {
      dispatchRef.current(next)
    }
  }, [])

  const dispatch = useCallback(
    (id: string): void => {
      const session = sessionsRef.current.find((s) => s.id === id)
      const generation = generationRef.current
      if (!session) {
        // Vanished while queued: settle as failure so a pending target still dispatches.
        inFlightRef.current = { id, generation }
        settleFailure(generation)

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

      inFlightRef.current = { id, generation }

      if (liveShell) {
        service
          .setActiveSession(liveShell.ptyId)
          // eslint-disable-next-line promise/prefer-await-to-then
          .then(() => settleSuccess(id, generation))
          // eslint-disable-next-line promise/prefer-await-to-then
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('setActiveSession IPC failed', err)
            settleFailure(generation)
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

      settleSuccess(id, generation)
    },
    [service, sessionsRef, settleFailure, settleSuccess]
  )
  dispatchRef.current = dispatch

  const setActiveSessionId = useCallback(
    (id: string): void => {
      // F5 (claude MEDIUM): look up the session BEFORE mutating ref+state.
      const session = sessionsRef.current.find((s) => s.id === id)
      if (!session) {
        return
      }

      activeSessionIdRef.current = id
      setActiveSessionIdState(id)

      if (inFlightRef.current !== null) {
        pendingIdRef.current = id

        return
      }

      dispatch(id)
    },
    [dispatch, sessionsRef]
  )

  const setActiveSessionIdRaw = useCallback((id: string | null): void => {
    generationRef.current += 1
    pendingIdRef.current = null
    lastCommittedIdRef.current = id
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
