// cspell:ignore vsplit hsplit
/* eslint-disable react/require-default-props */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type ReactElement,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Pane, Session } from '../../../sessions/types'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import {
  TerminalPane,
  type TerminalPaneHandle,
  type TerminalPaneMode,
} from '../TerminalPane'
import { EmptySlot } from './EmptySlot'
import { LAYOUTS } from './layouts'

const SLOT_FADE_TRANSITION = { duration: 0.08, ease: 'easeOut' } as const

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  onSetActivePane?: (sessionId: string, paneId: string) => void
  onAddPane?: (sessionId: string) => void
  onClosePane?: (sessionId: string, paneId: string) => void
  deferTerminalFit?: boolean
  showPaneFocusHighlight?: boolean
}

export interface SplitViewHandle {
  /** Focuses the active TerminalPane. Returns true if the pane was ready. */
  focusActivePane(): boolean
}

const paneMode = (pane: Pane): TerminalPaneMode => {
  if (pane.status === 'completed' || pane.status === 'errored') {
    return 'awaiting-restart'
  }

  if (pane.restoreData) {
    return 'attach'
  }

  return 'spawn'
}

/** Pick the panes that should be rendered for `layout.capacity` slots.
 *  Normally the prefix slice; if the active pane is beyond the slice,
 *  the active pane replaces the last visible slot so focus/agent/cwd
 *  signals stay reachable from the UI. This is a valid runtime state
 *  when a user switches from a larger layout to a smaller one. Exported
 *  for unit testing. */
export const selectVisiblePanes = (
  panes: readonly Pane[],
  capacity: number
): Pane[] => {
  const sliced = panes.slice(0, capacity)
  const activeIdx = panes.findIndex((p) => p.active)
  if (activeIdx >= capacity) {
    return [...sliced.slice(0, capacity - 1), panes[activeIdx]]
  }

  return sliced
}

export const SplitView = forwardRef<SplitViewHandle, SplitViewProps>(
  function SplitView(
    {
      session,
      service,
      isActive,
      onSessionCwdChange = undefined,
      onPaneReady = undefined,
      onSessionRestart = undefined,
      onSetActivePane = undefined,
      onAddPane = undefined,
      onClosePane = undefined,
      deferTerminalFit = false,
      showPaneFocusHighlight = true,
    }: SplitViewProps,
    ref
  ): ReactElement {
    const layout = LAYOUTS[session.layout]
    const outerDivRef = useRef<HTMLDivElement>(null)

    const paneHandleRefs = useRef<Map<string, TerminalPaneHandle | null>>(
      new Map()
    )

    const paneRefSetters = useRef<
      Map<string, (h: TerminalPaneHandle | null) => void>
    >(new Map())

    const getPaneRefSetter = useCallback(
      (id: string): ((h: TerminalPaneHandle | null) => void) => {
        if (!paneRefSetters.current.has(id)) {
          paneRefSetters.current.set(id, (h) => {
            if (h === null) {
              paneHandleRefs.current.delete(id)
            } else {
              paneHandleRefs.current.set(id, h)
            }
          })
        }

        return paneRefSetters.current.get(id)!
      },
      []
    )

    useImperativeHandle(ref, () => ({
      focusActivePane(): boolean {
        const activePane = session.panes.find((pane) => pane.active)
        if (!activePane) {
          outerDivRef.current?.focus()

          return false
        }

        const handle = paneHandleRefs.current.get(activePane.id)
        if (!handle) {
          outerDivRef.current?.focus()

          return false
        }

        const focused = handle.focusTerminal()
        if (!focused) {
          outerDivRef.current?.focus()
        }

        return focused
      },
    }))

    const visiblePanes = selectVisiblePanes(session.panes, layout.capacity)

    const emptySlotIndices =
      session.panes.length < layout.capacity
        ? Array.from(
            { length: layout.capacity - session.panes.length },
            (_, index) => session.panes.length + index
          )
        : []

    const gridTemplateAreas = layout.areas
      .map((row) => `"${row.join(' ')}"`)
      .join(' ')

    return (
      <div
        ref={outerDivRef}
        data-testid="split-view"
        data-session-id={session.id}
        data-layout={session.layout}
        tabIndex={-1}
        className="grid h-full w-full gap-2 bg-surface p-2.5"
        style={{
          gridTemplateColumns: layout.cols,
          gridTemplateRows: layout.rows,
          gridTemplateAreas,
        }}
      >
        {/* eslint-disable-next-line react/jsx-boolean-value -- framer-motion: `initial={false}` skips the entry animation for children already mounted. Omitting `initial` reverts to the default (animate on mount) — semantically distinct. */}
        <AnimatePresence initial={false}>
          {visiblePanes.map((pane, i) => {
            const mode = paneMode(pane)

            return (
              <motion.div
                key={pane.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SLOT_FADE_TRANSITION}
                // Skip the dispatch when this slot's pane is already
                // active. applyActivePane returns the same reference
                // on no-op, but expressing the guard at the call site
                // keeps the semantic clean: every click that survives
                // this handler is a real focus change. Mirrors the
                // already-active escape-hatch in usePaneShortcuts.
                onClick={
                  pane.active
                    ? undefined
                    : (): void => onSetActivePane?.(session.id, pane.id)
                }
                data-testid="split-view-slot"
                data-pane-id={pane.id}
                data-pty-id={pane.ptyId}
                data-mode={mode}
                data-cwd={pane.cwd}
                className="relative min-h-0 min-w-0"
                style={{ gridArea: `p${i}` }}
              >
                {/* F16 (codex connector P1, carried over from pre-5b TerminalZone):
                  keying TerminalPane by `pane.ptyId` (NOT `pane.id`) forces a
                  clean useTerminal subtree unmount + remount whenever a
                  restartSession rotates the pane's PTY handle. Without the
                  key swap, the stale useTerminal ref stays bound to the
                  dead pre-restart PTY and typing into the pane goes
                  nowhere until reload. The outer slot wrapper above keys
                  by `pane.id` so layout slot identity is preserved across
                  restarts. */}
                <TerminalPane
                  key={pane.ptyId}
                  ref={getPaneRefSetter(pane.id)}
                  session={session}
                  pane={pane}
                  service={service}
                  mode={mode}
                  onCwdChange={(cwd) =>
                    onSessionCwdChange?.(session.id, pane.id, cwd)
                  }
                  onPaneReady={onPaneReady}
                  onRestart={onSessionRestart}
                  onClose={
                    session.panes.length > 1 && onClosePane
                      ? onClosePane
                      : undefined
                  }
                  isActive={isActive}
                  deferFit={deferTerminalFit}
                  showFocusHighlight={showPaneFocusHighlight}
                />
              </motion.div>
            )
          })}
          {onAddPane
            ? emptySlotIndices.map((slotIndex) => (
                <motion.div
                  key={`empty-${slotIndex}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={SLOT_FADE_TRANSITION}
                  data-testid="split-view-empty-slot"
                  data-slot-index={slotIndex}
                  className="relative min-h-0 min-w-0"
                  style={{ gridArea: `p${slotIndex}` }}
                >
                  <EmptySlot sessionId={session.id} onAddPane={onAddPane} />
                </motion.div>
              ))
            : null}
        </AnimatePresence>
      </div>
    )
  }
)
