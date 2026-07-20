import { useCallback, useEffect, useRef, useState } from 'react'
import { SESSION_SWITCHER_DIALOG_TEST_ID } from '@/features/sessions/components/SessionSwitcher'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { CommandId } from '../../keymap/catalog'
import type { Chord } from '../../keymap/chord'
import { DIALOG_SELECTOR, TERMINAL_CONTAINER_ID } from '../containerIds'

const OWN_DIALOG_SELECTOR = `[data-testid="${SESSION_SWITCHER_DIALOG_TEST_ID}"]`

// Defer to open dialogs except the switcher's own overlay, which lingers in
// the DOM through its exit animation and must not swallow a rapid second tap.
const hasForeignDialog = (): boolean =>
  Array.from(document.querySelectorAll(DIALOG_SELECTOR)).some(
    (dialog) => !dialog.matches(OWN_DIALOG_SELECTOR)
  )

export interface UseSessionSwitcherParams {
  orderedIds: readonly string[]
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  bindingFor: (id: CommandId) => Chord
  onCommit: (sessionId: string) => void
  onCancel: () => void
}

export interface SessionSwitcherController {
  open: boolean
  selectedIndex: number
  commitIndex: (index: number) => void
  cancel: () => void
}

type HoldChecker = (event: KeyboardEvent) => boolean

// Maps the opening chord's super modifiers to live event state so commit
// fires exactly when the user lets go of the hold, on any binding.
const holdCheckerFor = (chord: Chord): HoldChecker => {
  const wantsCtrl = chord.mods.has('Ctrl')
  const wantsMod = chord.mods.has('Mod')

  return (event: KeyboardEvent): boolean =>
    (wantsCtrl && event.ctrlKey) ||
    (wantsMod && (event.metaKey || event.ctrlKey))
}

export const useSessionSwitcher = ({
  orderedIds,
  matches,
  bindingFor,
  onCommit,
  onCancel,
}: UseSessionSwitcherParams): SessionSwitcherController => {
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const openRef = useRef(open)
  openRef.current = open
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const orderedIdsRef = useRef(orderedIds)
  orderedIdsRef.current = orderedIds
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const bindingForRef = useRef(bindingFor)
  bindingForRef.current = bindingFor
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const holdCheckerRef = useRef<HoldChecker | null>(null)
  // Selection identity: reorders while open must not change the pending choice.
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const trackedId = selectedIdRef.current

    const trackedIndex = trackedId === null ? -1 : orderedIds.indexOf(trackedId)
    if (trackedIndex >= 0) {
      if (trackedIndex !== selectedIndexRef.current) {
        setSelectedIndex(trackedIndex)
      }

      return
    }

    if (selectedIndexRef.current >= orderedIds.length) {
      const clamped = Math.max(0, orderedIds.length - 1)
      selectedIdRef.current = orderedIds[clamped] ?? null
      setSelectedIndex(clamped)

      return
    }

    selectedIdRef.current = orderedIds[selectedIndexRef.current] ?? null
  }, [open, orderedIds])

  const close = useCallback((): void => {
    holdCheckerRef.current = null
    selectedIdRef.current = null
    setOpen(false)
    setSelectedIndex(0)
  }, [])

  const commitSelected = useCallback((): void => {
    const ids = orderedIdsRef.current
    const trackedId = selectedIdRef.current
    const index = selectedIndexRef.current
    close()
    if (trackedId !== null && ids.includes(trackedId)) {
      onCommitRef.current(trackedId)

      return
    }
    if (index < ids.length) {
      onCommitRef.current(ids[index])
    }
  }, [close])

  const commitIndex = useCallback(
    (index: number): void => {
      const ids = orderedIdsRef.current
      close()
      if (index >= 0 && index < ids.length) {
        onCommitRef.current(ids[index])
      }
    },
    [close]
  )

  const cancel = useCallback((): void => {
    close()
    onCancelRef.current()
  }, [close])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isOpen = openRef.current

      const commandId = matchesRef.current(event, 'session-switch-next')
        ? 'session-switch-next'
        : matchesRef.current(event, 'session-switch-prev')
          ? 'session-switch-prev'
          : null

      if (!isOpen) {
        if (commandId === null) {
          return
        }
        if (isKeymapCaptureTarget(event.target)) {
          return
        }
        if (hasForeignDialog()) {
          return
        }

        const target =
          event.target instanceof Element ? event.target : document.body

        const inTerminalZone = !!target.closest(
          `[data-container-id="${TERMINAL_CONTAINER_ID}"]`
        )

        const isTextEntry =
          !!target.closest('input, textarea') ||
          !!target.closest('[contenteditable]') ||
          !!target.closest('[role="textbox"]')
        if (isTextEntry && !inTerminalZone) {
          return
        }

        const ids = orderedIdsRef.current
        if (ids.length === 0) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        holdCheckerRef.current = holdCheckerFor(
          bindingForRef.current(commandId)
        )

        const initialIndex =
          commandId === 'session-switch-next'
            ? Math.min(1, ids.length - 1)
            : ids.length - 1
        selectedIdRef.current = ids[initialIndex] ?? null
        setSelectedIndex(initialIndex)
        setOpen(true)

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()

        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        commitSelected()

        return
      }

      if (commandId !== null) {
        event.preventDefault()
        event.stopPropagation()
        const ids = orderedIdsRef.current
        if (ids.length === 0) {
          cancel()

          return
        }
        const delta = commandId === 'session-switch-next' ? 1 : -1

        const next =
          (selectedIndexRef.current + delta + ids.length) % ids.length
        selectedIdRef.current = ids[next] ?? null
        setSelectedIndex(next)

        return
      }

      if (holdCheckerRef.current && !holdCheckerRef.current(event)) {
        event.preventDefault()
        event.stopPropagation()
        commitSelected()
      }
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!openRef.current || !holdCheckerRef.current) {
        return
      }
      if (!holdCheckerRef.current(event)) {
        commitSelected()
      }
    }

    const handleBlur = (): void => {
      if (openRef.current) {
        cancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    document.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('blur', handleBlur)

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
      document.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('blur', handleBlur)
    }
  }, [cancel, commitSelected])

  return { open, selectedIndex, commitIndex, cancel }
}
