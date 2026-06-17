import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
// Source the data constant directly from its module rather than the
// SplitView barrel — keeps usePaneShortcuts decoupled from a
// sibling component's re-export surface.
import { LAYOUTS, type LayoutShape } from '../components/SplitView/layouts'
import {
  resolveDirectionalPane,
  type PaneDirection,
} from '../utils/resolveDirectionalPane'
import {
  DIALOG_SELECTOR,
  DOCK_CONTAINER_ID,
} from '../../workspace/containerIds'
import { selectVisiblePanes } from '../utils/selectVisiblePanes'
import type { CommandId } from '../../keymap/catalog'
import { isKeymapCaptureTarget } from '../../keymap/capture'

// Derive the cycle order from the canonical LAYOUTS record so a future
// LayoutId added in `layouts.ts` automatically participates in ⌘\
// cycling. Hardcoding the list would let new layouts appear in the
// LayoutSwitcher (which renders from `Object.values(LAYOUTS)`) but
// silently reset to `'single'` on ⌘\ — `LAYOUT_CYCLE.indexOf(newId)`
// would return -1 and the modulo would wrap to index 0.
const LAYOUT_CYCLE: readonly LayoutId[] = Object.values(LAYOUTS).map(
  (layout) => layout.id
)

/** Which modifier the toolbar hint advertises on this platform. Kept for the
 *  display side (toolbar/keymap hints); the behavior side now reads its match
 *  from the keybinding registry via `matches`. */
export type PaneShortcutModifier = 'meta' | 'ctrl'

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
  /** Keybinding registry matcher — resolves each command's chord (default ⊕
   *  override) and matches the event, so a persisted override takes effect.
   *  Replaces the former hardcoded platform-super gate (VIM-136 SP1). */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  onTerminalZoneFocus?: () => void
  isTerminalContainerActive?: boolean
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
  matches,
  onTerminalZoneFocus = undefined,
  isTerminalContainerActive = undefined,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const matchesRef = useRef(matches)
  const onTerminalZoneFocusRef = useRef(onTerminalZoneFocus)
  const isTerminalContainerActiveRef = useRef(isTerminalContainerActive)
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  matchesRef.current = matches
  onTerminalZoneFocusRef.current = onTerminalZoneFocus
  isTerminalContainerActiveRef.current = isTerminalContainerActive

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      // The platform-super check AND the per-key match both live in the
      // registry's `match` (called per command below), so an override changes
      // the live shortcut. The former shared super early-return is gone; every
      // other guard — dialog / terminal-active / out-of-range / capacity /
      // already-active — is unchanged. (VIM-136 SP1; keyboard-shortcut-guards.md.)
      const match = matchesRef.current

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

      const paneNumber = ([1, 2, 3, 4] as const).find((n) =>
        match(event, `focus-pane-${n}` as CommandId)
      )
      if (paneNumber !== undefined) {
        const paneIndex = paneNumber - 1

        // Dialog guard covers the full digit-key path — both reclaim and
        // pane-switch — so ⌘1-4 is fully suppressed while any modal is open.
        if (document.querySelector(DIALOG_SELECTOR)) {
          return
        }

        const isTerminalContainerActiveValue =
          isTerminalContainerActiveRef.current
        const onTerminalZoneFocusValue = onTerminalZoneFocusRef.current

        if (
          isTerminalContainerActiveValue !== undefined &&
          onTerminalZoneFocusValue !== undefined
        ) {
          const activeElement = document.activeElement

          if (!isTerminalContainerActiveValue) {
            if (
              activeElement?.closest(
                `[data-container-id="${DOCK_CONTAINER_ID}"]`
              )
            ) {
              onTerminalZoneFocusValue()
              event.preventDefault()
              event.stopPropagation()

              return
            } else {
              return
            }
          } else if (paneIndex < activeSession.panes.length) {
            const target = activeSession.panes[paneIndex]
            if (target.active) {
              if (activeElement?.closest('.xterm-helper-textarea')) {
                return
              }

              onTerminalZoneFocusValue()
              event.preventDefault()
              event.stopPropagation()

              return
            }
          }
        }

        // Out-of-range: let the key propagate so terminal apps (vim, tmux,
        // etc.) can use the slot. We intercept only when a pane actually
        // exists at the requested index.
        if (paneIndex >= activeSession.panes.length) {
          return
        }

        const target = activeSession.panes[paneIndex]
        // Already-active: let the key propagate. The default single-pane
        // session is `panes.length === 1`, so the pane-1 chord permanently maps
        // to `panes[0]` which is always active; intercepting here would deny
        // terminal apps the keystroke in the very common one-pane case.
        if (target.active) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setSessionActivePane(activeSession.id, target.id)

        return
      }

      if (match(event, 'cycle-layout')) {
        const currentIndex = LAYOUT_CYCLE.indexOf(activeSession.layout)
        // Persisted sessions can carry a layout id that no longer exists in the
        // current LAYOUTS record. `indexOf` returns -1 then; treat the unknown
        // layout as a no-op so the user keeps their existing state.
        if (currentIndex === -1) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const nextIndex = (currentIndex + 1) % LAYOUT_CYCLE.length
        setSessionLayout(activeSession.id, LAYOUT_CYCLE[nextIndex])

        return
      }

      const direction = (['left', 'right', 'up', 'down'] as const).find((d) =>
        match(event, `focus-pane-${d}` as CommandId)
      ) as PaneDirection | undefined
      if (direction === undefined) {
        return
      }

      // Directional pane focus (default ⌘/Ctrl+Shift+Arrow). The Shift
      // requirement is now part of the bound chord (matched above), so plain
      // ⌘/Ctrl+Arrow stays the editor's own navigation. Still gated on the
      // terminal container being active + the dialog guard, running at the
      // document capture phase. (Codex review cycles 7/11; guards #20-22, #26.)
      const isTerminalContainerActiveValue =
        isTerminalContainerActiveRef.current
      if (!isTerminalContainerActiveValue) {
        return
      }
      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }
      const shape = LAYOUTS[activeSession.layout] as LayoutShape | undefined
      if (shape === undefined) {
        return
      }

      // When the session has more panes than the layout capacity, SplitView
      // renders the active pane in the last visible slot via selectVisiblePanes.
      // Directional resolution must run against the visible slot grid.
      const visiblePanes = selectVisiblePanes(
        activeSession.panes,
        shape.capacity
      )
      const activeVisibleIndex = visiblePanes.findIndex((pane) => pane.active)
      if (activeVisibleIndex === -1) {
        return
      }

      const targetVisibleIndex = resolveDirectionalPane(
        shape,
        activeVisibleIndex,
        visiblePanes.length,
        direction
      )
      if (targetVisibleIndex === null) {
        // Recognized as an app-level pane-navigation chord and the guards have
        // passed: claim it so the keystroke doesn't fall through to xterm and
        // emit a modified-arrow escape sequence to the PTY at layout edges or in
        // single-pane sessions. (Codex review cycle 11; guard #21.)
        event.preventDefault()
        event.stopPropagation()

        return
      }
      event.preventDefault()
      event.stopPropagation()
      setSessionActivePane(
        activeSession.id,
        visiblePanes[targetVisibleIndex].id
      )
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      })
    }
  }, [setSessionActivePane, setSessionLayout])
}
