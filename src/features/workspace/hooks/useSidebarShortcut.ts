import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import {
  DIALOG_SELECTOR,
  DOCK_CONTAINER_ID,
  TERMINAL_CONTAINER_ID,
} from '../containerIds'

export interface UseSidebarShortcutParams {
  /** Flip the workspace-global sidebar-collapse flag. */
  onToggle: () => void
  /** Registry matcher — true iff the event is the resolved command chord. */
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  /** Active focus container — used to defer to the dock's ⌘B when the dock is focused. */
  activeContainerId: string
}

// Workspace-global sidebar toggle (VIM-66).
//   - macOS default: ⌘B — ⌘ chords never reach the PTY, so this is safe
//     even with the terminal focused, matching the VS Code binding.
//   - Linux/Windows default: Ctrl+⇧B — bare Ctrl+B is reserved by the terminal
//     (tmux prefix / readline backward-char), so we require Shift.
// Coexists with useDockShortcuts' ⌘B (which closes the dock only when the dock
// is focused): on macOS we bail when the dock owns focus so the dock keeps ⌘B;
// elsewhere ⌘B/Ctrl+⇧B toggles the sidebar. The keystroke is allowed through
// from the terminal and the editor, but not from plain text inputs. The key
// match comes from the keybinding registry so persisted overrides take effect.
export const useSidebarShortcut = ({
  onToggle,
  matches,
  activeContainerId,
}: UseSidebarShortcutParams): void => {
  const onToggleRef = useRef(onToggle)
  const matchesRef = useRef(matches)
  const activeContainerIdRef = useRef(activeContainerId)

  onToggleRef.current = onToggle
  matchesRef.current = matches
  activeContainerIdRef.current = activeContainerId

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (!matchesRef.current(event, 'sidebar-toggle')) {
        return
      }

      const target =
        event.target instanceof Element
          ? event.target
          : document.activeElement instanceof Element
            ? document.activeElement
            : document.body

      // Bail on real dialogs (command palette, unsaved-changes, etc.), but
      // allow the shortcut when the compact sidebar drawer is open — it has
      // role="dialog" for a11y, yet the sidebar shortcut must still close it.
      const openDialogs = document.querySelectorAll(DIALOG_SELECTOR)

      const inSidebarDialog = !!target.closest(
        '[role="dialog"][aria-label="Sidebar"]'
      )
      if (openDialogs.length > 0 && !inSidebarDialog) {
        return
      }

      // On macOS, defer to the dock's ⌘B (close dock) when the dock is focused.
      if (
        event.key.toLowerCase() === 'b' &&
        event.metaKey &&
        !event.ctrlKey &&
        activeContainerIdRef.current === DOCK_CONTAINER_ID &&
        target.closest(`[data-container-id="${DOCK_CONTAINER_ID}"]`)
      ) {
        return
      }

      const inTerminalZone = !!target.closest(
        `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
      )
      const inCodeMirror = !!target.closest('.cm-editor')

      // Don't steal the keystroke while typing in a plain text field, but DO
      // allow it from the terminal and the editor (toggle-from-anywhere).
      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone && !inCodeMirror) {
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
