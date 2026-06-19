/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
// cspell:ignore vsplit hsplit
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LayoutId, Pane, Session } from '../../../sessions/types'
import { isShellPane } from '../../../sessions/utils/paneKind'
import { BrowserPane, focusBrowserPane } from '../../../browser'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { BurnerTarget } from '../../hooks/useBurnerTerminals'
import type { ITerminalService } from '../../services/terminalService'
import {
  TerminalPane,
  type TerminalPaneHandle,
  type TerminalPaneMode,
} from '../TerminalPane'
import { EmptySlot } from './EmptySlot'
import { LAYOUTS } from './layouts'
import { Tooltip } from '@/components/Tooltip'
import { SplitDividers } from './SplitDividers'
import { resolveGrid } from './resolveGrid'
import {
  DEFAULT_RATIOS,
  equalTrackRatios,
  gridAreaNameForSlotId,
  type LayoutRatios,
  type RatioAxis,
} from '../../layout-registry'

const SLOT_FADE_TRANSITION = { duration: 0.08, ease: 'easeOut' } as const

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onCommandSubmit?: (ptyId: string, command: string) => void
  onSessionRestart?: (sessionId: string) => void
  onSetActivePane?: (sessionId: string, paneId: string) => void
  onBrowserPaneUrlChange?: (
    sessionId: string,
    paneId: string,
    browserUrl: string
  ) => void
  onRequestFocus?: () => void
  onAddPane?: (sessionId: string, kind?: Pane['kind']) => void
  onClosePane?: (sessionId: string, paneId: string) => void
  /** Toggle a pane's ephemeral burner terminal (VIM-53). */
  onBurner?: (target: BurnerTarget) => void
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
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

