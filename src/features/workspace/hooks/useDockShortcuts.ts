import { useEffect, useRef } from 'react'
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
  modKey: '⌘' | 'Ctrl'
}

export const useDockShortcuts = ({
  activeContainerId,
  openDock,
  claimTerminal,
  modKey,
}: UseDockShortcutsParams): void => {
  const activeContainerIdRef = useRef(activeContainerId)
  const openDockRef = useRef(openDock)
  const claimTerminalRef = useRef(claimTerminal)
  const modKeyRef = useRef(modKey)

  activeContainerIdRef.current = activeContainerId
  openDockRef.current = openDock
  claimTerminalRef.current = claimTerminal
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const expectedModifier =
        modKeyRef.current === '⌘'
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey

      if (!expectedModifier || event.shiftKey || event.altKey) {
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

      const key = event.key.toLowerCase()

      // Ctrl+e / Ctrl+g would clobber vim/readline (both Ctrl-based) in xterm,
      // and Cmd/Ctrl+g is find-next inside CodeMirror — keep those guarded. But
      // Cmd+e / Cmd+g don't collide with the terminal (macOS terminals drive
      // vim/readline with Ctrl), so let them out of the terminal zone to reach
      // the dock from anywhere. Ctrl+b is exempt — it only fires when the dock
      // is active (checked below), so it can never originate from either surface.
      const modifierCollidesWithTerminal = modKeyRef.current === 'Ctrl'
      if (
        (key === 'e' || key === 'g') &&
        (inCodeMirror || (inTerminalZone && modifierCollidesWithTerminal))
      ) {
        return
      }

      if (key === 'e') {
        event.preventDefault()
        event.stopPropagation()
        openDockRef.current('editor')

        return
      }

      if (key === 'g') {
        event.preventDefault()
        event.stopPropagation()
        openDockRef.current('diff')

        return
      }

      if (key === 'b') {
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
