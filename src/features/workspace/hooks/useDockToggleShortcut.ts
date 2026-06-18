import { useEffect, useRef } from 'react'
import { DIALOG_SELECTOR } from '../containerIds'

export interface UseDockToggleShortcutParams {
  /** Open the dock if it is closed, collapse it if it is open. */
  onToggle: () => void
  /** Visible modifier on this platform: '⌘' (meta) or 'Ctrl'. */
  modKey: '⌘' | 'Ctrl'
}

// Workspace-global toggle for the editor/diff dock: ⌘0 on macOS, Ctrl+0 on
// Linux. The 0 slot sits beside the pane-focus digits (⌘1-6 in
// usePaneShortcuts) and the sidebar's ⌘B, so the panel controls read as one
// number row. Matches the physical Digit0 key (event.code) — like the pane
// shortcuts — so AZERTY/QWERTZ layouts that reach 0 via Shift still fire. The
// chord is terminal-safe: ⌘0 never reaches the PTY on macOS, and Ctrl+0 has no
// terminal meaning, so it can toggle from anywhere except an open modal.
export const useDockToggleShortcut = ({
  onToggle,
  modKey,
}: UseDockToggleShortcutParams): void => {
  const onToggleRef = useRef(onToggle)
  const modKeyRef = useRef(modKey)
  onToggleRef.current = onToggle
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Digit0') {
        return
      }

      // Match only the modifier this platform advertises; reject the other so
      // the opposite chord (e.g. Ctrl+0 on macOS) still reaches the terminal.
      const isMeta = modKeyRef.current === '⌘'
      const expected = isMeta ? event.metaKey : event.ctrlKey
      const forbidden = isMeta ? event.ctrlKey : event.metaKey
      if (!expected || forbidden) {
        return
      }

      // Defer to whatever owns an open modal (command palette, unsaved-changes).
      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onToggleRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