// Closable whenever removing it still leaves the session at least one pane.
export const canClosePane = (session: Session): boolean =>
  session.panes.length > 1

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
      onCommandSubmit = undefined,
      onSessionRestart = undefined,
      onSetActivePane = undefined,
      onBrowserPaneUrlChange = undefined,
      onRequestFocus = undefined,
      onAddPane = undefined,
      onClosePane = undefined,
      onBurner = undefined,
      activeBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      deferTerminalFit = false,
      showPaneFocusHighlight = true,
    }: SplitViewProps,
    ref
  ): ReactElement {
    const layout = LAYOUTS[session.layout]
    const outerDivRef = useRef<HTMLDivElement>(null)

    const browserSessionId = session.id

    const [ratios, setRatios] = useState<
      Partial<Record<LayoutId, LayoutRatios>>
    >({})

    const currentRatios =
      ratios[session.layout] ?? DEFAULT_RATIOS[session.layout]
    const grid = resolveGrid(session.layout, currentRatios)

    const handleRatioChange = useCallback(
      (axis: RatioAxis, value: readonly number[]): void => {
        setRatios((prev) => {
          const base = prev[session.layout] ?? DEFAULT_RATIOS[session.layout]
          if (equalTrackRatios(base[axis], value)) {
            return prev
          }

          return { ...prev, [session.layout]: { ...base, [axis]: [...value] } }
        })
      },
      [session.layout]
    )

    // Mount SplitDividers (and their useElasticContainer hooks) only once the
    // grid actually has a measured size. Sessions mount while hidden
    // (display:none → 0×0) and useElasticContainer hard-throws on a zero
    // dimension at mount, so re-measure whenever `isActive` flips and the
    // session becomes visible.
    const [hasSize, setHasSize] = useState(false)
    useLayoutEffect(() => {
      const rect = outerDivRef.current?.getBoundingClientRect()
      setHasSize(Boolean(rect && rect.width > 0 && rect.height > 0))
    }, [isActive])

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
              // paneRefSetters entry kept intentionally: stable closure over
              // `id`, safe to reuse on remount (avoids extra ref cycle after
              // ptyId key change on terminal restart).
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
        if ((activePane.kind ?? 'shell') === 'browser') {
          void focusBrowserPane({
            sessionId: browserSessionId,
            paneId: activePane.id,
          })

          return true
        }

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

    const gridTemplateAreas = grid.areas
      .map((row) => `"${row.join(' ')}"`)
      .join(' ')

    const gridAreaForSlotIndex = (slotIndex: number): string => {
      if (slotIndex < 0 || slotIndex >= layout.definition.slots.length) {
        return `p${slotIndex}`
      }

      return gridAreaNameForSlotId(layout.definition.slots[slotIndex].id)
    }

    return (
      <div
        data-testid="split-view-canvas"
        className="h-full w-full bg-surface p-2.5"
      >
        <div
          ref={outerDivRef}
          data-testid="split-view"
          data-session-id={session.id}
          data-browser-session-id={browserSessionId}
          data-layout={session.layout}
          tabIndex={-1}
          className="grid h-full w-full gap-0"
          style={{
            gridTemplateColumns: grid.cols,
            gridTemplateRows: grid.rows,
            gridTemplateAreas,
          }}
        >
          {/* eslint-disable-next-line react/jsx-boolean-value -- framer-motion: `initial={false}` skips the entry animation for children already mounted. Omitting `initial` reverts to the default (animate on mount) — semantically distinct. */}
          <AnimatePresence initial={false}>
            {visiblePanes.map((pane, i) => {
              const isBrowserPane = !isShellPane(pane)
              const mode = isBrowserPane ? 'browser' : paneMode(pane)

              const closeHandler =
                onClosePane && canClosePane(session) ? onClosePane : undefined

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
                  data-pane-kind={pane.kind ?? 'shell'}
                  data-pane-active={pane.active ? 'true' : 'false'}
                  data-pty-id={pane.ptyId}
                  data-mode={mode}
                  data-cwd={pane.cwd}
                  className="relative min-h-0 min-w-0"
                  style={{ gridArea: gridAreaForSlotIndex(i) }}
                >
                  {/* Inner Tooltip wrapper. The motion.div above carries
                  the click handler + grid placement; this inner Tooltip
                  attaches floating-ui hover handlers to a plain div so
                  the `cloneElement` merge doesn't have to negotiate
                  with framer-motion's prop-handling. The plain div
                  fills its parent so hover detection still covers the
                  whole slot. Disabled when the pane is active —
                  nothing to hint at, and overlaying an active
                  terminal with a popover would interfere. */}
                  <Tooltip
                    content={`Focus pane ${i + 1}`}
                    shortcut={['Mod', String(i + 1)]}
                    disabled={pane.active}
                    placement="top"
                  >
                    <div
                      data-testid="split-view-slot-inner"
                      className="h-full w-full"
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
                      {isBrowserPane ? (
                        <BrowserPane
                          key={pane.ptyId}
                          session={session}
                          pane={pane}
                          isActive={isActive}
                          onClose={closeHandler}
                          onRequestActive={onSetActivePane}
                          onRequestFocus={onRequestFocus}
                          onUrlChange={onBrowserPaneUrlChange}
                          showFocusHighlight={showPaneFocusHighlight}
                        />
                      ) : (
                        <TerminalPane
                          key={pane.ptyId}
                          ref={getPaneRefSetter(pane.id)}
                          session={session}
                          pane={pane}
                          service={service}
                          mode={paneMode(pane)}
                          onCwdChange={(cwd) =>
                            onSessionCwdChange?.(session.id, pane.id, cwd)
                          }
                          onPaneReady={onPaneReady}
                          onCommandSubmit={onCommandSubmit}
                          onRestart={onSessionRestart}
                          onClose={closeHandler}
                          onBurner={onBurner}
                          onRequestActive={onSetActivePane}
                          activeBurnerPaneKeys={activeBurnerPaneKeys}
                          runningBurnerPaneKeys={runningBurnerPaneKeys}
                          isActive={isActive}
                          deferFit={deferTerminalFit}
                          showFocusHighlight={showPaneFocusHighlight}
                        />
                      )}
                    </div>
                  </Tooltip>
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
                    style={{ gridArea: gridAreaForSlotIndex(slotIndex) }}
                  >
                    <EmptySlot sessionId={session.id} onAddPane={onAddPane} />
                  </motion.div>
                ))
              : null}
          </AnimatePresence>
          {isActive && hasSize ? (
            <SplitDividers
              layout={session.layout}
              containerRef={outerDivRef}
              ratios={currentRatios}
              onRatioChange={handleRatioChange}
            />
          ) : null}
        </div>
      </div>
    )
  }
)
