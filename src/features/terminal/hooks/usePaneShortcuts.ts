import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
// Source the data constant directly from its module rather than the
// SplitView barrel — keeps usePaneShortcuts decoupled from a
// sibling component's re-export surface.
import { LAYOUTS } from '../components/SplitView/layouts'

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

/** Which modifier the toolbar hint advertises — and therefore the only
 *  one we intercept on this platform. Restricting to a single modifier
 *  per platform prevents a hidden shortcut steal: on macOS, the
 *  toolbar says "⌘+1-4 focus" but accepting `ctrlKey` would also
 *  swallow `Ctrl+1` (which terminal apps like vim / readline use).
 *  WorkspaceView derives this once from navigator + passes the same
 *  value to TerminalZone (for display) and this hook (for behavior). */
export type PaneShortcutModifier = 'meta' | 'ctrl'

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
  /** Defaults to `'ctrl'` — the safer behavior for non-Mac shells
   *  where the toolbar already shows `Ctrl`. */
  preferModifier?: PaneShortcutModifier
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
  preferModifier = 'ctrl',
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const preferModifierRef = useRef(preferModifier)
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  preferModifierRef.current = preferModifier

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Match exactly the modifier the toolbar advertises. On macOS
      // (preferModifier='meta'), Ctrl+1 flows through to xterm so
      // terminal apps keep their Ctrl-shortcuts. Same logic mirrored
      // on Linux/Windows for Cmd combos. (Codex P2 cycle 10.)
      const mod = preferModifierRef.current
      const expected = mod === 'meta' ? event.metaKey : event.ctrlKey
      const forbidden = mod === 'meta' ? event.ctrlKey : event.metaKey
      if (!expected || forbidden) {
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
        const currentIndex = LAYOUT_CYCLE.indexOf(activeSession.layout)
        // Persisted sessions can carry a layout id that no longer
        // exists in the current LAYOUTS record (e.g., a layout was
        // renamed between app versions). `indexOf` returns -1 then,
        // and a naive `(currentIndex + 1) % length` would wrap to 0
        // and silently reset to 'single'. Treat the unknown layout
        // as a no-op so the user keeps their existing state and can
        // recover via the LayoutSwitcher buttons.
        if (currentIndex === -1) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
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
