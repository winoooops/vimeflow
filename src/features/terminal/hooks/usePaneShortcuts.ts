import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'

const LAYOUT_CYCLE: readonly LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
] as const

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) {
        return
      }
      if (event.altKey || event.shiftKey) {
        return
      }

      const activeId = activeSessionIdRef.current
      if (activeId === null) {
        return
      }

      const activeSession = sessionsRef.current.find(
        (session) => session.id === activeId
      )
      if (!activeSession) {
        return
      }

      if (event.key >= '1' && event.key <= '4') {
        event.preventDefault()
        event.stopPropagation()
        const paneIndex = Number.parseInt(event.key, 10) - 1
        if (paneIndex >= activeSession.panes.length) {
          return
        }

        const target = activeSession.panes[paneIndex]

        if (!target.active) {
          setSessionActivePane(activeSession.id, target.id)
        }

        return
      }

      if (event.key === '\\') {
        event.preventDefault()
        event.stopPropagation()
        const currentIndex = LAYOUT_CYCLE.indexOf(activeSession.layout)
        const nextIndex = (currentIndex + 1) % LAYOUT_CYCLE.length
        setSessionLayout(activeSession.id, LAYOUT_CYCLE[nextIndex])
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      })
    }
  }, [setSessionActivePane, setSessionLayout])
}
