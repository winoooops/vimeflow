import { useEffect, useRef } from 'react'
import type { PaneLayoutId, Session } from '../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  LAYOUT_CYCLE,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
  type PaneLayoutRegistry,
  isKnownLayoutId,
} from '../layout-registry/layoutRegistry'
import { resolvePanePlacement } from '../../sessions/utils/panePlacements'
import {
  DIALOG_SELECTOR,
  DOCK_CONTAINER_ID,
} from '../../workspace/containerIds'
import {
  resolveDirectionalPane,
  type PaneDirection,
} from '../utils/resolveDirectionalPane'
import { selectVisiblePanes } from '../utils/selectVisiblePanes'
import type { CommandId } from '../../keymap/catalog'
import { isKeymapCaptureTarget } from '../../keymap/capture'

export type PaneShortcutModifier = 'meta' | 'ctrl'

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: PaneLayoutId) => void
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  onTerminalZoneFocus?: () => void
  isTerminalContainerActive?: boolean
  layoutRegistry?: PaneLayoutRegistry
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
  matches,
  onTerminalZoneFocus = undefined,
  isTerminalContainerActive = undefined,
  layoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const matchesRef = useRef(matches)
  const onTerminalZoneFocusRef = useRef(onTerminalZoneFocus)
  const isTerminalContainerActiveRef = useRef(isTerminalContainerActive)
  const layoutRegistryRef = useRef(layoutRegistry)
  const lastSingleToggleLayoutBySessionRef = useRef(
    new Map<string, PaneLayoutId>()
  )

  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  matchesRef.current = matches
  onTerminalZoneFocusRef.current = onTerminalZoneFocus
  isTerminalContainerActiveRef.current = isTerminalContainerActive
  layoutRegistryRef.current = layoutRegistry

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

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

      if (match(event, 'single-pane-focus')) {
        if (document.querySelector(DIALOG_SELECTOR)) {
          return
        }

        if (isTerminalContainerActiveRef.current === false) {
          return
        }

        const activeElement = document.activeElement
        if (
          activeElement?.closest(
            'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm-helper-textarea'
          )
        ) {
          return
        }

        if (activeSession.layout === SINGLE_PANE_FOCUS_LAYOUT_ID) {
          const previousLayoutId =
            lastSingleToggleLayoutBySessionRef.current.get(activeSession.id) ??
            null

          const previousLayout =
            previousLayoutId === null
              ? null
              : layoutRegistryRef.current.getLayout(previousLayoutId)

          if (
            previousLayout === null ||
            activeSession.panes.length > previousLayout.capacity
          ) {
            lastSingleToggleLayoutBySessionRef.current.delete(activeSession.id)

            return
          }

          event.preventDefault()
          event.stopPropagation()
          lastSingleToggleLayoutBySessionRef.current.delete(activeSession.id)
          setSessionLayout(activeSession.id, previousLayout.id)

          return
        }

        const currentLayout = layoutRegistryRef.current.getLayout(
          activeSession.layout
        )
        if (currentLayout === null) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        lastSingleToggleLayoutBySessionRef.current.set(
          activeSession.id,
          currentLayout.id
        )
        setSessionLayout(activeSession.id, SINGLE_PANE_FOCUS_LAYOUT_ID)

        return
      }

      const paneNumber = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).find((n) =>
        match(event, `focus-pane-${n}` as CommandId)
      )
      if (paneNumber !== undefined) {
        if (document.querySelector(DIALOG_SELECTOR)) {
          return
        }

        const layout = layoutRegistryRef.current.getFallbackLayout(
          activeSession.layout
        )
        const slotId = layout.definition.addOrder[paneNumber - 1]
        if (slotId === undefined) {
          return
        }

        const target = resolvePanePlacement(
          activeSession.panes,
          layout,
          activeSession.placements
        ).assignments.find((assignment) => assignment.slotId === slotId)?.pane

        const terminalActive = isTerminalContainerActiveRef.current
        const focusTerminal = onTerminalZoneFocusRef.current
        if (terminalActive !== undefined && focusTerminal !== undefined) {
          const activeElement = document.activeElement

          if (!terminalActive) {
            if (
              activeElement?.closest(
                `[data-container-id="${DOCK_CONTAINER_ID}"]`
              )
            ) {
              focusTerminal()
              event.preventDefault()
              event.stopPropagation()
            }

            return
          }

          if (
            target?.active &&
            !activeElement?.closest('.xterm-helper-textarea')
          ) {
            focusTerminal()
            event.preventDefault()
            event.stopPropagation()

            return
          }
        }

        if (target === undefined || target.active) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setSessionActivePane(activeSession.id, target.id)

        return
      }

      if (match(event, 'cycle-layout')) {
        if (!isKnownLayoutId(activeSession.layout)) {
          return
        }

        const currentIndex = LAYOUT_CYCLE.indexOf(activeSession.layout)
        if (currentIndex === -1) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        const nextIndex = (currentIndex + 1) % LAYOUT_CYCLE.length
        lastSingleToggleLayoutBySessionRef.current.delete(activeSession.id)
        setSessionLayout(activeSession.id, LAYOUT_CYCLE[nextIndex])

        return
      }

      const direction = (['left', 'right', 'up', 'down'] as const).find((d) =>
        match(event, `focus-pane-${d}` as CommandId)
      ) as PaneDirection | undefined
      if (direction === undefined) {
        return
      }

      if (!isTerminalContainerActiveRef.current) {
        return
      }
      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }

      const shape = layoutRegistryRef.current.getFallbackLayout(
        activeSession.layout
      )

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
      event.preventDefault()
      event.stopPropagation()

      if (targetVisibleIndex !== null) {
        setSessionActivePane(
          activeSession.id,
          visiblePanes[targetVisibleIndex].id
        )
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
