import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
import {
  LAYOUTS,
  type LayoutShape,
} from '../../terminal/components/SplitView/layouts'
import {
  resolveDirectionalPane,
  type PaneDirection,
} from '../../terminal/utils/resolveDirectionalPane'
import { selectVisiblePanes } from '../../terminal/utils/selectVisiblePanes'
import { registerChord } from '../chordRegistry'

export interface UseVimLeaderChordsOptions {
  keymapPreset: string
  activeSession: Session | undefined
  setSessionActivePane: (sessionId: string, paneId: string) => void
  closeActivePane: () => void
  setActiveSessionLayout: (layoutId: LayoutId) => void
}

export const useVimLeaderChords = (
  options: UseVimLeaderChordsOptions
): void => {
  const {
    keymapPreset,
    activeSession,
    setSessionActivePane,
    closeActivePane,
    setActiveSessionLayout,
  } = options

  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession
  const setSessionActivePaneRef = useRef(setSessionActivePane)
  setSessionActivePaneRef.current = setSessionActivePane
  const closeActivePaneRef = useRef(closeActivePane)
  closeActivePaneRef.current = closeActivePane
  const setActiveSessionLayoutRef = useRef(setActiveSessionLayout)
  setActiveSessionLayoutRef.current = setActiveSessionLayout

  const focusDirection = (direction: PaneDirection): boolean => {
    const session = activeSessionRef.current
    if (session === undefined) {
      return true
    }

    const shape = LAYOUTS[session.layout] as LayoutShape | undefined
    if (shape === undefined) {
      return true
    }

    // Directional resolution must run against the visible slot grid (same
    // mapping SplitView uses via selectVisiblePanes), not the raw pane array
    // indices. Otherwise a pane rescued into the last visible slot when the
    // layout is over-capacity cannot be navigated from. (Codex review cycle 11.)
    const visiblePanes = selectVisiblePanes(session.panes, shape.capacity)
    const activeVisibleIndex = visiblePanes.findIndex((pane) => pane.active)
    if (activeVisibleIndex === -1) {
      return true
    }

    const targetVisibleIndex = resolveDirectionalPane(
      shape,
      activeVisibleIndex,
      visiblePanes.length,
      direction
    )
    if (targetVisibleIndex !== null) {
      setSessionActivePaneRef.current(
        session.id,
        visiblePanes[targetVisibleIndex].id
      )
    }

    return true
  }

  const cycleNextPane = (): boolean => {
    const session = activeSessionRef.current
    if (session === undefined || session.panes.length === 0) {
      return true
    }

    const shape = LAYOUTS[session.layout] as LayoutShape | undefined
    if (shape === undefined) {
      return true
    }

    // Cycle within the visible slot subset, matching SplitView rendering and
    // directional navigation. Using the raw pane array would let `w` focus a
    // hidden pane in over-capacity layouts and cause a visible layout jump.
    const visiblePanes = selectVisiblePanes(session.panes, shape.capacity)
    if (visiblePanes.length === 0) {
      return true
    }

    const activeVisibleIndex = visiblePanes.findIndex((pane) => pane.active)

    const next =
      (activeVisibleIndex === -1 ? 0 : activeVisibleIndex + 1) %
      visiblePanes.length

    setSessionActivePaneRef.current(session.id, visiblePanes[next].id)

    return true
  }

  useEffect(() => {
    if (keymapPreset !== 'vim') {
      return
    }

    const cleanup = [
      registerChord('h', () => focusDirection('left')),

      registerChord('j', () => focusDirection('down')),

      registerChord('k', () => focusDirection('up')),

      registerChord('l', () => focusDirection('right')),

      registerChord('w', () => cycleNextPane()),

      registerChord('c', () => {
        closeActivePaneRef.current()

        return true
      }),

      registerChord('s', () => {
        setActiveSessionLayoutRef.current('hsplit')

        return true
      }),

      registerChord('v', () => {
        setActiveSessionLayoutRef.current('vsplit')

        return true
      }),

      registerChord('o', () => {
        setActiveSessionLayoutRef.current('single')

        return true
      }),
    ]

    return (): void => {
      cleanup.forEach((fn) => fn())
    }
  }, [keymapPreset])
}
