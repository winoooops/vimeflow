import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseNewSessionShortcutParams {
  /** Create a new session. */
  onNewSession: () => void
  /** Registry matcher — true iff the event is the resolved command chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

// New-session shortcut (VIM-77), mirroring the sidebar-toggle convention:
//   - macOS default: ⌘N — ⌘ chords never reach the PTY.
//   - Linux/Windows default: Ctrl+⇧N — bare Ctrl+N is reserved by the terminal
//     (readline next-line / TUI bindings), so we require Shift.
// Allowed through from the terminal and the editor, but not from plain text
// inputs (e.g. the session rename field). The key match comes from the
// keybinding registry so persisted overrides take effect.
export const useNewSessionShortcut = ({
  onNewSession,
  matches,
}: UseNewSessionShortcutParams): void => {
  const onNewSessionRef = useRef(onNewSession)
  const matchesRef = useRef(matches)

  onNewSessionRef.current = onNewSession
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      // Auto-repeat (held key) would spawn a PTY per repeat — fire once.
      if (event.repeat) {
        return
      }

      if (!matchesRef.current(event, 'new-session')) {
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

      // Don't steal the keystroke while typing in a plain text field, but DO
      // allow it from the terminal and the editor (create-from-anywhere).
      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone && !inCodeMirror) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onNewSessionRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
