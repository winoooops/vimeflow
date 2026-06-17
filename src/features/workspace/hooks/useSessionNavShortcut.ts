import { useEffect, useRef } from 'react'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

export interface UseSessionNavShortcutParams {
  /** Activate the previous session (wraps around). */
  onPrevSession: () => void
  /** Activate the next session (wraps around). */
  onNextSession: () => void
  /** Visible modifier on this platform: '⌘' (meta) or 'Ctrl'. */
  modKey: '⌘' | 'Ctrl'
}

// Session navigation (VIM-104): ⌘[ / ⌘] cycle to the previous / next session
// on macOS. On Linux/Windows we require Shift (Ctrl+⇧[ / Ctrl+⇧]) because the
// bare Ctrl+[ is the terminal's ESC. Matches the physical Bracket keys
// (event.code) so the binding survives Shift and non-US layouts.
//
// Fires from the terminal and general workspace chrome, but NOT from a focused
// CodeMirror editor or a plain text input: ⌘[ / ⌘] are the editor's own
// out/indent, so we defer there. ⌘ never reaches the PTY on macOS, and the
// Ctrl+Shift+bracket combo is free in the terminal on Linux.
export const useSessionNavShortcut = ({
  onPrevSession,
  onNextSession,
  modKey,
}: UseSessionNavShortcutParams): void => {
  const onPrevRef = useRef(onPrevSession)
  const onNextRef = useRef(onNextSession)
  const modKeyRef = useRef(modKey)

  onPrevRef.current = onPrevSession
  onNextRef.current = onNextSession
  modKeyRef.current = modKey

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      if (event.repeat || event.altKey) {
        return
      }

      if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') {
        return
      }

      // Match only this platform's modifier; reject the opposite so the other
      // chord still reaches the terminal.
      const isMeta = modKeyRef.current === '⌘'

      const expectedModifier = isMeta
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (!expectedModifier) {
        return
      }

      // macOS: ⌘[ / ⌘] (no Shift). Ctrl platforms: Ctrl+⇧[ / Ctrl+⇧] (Shift
      // required) — bare Ctrl+[ is the terminal's ESC.
      if (isMeta ? event.shiftKey : !event.shiftKey) {
        return
      }

      // Defer to whatever owns an open modal (command palette, unsaved-changes).
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

      // Defer to the editor / plain inputs (they own ⌘[ / ⌘] for out/indent),
      // but allow it from the terminal (the xterm helper textarea is text-entry
      // yet has no use for these chords).
      const isTextEntry =
        !!target.closest('input, textarea') ||
        !!target.closest('[contenteditable]') ||
        !!target.closest('[role="textbox"]')
      if (isTextEntry && !inTerminalZone) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'BracketLeft') {
        onPrevRef.current()
      } else {
        onNextRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])
}
