import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
import { LAYOUTS } from '../components/SplitView'

// Derive the cycle order from the canonical LAYOUTS record so a future
// LayoutId added in `layouts.ts` automatically participates in ⌘\
// cycling. Hardcoding the list would let new layouts appear in the
// LayoutSwitcher (which renders from `Object.values(LAYOUTS)`) but
// silently reset to `'single'` on ⌘\ — `LAYOUT_CYCLE.indexOf(newId)`
// would return -1 and the modulo would wrap to index 0. The
// `Object.values(...).map(l => l.id)` form is type-safe: each entry's
// `id` is typed `LayoutId`, so the resulting array carries the same
// type without an unchecked cast.
const LAYOUT_CYCLE: readonly LayoutId[] = Object.values(LAYOUTS).map(
  (layout) => layout.id
)

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
        const paneIndex = Number.parseInt(event.key, 10) - 1
        // Out-of-range: let the key propagate so terminal apps (vim,
        // tmux, etc.) can use ⌘N for their own purposes. The toolbar
        // advertises "⌘+1-4 focus pane" — reserving the slot when
        // there's no pane to focus would silently swallow user input
        // with no visible action. We intercept only when a pane
        // actually exists at the requested index.
        if (paneIndex >= activeSession.panes.length) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
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
