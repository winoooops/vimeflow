import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSidebarTabShortcutParams {
  /** Reveal the sidebar (if collapsed) and show the Sessions view. */
  onShowSessions: () => void
  /** Reveal the sidebar (if collapsed) and show the Files view. */
  onShowFiles: () => void
  /** Registry matcher — true iff the event is the resolved command chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

// Left-sidebar view switch (Sessions <-> Files):
//   - macOS default: ⌘⇧S (Sessions) / ⌘⇧F (Files).
//   - Linux/Windows default: Ctrl+⇧S / Ctrl+⇧F.
// Shift is required on BOTH platforms because the bare chords are taken: ⌘S /
// Ctrl+S is "save". The switch therefore sits one Shift away, beside the
// sidebar-toggle (⌘B) and new-session (⌘N / Ctrl+⇧N) controls. ⌘ chords never
// reach the PTY on macOS, and Ctrl+Shift+letter is already the Linux
// app-shortcut convention here (copy = Ctrl+Shift+C, sidebar = Ctrl+Shift+B).
// Allowed from the terminal and the editor (switch-from-anywhere) but not from
// plain text inputs (e.g. the session rename field) or while a modal is open.
// The key match comes from the keybinding registry so persisted overrides take
// effect.
export const useSidebarTabShortcut = ({
  onShowSessions,
  onShowFiles,
  matches,
}: UseSidebarTabShortcutParams): void => {
  const onShowSessionsRef = useRef(onShowSessions)
  const onShowFilesRef = useRef(onShowFiles)
  const matchesRef = useRef(matches)

  onShowSessionsRef.current = onShowSessions
  onShowFilesRef.current = onShowFiles
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (event.repeat) {
        return
      }

      const commandId = matchesRef.current(event, 'sidebar-sessions')
        ? 'sidebar-sessions'
        : matchesRef.current(event, 'sidebar-files')
          ? 'sidebar-files'
          : null

      if (commandId === null) {
        return
      }

      const target =
        event.target instanceof Element
          ? event.target
          : document.activeElement instanceof Element
            ? document.activeElement
            : document.body

      // Defer to whatever owns an open modal (command palette, unsaved-changes),
      // but allow the shortcut when the compact sidebar drawer is open — it has
      // role="dialog" for a11y, yet the tab switch must still work whether focus
      // is inside the drawer or still on the opener/terminal that triggered it.
      const sidebarDialog = document.querySelector(
        '[role="dialog"][aria-label="Sidebar"]'
      )

      const hasNonSidebarDialog = Array.from(
        document.querySelectorAll(DIALOG_SELECTOR)
      ).some((dialog) => dialog !== sidebarDialog)
      if (hasNonSidebarDialog) {
        return
      }

      const inTerminalZone = !!target.closest(
        `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
      )
      const inCodeMirror = !!target.closest('.cm-editor')

      // Don't steal the keystroke while typing in a plain text field, but DO
      // allow it from the terminal and the editor (switch-from-anywhere).
      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone && !inCodeMirror) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (commandId === 'sidebar-sessions') {
        onShowSessionsRef.current()
      } else {
        onShowFilesRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
