import { useEffect, useRef } from 'react'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseNewSessionShortcutParams {
  /** Create a new session. */
  onNewSession: () => void
  /** Visible modifier on this platform: '⌘' (meta) or 'Ctrl'. */
  modKey: '⌘' | 'Ctrl'
}

// New-session shortcut (VIM-77), mirroring the sidebar-toggle convention:
//   - macOS (modKey '⌘'): ⌘N — ⌘ chords never reach the PTY.
//   - Linux/Windows (modKey 'Ctrl'): Ctrl+⇧N — bare Ctrl+N is reserved by the
//     terminal (readline next-line / TUI bindings), so we require Shift.
// Allowed through from the terminal and the editor, but not from plain text
// inputs (e.g. the session rename field).
export const useNewSessionShortcut = ({
  onNewSession,
  modKey,
}: UseNewSessionShortcutParams): void => {
  const onNewSessionRef = useRef(onNewSession)
  const modKeyRef = useRef(modKey)

  onNewSessionRef.current = onNewSession
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Auto-repeat (held key) would spawn a PTY per repeat — fire once.
      if (event.repeat) {
        return
      }

      if (event.key.toLowerCase() !== 'n' || event.altKey) {
        return
      }

      const isMeta = modKeyRef.current === '⌘'

      const expectedModifier = isMeta
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (!expectedModifier) {
        return
      }

      // macOS: ⌘N (no Shift). Ctrl platforms: Ctrl+⇧N (Shift required).
      if (isMeta ? event.shiftKey : !event.shiftKey) {
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
