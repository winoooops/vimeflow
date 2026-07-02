/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
// cspell:ignore vsplit hsplit
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  LayoutSlotId,
  Pane,
  PaneKind,
  PaneLayoutId,
  PanePlacement,
  Session,
} from '../../../sessions/types'
import { isShellPane } from '../../../sessions/utils/paneKind'
import {
  movePaneToSlot,
  resolvePanePlacement,
  swapPanePlacements,
  type PaneSlotAssignment,
} from '../../../sessions/utils/panePlacements'
import { BrowserPane, focusBrowserPane } from '../../../browser'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { BurnerTarget } from '../../hooks/useBurnerTerminals'
import type { NativeGhosttyShortcutContext } from '../../nativeGhosttyClient'
import type { ITerminalService } from '../../services/terminalService'
import {
  TerminalPane,
  type TerminalPaneHandle,
  type TerminalPaneMode,
} from '../TerminalPane'
import { EmptySlot } from './EmptySlot'
import { Tooltip } from '@/components/Tooltip'
import { formatShortcut } from '@/lib/formatShortcut'
import { SplitDividers } from './SplitDividers'
import { resolveGrid } from './resolveGrid'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  equalTrackRatios,
  gridAreaNameForSlotId,
  isSupportedPaneKind,
  type LayoutShape,
  type PaneLayoutRegistry,
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
  onAddPane?: (
    sessionId: string,
    kind?: Pane['kind'],
    slotId?: LayoutSlotId
  ) => void
  onClosePane?: (sessionId: string, paneId: string) => void
  /**
   * VIM-167: persist a new pane-to-slot placement set after a drag-into-slot
   * swap/move. SplitView computes the fully-normalized placements (and enforces
   * `slot.accepts` gating) internally, then calls this with the result. Omit to
   * disable drag-into-slot (headers become non-draggable). Wired to
   * `useSessionManager.setSessionPlacements`.
   */
  onPanePlacementsChange?: (
    sessionId: string,
    placements: PanePlacement[]
  ) => void
  /** Toggle a pane's ephemeral burner terminal (VIM-53). */
  onBurner?: (target: BurnerTarget) => void
  layoutRegistry?: PaneLayoutRegistry
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
  deferTerminalFit?: boolean
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

export const resolveLayoutRatios = (
  layout: LayoutShape,
  saved: LayoutRatios | undefined
): LayoutRatios => {
  if (
    saved?.cols.length === layout.defaultRatios.cols.length &&
    saved.rows.length === layout.defaultRatios.rows.length
  ) {
    return saved
  }

  return layout.defaultRatios
}

