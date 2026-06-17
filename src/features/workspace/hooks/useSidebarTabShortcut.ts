import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSidebarTabShortcutParams {
  /** Reveal the sidebar (if collapsed) and show the Sessions view. */
  onShowSessions: () => void
  /** Reveal the sidebar (if collapsed) and show the Files view. */
  onShowFiles: () => void
  /** Visible modifier on this platform: '⌘' (meta) or 'Ctrl'. */
  modKey: '⌘' | 'Ctrl'
}

// Left-sidebar view switch (Sessions <-> Files):
//   - macOS (modKey '⌘'): ⌘⇧S (Sessions) / ⌘⇧F (Files).
//   - Linux/Windows (modKey 'Ctrl'): Ctrl+⇧S / Ctrl+⇧F.
// Shift is required on BOTH platforms because the bare chords are taken: ⌘S /
// Ctrl+S is "save". The switch therefore sits one Shift away, beside the
// sidebar-toggle (⌘B) and new-session (⌘N / Ctrl+⇧N) controls. ⌘ chords never
// reach the PTY on macOS, and Ctrl+Shift+letter is already the Linux
// app-shortcut convention here (copy = Ctrl+Shift+C, sidebar = Ctrl+Shift+B).
// Allowed from the terminal and the editor (switch-from-anywhere) but not from
// plain text inputs (e.g. the session rename field) or while a modal is open.
export const useSidebarTabShortcut = ({
  onShowSessions,
  onShowFiles,
  modKey,
}: UseSidebarTabShortcutParams): void => {
  const onShowSessionsRef = useRef(onShowSessions)
  const onShowFilesRef = useRef(onShowFiles)
  const modKeyRef = useRef(modKey)

  onShowSessionsRef.current = onShowSessions
  onShowFilesRef.current = onShowFiles
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      // Shift is mandatory (bare ⌘S/Ctrl+S = save); reject Alt-modified chords.
      if (event.repeat || event.altKey || !event.shiftKey) {
        return
      }

      // Match the physical S/F keys (event.code) so the binding survives Shift
      // and non-Latin IME layouts (Cyrillic, Arabic, Hebrew, CJK).
      if (event.code !== 'KeyS' && event.code !== 'KeyF') {
        return
      }

      const key = event.code === 'KeyS' ? 's' : 'f'

      // Match only this platform's modifier; reject the opposite so the other
      // chord still reaches the terminal.
      const isMeta = modKeyRef.current === '⌘'

      const expectedModifier = isMeta
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (!expectedModifier) {
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

      if (key === 's') {
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
