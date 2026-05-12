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
      // We deliberately do NOT reject altKey / shiftKey. Non-US
      // keyboard layouts (AZERTY, QWERTZ, …) require Shift to access
      // the digit row and AltGr (delivered as altKey on most browsers)
      // to access backslash. Matching by `event.code` (physical key
      // position) below keeps the shortcut layout-independent. Gating
      // on alt/shift being absent would silently disable the feature
      // on those layouts. Trade-off: Ctrl+Alt+1 / Ctrl+Shift+1 also
      // claim the slot, so terminal apps in those modifier combos
      // lose them. Codex P2 review (cycle 3) prefers this trade-off
      // over having the shortcut silently fail to fire on non-US
      // keyboards.

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

      const digitMatch = /^Digit([1-4])$/.exec(event.code)
      if (digitMatch) {
        const paneIndex = Number.parseInt(digitMatch[1], 10) - 1
        // Out-of-range: let the key propagate so terminal apps (vim,
        // tmux, etc.) can use ⌘N for their own purposes. The toolbar
        // advertises "⌘+1-4 focus pane" — reserving the slot when
        // there's no pane to focus would silently swallow user input
        // with no visible action. We intercept only when a pane
        // actually exists at the requested index.
        if (paneIndex >= activeSession.panes.length) {
          return
        }

        const target = activeSession.panes[paneIndex]
        // Already-active: let the key propagate. The default single-
        // pane session is `panes.length === 1`, so Ctrl/Cmd+1
        // permanently maps to `panes[0]` which is always active. If
        // we intercepted here, terminal apps (REPLs, vim) running
        // inside the pane would NEVER see Ctrl+1 — a silent feature
        // loss for the very common case of "one pane open". The
        // shortcut's job is to MOVE focus; when focus is already on
        // the target, ownership of the keystroke is the user's.
        if (target.active) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setSessionActivePane(activeSession.id, target.id)

        return
      }

      if (event.code === 'Backslash') {
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
