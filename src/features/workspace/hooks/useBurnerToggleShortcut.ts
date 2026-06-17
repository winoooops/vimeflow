import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import { DIALOG_SELECTOR } from '../containerIds'

export interface UseBurnerToggleShortcutParams {
  /** Toggle the burner terminal popup for the focused pane. */
  onToggle: () => void
}

// Burner terminal toggle (VIM-53): Ctrl+` on every platform — the cross-editor
// integrated-terminal idiom (VS Code, etc.). Deliberately Ctrl (not ⌘) on
// macOS too, so the muscle memory is identical everywhere. Backtick has no app
// meaning elsewhere, and the capture-phase listener claims it before the PTY,
// so it toggles from anywhere except an open modal.
export const useBurnerToggleShortcut = ({
  onToggle,
}: UseBurnerToggleShortcutParams): void => {
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      // Exactly Ctrl+` — reject ⌘/Alt/Shift-modified and held-key repeats.
      if (
        event.repeat ||
        event.code !== 'Backquote' ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
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
