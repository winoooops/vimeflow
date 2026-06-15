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

    const activeIndex = session.panes.findIndex((pane) => pane.active)
    if (activeIndex === -1) {
      return true
    }

    const shape = LAYOUTS[session.layout] as LayoutShape | undefined
    if (shape === undefined) {
      return true
    }

    const target = resolveDirectionalPane(
      shape,
      activeIndex,
      session.panes.length,
      direction
    )
    if (target !== null) {
      setSessionActivePaneRef.current(session.id, session.panes[target].id)
    }

    return true
  }

  const cycleNextPane = (): boolean => {
    const session = activeSessionRef.current
    if (session === undefined || session.panes.length === 0) {
      return true
    }

    const activeIndex = session.panes.findIndex((pane) => pane.active)

    const next =
      (activeIndex === -1 ? 0 : activeIndex + 1) % session.panes.length

    setSessionActivePaneRef.current(session.id, session.panes[next].id)

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
