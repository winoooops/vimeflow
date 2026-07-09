import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import { DIALOG_SELECTOR } from '../containerIds'

export interface UseBurnerToggleShortcutParams {
  /** Toggle the burner terminal popup for the focused pane. */
  onToggle: () => void
  /** Registry matcher — true iff the event is the resolved command chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

// Burner terminal toggle (VIM-53): Ctrl+` on every platform — the cross-editor
// integrated-terminal idiom (VS Code, etc.). Deliberately Ctrl (not ⌘) on
// macOS too, so the muscle memory is identical everywhere. Backtick has no app
// meaning elsewhere, and the capture-phase listener claims it before the PTY,
// so it toggles from anywhere except an open modal.
export const useBurnerToggleShortcut = ({
  onToggle,
  matches,
}: UseBurnerToggleShortcutParams): void => {
  const onToggleRef = useRef(onToggle)
  const matchesRef = useRef(matches)
  onToggleRef.current = onToggle
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (event.repeat) {
        return
      }

      if (!matchesRef.current(event, 'burner-toggle')) {
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