export const getSlotOrderedPaneIds = (
  assignments: readonly PaneSlotAssignment[],
  layout: LayoutShape
): string[] => {
  const paneIdBySlotId = new Map(
    assignments.map(({ pane, slotId }) => [slotId, pane.id])
  )

  return layout.definition.addOrder.flatMap((slotId) => {
    const paneId = paneIdBySlotId.get(slotId)

    return paneId === undefined ? [] : [paneId]
  })
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
      onPanePlacementsChange = undefined,
      onBurner = undefined,
      layoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY,
      activeBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      deferTerminalFit = false,
    }: SplitViewProps,
    ref
  ): ReactElement {
    const layout = layoutRegistry.getFallbackLayout(session.layout)
    const outerDivRef = useRef<HTMLDivElement>(null)

    const browserSessionId = session.id

    const [ratios, setRatios] = useState<
      Partial<Record<PaneLayoutId, LayoutRatios>>
    >({})

    const currentRatios = resolveLayoutRatios(layout, ratios[layout.id])
    const grid = resolveGrid(layout, currentRatios)

    const handleRatioChange = useCallback(
      (axis: RatioAxis, value: readonly number[]): void => {
        setRatios((prev) => {
          const base = resolveLayoutRatios(layout, prev[layout.id])
          if (equalTrackRatios(base[axis], value)) {
            return prev
          }

          return { ...prev, [layout.id]: { ...base, [axis]: [...value] } }
        })
      },
      [layout]
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

    // VIM-167 drag-into-slot state: which pane is mid-drag, and which slot the
    // cursor is over (drives the valid-target highlight). Both reset on
    // dragend / drop.
    const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null)

    const [dragOverSlotId, setDragOverSlotId] = useState<LayoutSlotId | null>(
      null
    )

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

    const { assignments: visiblePaneAssignments, emptySlotIds } =
      resolvePanePlacement(visiblePanes, layout, session.placements)

    const visibleShortcutPaneIds = getSlotOrderedPaneIds(
      visiblePaneAssignments,
      layout
    )

    const visibleShortcutPaneIdsKey = visibleShortcutPaneIds.join('\u0000')

    const activePaneId =
      session.panes.find((sessionPane) => sessionPane.active)?.id ?? null

    const nativeShortcutContext = useMemo<NativeGhosttyShortcutContext>(
      () => ({
        paneIds:
          visibleShortcutPaneIdsKey.length > 0
            ? visibleShortcutPaneIdsKey.split('\u0000')
            : [],
        activePaneId,
      }),
      [activePaneId, visibleShortcutPaneIdsKey]
    )

    const gridTemplateAreas = grid.areas
      .map((row) => `"${row.join(' ')}"`)
      .join(' ')

    const gridAreaForSlotId = (slotId: LayoutSlotId): string => {
      if (!layout.definition.addOrder.includes(slotId)) {
        throw new Error(
          `Slot ${slotId} is unknown for layout ${layout.definition.id}`
        )
      }

      return gridAreaNameForSlotId(slotId)
    }

    // Resolve a slot's pane-kind restriction from the layout definition.
    // Narrows the stored `accepts` (typed as string[]) to known PaneKinds so
    // unknown values are dropped defensively; undefined/empty stays undefined
    // ("no restriction") so EmptySlot keeps both add-buttons.
    const acceptsForSlotId = (
      slotId: LayoutSlotId
    ): readonly PaneKind[] | undefined => {
      const accepts = layout.definition.slots.find(
        (slot) => slot.id === slotId
      )?.accepts
      if (accepts === undefined) {
        return undefined
      }

      const kinds = accepts.filter(isSupportedPaneKind)

      return kinds.length === 0 ? undefined : kinds
    }

    // VIM-167 drag-into-slot. Enabled only when a placements sink is wired.
    const dndEnabled = onPanePlacementsChange !== undefined

    const kindForPane = (pane: Pane): PaneKind => pane.kind ?? 'shell'

    // undefined / empty accepts means "no restriction" — never blocks.
    const slotAcceptsKind = (slotId: LayoutSlotId, kind: PaneKind): boolean => {
      const accepts = acceptsForSlotId(slotId)

      return accepts === undefined || accepts.includes(kind)
    }

    const slotIdByPaneId = new Map(
      visiblePaneAssignments.map(({ pane, slotId }) => [pane.id, slotId])
    )

    const paneById = new Map(
      visiblePaneAssignments.map(({ pane }) => [pane.id, pane])
    )

    const paneBySlotId = new Map(
      visiblePaneAssignments.map(({ pane, slotId }) => [slotId, pane])
    )

    // Whether the in-flight drag may legally land on `targetSlotId`. For a swap
    // (occupied target) BOTH destination slots must accept the kind that will
    // occupy them; for a move (empty target) only the target slot is checked.
    const canDropOnSlot = (
      targetSlotId: LayoutSlotId,
      paneId = draggingPaneId
    ): boolean => {
      if (paneId === null) {
        return false
      }

      const draggingPane = paneById.get(paneId)
      const draggingSlotId = slotIdByPaneId.get(paneId)
      if (!draggingPane || draggingSlotId === undefined) {
        return false
      }

      // Dropping a pane onto its own slot is a no-op, never a valid target.
      if (draggingSlotId === targetSlotId) {
        return false
      }

      const draggingKind = kindForPane(draggingPane)
      const occupant = paneBySlotId.get(targetSlotId)
      if (occupant) {
        return (
          slotAcceptsKind(targetSlotId, draggingKind) &&
          slotAcceptsKind(draggingSlotId, kindForPane(occupant))
        )
      }

      return slotAcceptsKind(targetSlotId, draggingKind)
    }

    const handlePaneDragStart = (
      paneId: string,
      event: DragEvent<HTMLDivElement>
    ): void => {
      if (!dndEnabled) {
        return
      }

      setDraggingPaneId(paneId)
      // text/plain carries the paneId for environments that read it on drop;
      // the highlight + drop logic relies on `draggingPaneId` state because
      // dataTransfer is unreadable during dragover.
      event.dataTransfer.setData('text/plain', paneId)
      event.dataTransfer.effectAllowed = 'move'
    }

    const handlePaneDragEnd = (): void => {
      setDraggingPaneId(null)
      setDragOverSlotId(null)
    }

    const handleSlotDragOver = (
      slotId: LayoutSlotId,
      event: DragEvent<HTMLDivElement>
    ): void => {
      if (!dndEnabled || !canDropOnSlot(slotId)) {
        return
      }

      // preventDefault marks this element a valid drop target so `drop` fires.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOverSlotId !== slotId) {
        setDragOverSlotId(slotId)
      }
    }

    const handleSlotDragLeave = (
      slotId: LayoutSlotId,
      event: DragEvent<HTMLDivElement>
    ): void => {
      // Ignore dragleave when the pointer merely crosses between child
      // elements of the same slot — relatedTarget still lives inside the slot.
      // Without this guard the highlight flickers off/on as the cursor moves
      // over inner content (drag handle, terminal body, drop indicator).
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return
      }

      setDragOverSlotId((current) => (current === slotId ? null : current))
    }

    const handleSlotDrop = (
      slotId: LayoutSlotId,
      event: DragEvent<HTMLDivElement>
    ): void => {
      if (!onPanePlacementsChange) {
        return
      }

      const transferred = event.dataTransfer.getData('text/plain')

      const paneId =
        draggingPaneId ?? (transferred.length > 0 ? transferred : null)

      setDraggingPaneId(null)
      setDragOverSlotId(null)

      if (paneId === null || !canDropOnSlot(slotId, paneId)) {
        return
      }

      event.preventDefault()

      const occupant = paneBySlotId.get(slotId)

      const nextPlacements = occupant
        ? swapPanePlacements(
            visiblePanes,
            layout,
            session.placements,
            paneId,
            occupant.id
          )
        : movePaneToSlot(
            visiblePanes,
            layout,
            session.placements,
            paneId,
            slotId
          )

      onPanePlacementsChange(session.id, nextPlacements)
    }

    const isValidDropActive = (slotId: LayoutSlotId): boolean =>
      dragOverSlotId === slotId && canDropOnSlot(slotId)

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
            {visiblePaneAssignments.map(({ pane, slotId }) => {
              const isBrowserPane = !isShellPane(pane)
              const mode = isBrowserPane ? 'browser' : paneMode(pane)
              const slotIndex = layout.definition.addOrder.indexOf(slotId)

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
                  data-slot-id={slotId}
                  data-slot-index={slotIndex}
                  data-drop-active={
                    isValidDropActive(slotId) ? 'true' : undefined
                  }
                  // onDragOver/onDrop/onDragLeave are standard DOM events that
                  // pass through motion.div untouched (framer-motion only
                  // overrides onDragStart/onDrag/onDragEnd for its gesture
                  // API, which we never use here).
                  onDragOver={
                    dndEnabled
                      ? (event): void => handleSlotDragOver(slotId, event)
                      : undefined
                  }
                  onDragLeave={
                    dndEnabled
                      ? (event): void => handleSlotDragLeave(slotId, event)
                      : undefined
                  }
                  onDrop={
                    dndEnabled
                      ? (event): void => handleSlotDrop(slotId, event)
                      : undefined
                  }
                  className="relative min-h-0 min-w-0"
                  style={{ gridArea: gridAreaForSlotId(slotId) }}
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
                      <>
                        {dndEnabled ? (
                          <Tooltip content="Drag to move pane" placement="top">
                            {/* Native DnD has no keyboard reorder path yet; keep this out of the tab order until one exists. */}
                            <div
                              data-testid="split-view-browser-drag-handle"
                              data-drag-handle="true"
                              draggable
                              onDragStart={(event): void =>
                                handlePaneDragStart(pane.id, event)
                              }
                              onDragEnd={handlePaneDragEnd}
                              className="absolute top-1 right-1 z-40 flex h-5 w-5 cursor-grab items-center justify-center rounded bg-surface-container/80 text-on-surface-muted hover:bg-surface-container"
                            >
                              <span
                                className="material-symbols-outlined text-[14px] leading-none"
                                aria-hidden="true"
                              >
                                drag_indicator
                              </span>
                            </div>
                          </Tooltip>
                        ) : null}
                        <BrowserPane
                          key={pane.ptyId}
                          session={session}
                          pane={pane}
                          isActive={isActive}
                          onClose={closeHandler}
                          onRequestActive={onSetActivePane}
                          onRequestFocus={onRequestFocus}
                          onUrlChange={onBrowserPaneUrlChange}
                          shortcutHint={
                            slotIndex < 9
                              ? formatShortcut(['Mod', String(slotIndex + 1)])
                              : undefined
                          }
                        />
                      </>
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
                        onRequestFocus={onRequestFocus}
                        activeBurnerPaneKeys={activeBurnerPaneKeys}
                        runningBurnerPaneKeys={runningBurnerPaneKeys}
                        isActive={isActive}
                        shortcutContext={nativeShortcutContext}
                        shortcutHint={
                          slotIndex < 9
                            ? formatShortcut(['Mod', String(slotIndex + 1)])
                            : undefined
                        }
                        deferFit={deferTerminalFit}
                        paneDraggable={dndEnabled}
                        onHeaderDragStart={(event): void =>
                          handlePaneDragStart(pane.id, event)
                        }
                        onHeaderDragEnd={handlePaneDragEnd}
                      />
                    )}
                    {isValidDropActive(slotId) ? (
                      <span
                        data-testid="split-view-drop-indicator"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-30 rounded-[10px] border-2 border-primary bg-primary/10"
                      />
                    ) : null}
                  </div>
                </motion.div>
              )
            })}
            {onAddPane || dndEnabled
              ? emptySlotIds.map((slotId) => {
                  const slotIndex = layout.definition.addOrder.indexOf(slotId)

                  return (
                    <motion.div
                      key={`empty-${slotId}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={SLOT_FADE_TRANSITION}
                      data-testid="split-view-empty-slot"
                      data-slot-id={slotId}
                      data-slot-index={slotIndex}
                      data-drop-active={
                        isValidDropActive(slotId) ? 'true' : undefined
                      }
                      onDragOver={
                        dndEnabled
                          ? (event): void => handleSlotDragOver(slotId, event)
                          : undefined
                      }
                      onDragLeave={
                        dndEnabled
                          ? (event): void => handleSlotDragLeave(slotId, event)
                          : undefined
                      }
                      onDrop={
                        dndEnabled
                          ? (event): void => handleSlotDrop(slotId, event)
                          : undefined
                      }
                      className="relative min-h-0 min-w-0"
                      style={{ gridArea: gridAreaForSlotId(slotId) }}
                    >
                      {onAddPane ? (
                        <EmptySlot
                          sessionId={session.id}
                          slotId={slotId}
                          accepts={acceptsForSlotId(slotId)}
                          onAddPane={onAddPane}
                        />
                      ) : (
                        <div className="h-full w-full rounded-lg border border-dashed border-outline-variant/35 bg-surface-container/35" />
                      )}
                      {isValidDropActive(slotId) ? (
                        <span
                          data-testid="split-view-drop-indicator"
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-30 rounded-lg border-2 border-primary bg-primary/10"
                        />
                      ) : null}
                    </motion.div>
                  )
                })
              : null}
          </AnimatePresence>
          {isActive && hasSize ? (
            <SplitDividers
              layout={layout}
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
