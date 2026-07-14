import { useEffect, useRef } from 'react'
import type { LayoutSlotId, PaneLayoutId, Session } from '../../sessions/types'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  LAYOUT_CYCLE,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
  type PaneLayoutRegistry,
  isKnownLayoutId,
} from '../layout-registry/layoutRegistry'
import { resolvePanePlacement } from '../../sessions/utils/panePlacements'
import {
  DIALOG_SELECTOR,
  DOCK_CONTAINER_ID,
} from '../../workspace/containerIds'
import {
  resolveDirectionalPane,
  type PaneDirection,
} from '../utils/resolveDirectionalPane'
import { selectVisiblePanes } from '../utils/selectVisiblePanes'
import type { CommandId } from '../../keymap/catalog'
import { isKeymapCaptureTarget } from '../../keymap/capture'

export type PaneShortcutModifier = 'meta' | 'ctrl'

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: PaneLayoutId) => void
  matches: (event: KeyboardEvent, id: CommandId) => boolean
  onTerminalZoneFocus?: () => void
  isTerminalContainerActive?: boolean
  layoutRegistry?: PaneLayoutRegistry
}

const PANE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const PANE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const

const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm-helper-textarea'
const XTERM_INPUT_SELECTOR = '.xterm-helper-textarea'
const DOCK_SELECTOR = `[data-container-id="${DOCK_CONTAINER_ID}"]`

interface ShortcutContext {
  event: KeyboardEvent
  session: Session
  match: UsePaneShortcutsOptions['matches']
  setSessionActivePane: UsePaneShortcutsOptions['setSessionActivePane']
  setSessionLayout: UsePaneShortcutsOptions['setSessionLayout']
  focusTerminal: (() => void) | undefined
  terminalActive: boolean | undefined
  layoutRegistry: PaneLayoutRegistry
  previousLayouts: Map<string, PaneLayoutId>
}

const consumeShortcut = (event: KeyboardEvent): void => {
  event.preventDefault()
  event.stopPropagation()
}

const hasOpenDialog = (): boolean =>
  document.querySelector(DIALOG_SELECTOR) !== null

// Handlers return true once their command matches, including guarded no-ops,
// so one keypress never falls through to another shortcut family.
const handleSinglePaneFocusShortcut = ({
  event,
  session,
  match,
  setSessionLayout,
  terminalActive,
  layoutRegistry,
  previousLayouts,
}: ShortcutContext): boolean => {
  if (!match(event, 'single-pane-focus')) {
    return false
  }

  if (
    hasOpenDialog() ||
    terminalActive === false ||
    document.activeElement?.closest(TEXT_ENTRY_SELECTOR)
  ) {
    return true
  }

  if (session.layout === SINGLE_PANE_FOCUS_LAYOUT_ID) {
    const previousLayoutId = previousLayouts.get(session.id) ?? null

    const previousLayout =
      previousLayoutId === null
        ? null
        : layoutRegistry.getLayout(previousLayoutId)

    if (
      previousLayout === null ||
      session.panes.length > previousLayout.capacity
    ) {
      previousLayouts.delete(session.id)

      return true
    }

    consumeShortcut(event)
    previousLayouts.delete(session.id)
    setSessionLayout(session.id, previousLayout.id)

    return true
  }

  const currentLayout = layoutRegistry.getLayout(session.layout)
  if (currentLayout === null) {
    return true
  }

  consumeShortcut(event)
  previousLayouts.set(session.id, currentLayout.id)
  setSessionLayout(session.id, SINGLE_PANE_FOCUS_LAYOUT_ID)

  return true
}

const handleNumberedPaneFocusShortcut = ({
  event,
  session,
  match,
  setSessionActivePane,
  focusTerminal,
  terminalActive,
  layoutRegistry,
}: ShortcutContext): boolean => {
  const paneNumber = PANE_NUMBERS.find((number) =>
    match(event, `focus-pane-${number}` as CommandId)
  )
  if (paneNumber === undefined) {
    return false
  }

  if (hasOpenDialog()) {
    return true
  }

  const layout = layoutRegistry.getFallbackLayout(session.layout)
  const slotId = layout.definition.addOrder[paneNumber - 1]
  const visiblePanes = selectVisiblePanes(session.panes, layout.capacity)

  const target = resolvePanePlacement(
    visiblePanes,
    layout,
    session.placements
  ).assignments.find((assignment) => assignment.slotId === slotId)?.pane

  // Number shortcuts also recover terminal focus from the dock. Repeating the
  // active pane's shortcut refocuses its terminal without changing pane state.
  if (terminalActive !== undefined && focusTerminal !== undefined) {
    const activeElement = document.activeElement

    if (!terminalActive) {
      if (!activeElement?.closest(DOCK_SELECTOR)) {
        return true
      }

      focusTerminal()
      consumeShortcut(event)
    }

    if (
      terminalActive &&
      target?.active &&
      !activeElement?.closest(XTERM_INPUT_SELECTOR)
    ) {
      focusTerminal()
      consumeShortcut(event)

      return true
    }
  }

  if (target === undefined || target.active) {
    return true
  }

  consumeShortcut(event)
  setSessionActivePane(session.id, target.id)

  return true
}

