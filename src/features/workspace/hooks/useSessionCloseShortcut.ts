import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSessionCloseShortcutParams {
  /** Close the active session through the guarded close-with-successor path. */
  onCloseActiveSession: () => void
  /** Registry matcher — true iff the event is the resolved command chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

// Session close: ⌘W on macOS, Ctrl+⇧W elsewhere (bare Ctrl+W stays the
// terminal's delete-word-backward). Guard matrix mirrors useSessionNavShortcut:
// defer to keymap capture, open dialogs, and text entry outside the terminal.
export const useSessionCloseShortcut = ({
  onCloseActiveSession,
  matches,
}: UseSessionCloseShortcutParams): void => {
  const onCloseRef = useRef(onCloseActiveSession)
  const matchesRef = useRef(matches)

  onCloseRef.current = onCloseActiveSession
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (event.repeat) {
        return
      }

      if (!matchesRef.current(event, 'session-close')) {
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

      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
