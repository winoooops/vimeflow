import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import { DIALOG_SELECTOR } from '../containerIds'
import type { CommandId } from '../../keymap/catalog'

export interface UseDockToggleShortcutParams {
  /** Open the dock if it is closed, collapse it if it is open. */
  onToggle: () => void
  /** Registry matcher — true iff the event is the resolved `dock-toggle` chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
}

// Workspace-global toggle for the editor/diff dock (default ⌘0 / Ctrl+0). The
// key + modifier match now comes from the keybinding registry via `matches`
// (so a persisted override takes effect); the DIALOG_SELECTOR guard and the
// terminal-safe capture-phase claim are unchanged.
export const useDockToggleShortcut = ({
  onToggle,
  matches,
}: UseDockToggleShortcutParams): void => {
  const onToggleRef = useRef(onToggle)
  const matchesRef = useRef(matches)
  onToggleRef.current = onToggle
  matchesRef.current = matches

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (!matchesRef.current(event, 'dock-toggle')) {
        return
      }
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