const handleCycleLayoutShortcut = ({
  event,
  session,
  match,
  setSessionLayout,
  previousLayouts,
}: ShortcutContext): boolean => {
  if (!match(event, 'cycle-layout')) {
    return false
  }

  if (!isKnownLayoutId(session.layout)) {
    return true
  }

  const currentIndex = LAYOUT_CYCLE.indexOf(session.layout)
  if (currentIndex === -1) {
    return true
  }

  const nextIndex = (currentIndex + 1) % LAYOUT_CYCLE.length
  consumeShortcut(event)
  previousLayouts.delete(session.id)
  setSessionLayout(session.id, LAYOUT_CYCLE[nextIndex])

  return true
}

const handleDirectionalPaneFocusShortcut = ({
  event,
  session,
  match,
  setSessionActivePane,
  terminalActive,
  layoutRegistry,
}: ShortcutContext): boolean => {
  const direction = PANE_DIRECTIONS.find((candidate) =>
    match(event, `focus-pane-${candidate}` as CommandId)
  ) as PaneDirection | undefined
  if (direction === undefined) {
    return false
  }

  if (!terminalActive || hasOpenDialog()) {
    return true
  }

  const shape = layoutRegistry.getFallbackLayout(session.layout)
  const visiblePanes = selectVisiblePanes(session.panes, shape.capacity)

  const placement = resolvePanePlacement(
    visiblePanes,
    shape,
    session.placements
  )

  const activeAssignment = placement.assignments.find(
    (assignment) => assignment.pane.active
  )
  if (activeAssignment === undefined) {
    return true
  }

  const paneBySlotId = new Map(
    placement.assignments.map((assignment) => [
      assignment.slotId,
      assignment.pane,
    ])
  )

  const targetSlotId = resolveDirectionalPane(
    shape,
    activeAssignment.slotId,
    new Set<LayoutSlotId>(paneBySlotId.keys()),
    direction
  )

  consumeShortcut(event)

  if (targetSlotId !== null) {
    const targetPane = paneBySlotId.get(targetSlotId)
    if (targetPane !== undefined) {
      setSessionActivePane(session.id, targetPane.id)
    }
  }

  return true
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
  matches,
  onTerminalZoneFocus = undefined,
  isTerminalContainerActive = undefined,
  layoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const matchesRef = useRef(matches)
  const onTerminalZoneFocusRef = useRef(onTerminalZoneFocus)
  const isTerminalContainerActiveRef = useRef(isTerminalContainerActive)
  const layoutRegistryRef = useRef(layoutRegistry)

  const lastSingleToggleLayoutBySessionRef = useRef(
    new Map<string, PaneLayoutId>()
  )

  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  matchesRef.current = matches
  onTerminalZoneFocusRef.current = onTerminalZoneFocus
  isTerminalContainerActiveRef.current = isTerminalContainerActive
  layoutRegistryRef.current = layoutRegistry

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      const activeSession = sessionsRef.current.find(
        (session) => session.id === activeSessionIdRef.current
      )
      if (activeSession === undefined) {
        return
      }

      const context: ShortcutContext = {
        event,
        session: activeSession,
        match: matchesRef.current,
        setSessionActivePane,
        setSessionLayout,
        focusTerminal: onTerminalZoneFocusRef.current,
        terminalActive: isTerminalContainerActiveRef.current,
        layoutRegistry: layoutRegistryRef.current,
        previousLayouts: lastSingleToggleLayoutBySessionRef.current,
      }

      // Precedence is intentional: a matched handler owns the keypress even
      // when a guard turns it into a no-op, preventing family fallthrough.
      if (handleSinglePaneFocusShortcut(context)) {
        return
      }
      if (handleNumberedPaneFocusShortcut(context)) {
        return
      }
      if (handleCycleLayoutShortcut(context)) {
        return
      }
      handleDirectionalPaneFocusShortcut(context)
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      })
    }
  }, [setSessionActivePane, setSessionLayout])
}
