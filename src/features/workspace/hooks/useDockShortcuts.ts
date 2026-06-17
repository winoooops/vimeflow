import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import {
  DIALOG_SELECTOR,
  DOCK_CONTAINER_ID,
  TERMINAL_CONTAINER_ID,
  type FocusTarget,
} from '../containerIds'

type DockFocusTarget = Extract<FocusTarget, 'editor' | 'diff'>

export interface UseDockShortcutsParams {
  activeContainerId: string
  openDock: (tab: DockFocusTarget) => void
  claimTerminal: () => void
  /** Registry matcher for focus-editor/focus-diff. Dock reclaim stays hardcoded. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  modKey: '⌘' | 'Ctrl'
}

export const useDockShortcuts = ({
  activeContainerId,
  openDock,
  claimTerminal,
  matches,
  modKey,
}: UseDockShortcutsParams): void => {
  const activeContainerIdRef = useRef(activeContainerId)
  const openDockRef = useRef(openDock)
  const claimTerminalRef = useRef(claimTerminal)
  const matchesRef = useRef(matches)
  const modKeyRef = useRef(modKey)

  activeContainerIdRef.current = activeContainerId
  openDockRef.current = openDock
  claimTerminalRef.current = claimTerminal
  matchesRef.current = matches
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      const dockTarget = matchesRef.current(event, 'focus-editor')
        ? 'editor'
        : matchesRef.current(event, 'focus-diff')
          ? 'diff'
          : null

      const expectedReclaimModifier =
        modKeyRef.current === '⌘'
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey

      const key = event.key.toLowerCase()

      const canReclaimTerminal =
        key === 'b' &&
        expectedReclaimModifier &&
        !event.shiftKey &&
        !event.altKey

      if (dockTarget === null && !canReclaimTerminal) {
        return
      }

      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }

      const target =
        event.target instanceof Element
          ? event.target
          : document.activeElement instanceof Element
            ? document.activeElement
            : document.body

      const inTerminalZone = !!target.closest(
        `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
      )
      const inCodeMirror = !!target.closest('.cm-editor')

      const isTextEntry =
        !!target.closest('input, textarea') ||
        (!inCodeMirror &&
          !!(
            target.closest('[contenteditable]') ??
            target.closest('[role="textbox"]')
          ))

      if (isTextEntry && !inTerminalZone) {
        return
      }

      // Ctrl+e / Ctrl+g: do not steal vim/readline shortcuts when xterm or
      // CodeMirror has focus. Ctrl+b is exempt — it only fires when dock is
      // active (checked below), so it can never originate from either surface.
      if (dockTarget !== null && (inTerminalZone || inCodeMirror)) {
        return
      }

      if (dockTarget !== null) {
        event.preventDefault()
        event.stopPropagation()
        openDockRef.current(dockTarget)

        return
      }

      if (canReclaimTerminal) {
        const activeElement = document.activeElement
        if (
          !inCodeMirror &&
          activeContainerIdRef.current === DOCK_CONTAINER_ID &&
          activeElement?.closest(`[data-container-id="${DOCK_CONTAINER_ID}"]`)
        ) {
          event.preventDefault()
          event.stopPropagation()
          claimTerminalRef.current()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      })
    }
  }, [])
}
