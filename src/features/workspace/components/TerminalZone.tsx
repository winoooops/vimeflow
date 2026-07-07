/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type PointerEvent,
  type ReactElement,
} from 'react'
import type {
  LayoutSlotId,
  PaneKind,
  PanePlacement,
  Session,
} from '../../sessions/types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type { BurnerTarget } from '../../terminal/hooks/useBurnerTerminals'
import type { PaneLayoutRegistry } from '../../terminal/layout-registry'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import {
  SplitView,
  type SplitViewHandle,
} from '../../terminal/components/SplitView'
import { TERMINAL_CONTAINER_ID } from '../containerIds'

export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  /** True until the initial restore IPC + drain completes */
  loading?: boolean
  /**
   * Called by each TerminalPane once its live pty-data subscription is
   * attached. Forwarded from `useSessionManager.notifyPaneReady`.
   */
  onPaneReady?: (
    ptyId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onCommandSubmit?: (ptyId: string, command: string) => void
  /**
   * Called when the user clicks Restart on an Exited (awaiting-restart) pane.
   */
  onSessionRestart?: (sessionId: string, paneId?: string) => void
  /**
   * Temporarily hold xterm fitting while surrounding workspace chrome is being
   * dragged. The active terminal gets one final fit when the drag ends.
   */
  deferTerminalFit?: boolean
  /**
   * Terminal service forwarded to every `TerminalPane`. MUST be the same
   * instance the parent passes to `useSessionManager` — see Round 4
   * Finding 1 in `useSessionManager.ts` for the rationale.
   */
  service: ITerminalService
  setSessionActivePane: (sessionId: string, paneId: string) => void
  updateBrowserPaneUrl?: (
    sessionId: string,
    paneId: string,
    browserUrl: string
  ) => void
  addPane: (sessionId: string, kind?: PaneKind, slotId?: LayoutSlotId) => void
  removePane: (sessionId: string, paneId: string) => void
  /** VIM-167: persist a drag-into-slot swap/move. Forwarded to SplitView. */
  setSessionPlacements?: (
    sessionId: string,
    placements: PanePlacement[]
  ) => void
  isZoneFocused?: boolean
  onContainerFocus?: () => void
  /** Toggle a pane's ephemeral burner terminal (VIM-53). */
  onBurner?: (target: BurnerTarget) => void
  /** Sync a pane's burner terminal back to its host pane cwd. */
  onSyncBurner?: (target: BurnerTarget) => void
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys whose burner secondary terminal is currently visible. */
  openBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys whose burner terminal cwd has drifted from its host pane cwd. */
  outOfSyncBurnerPaneKeys?: ReadonlySet<string>
  showPaneFocusHighlight?: boolean
  terminalFontFamily?: string
  layoutRegistry?: PaneLayoutRegistry
}

export interface TerminalZoneHandle {
  focusActivePane(): boolean
}

export const TerminalZone = forwardRef<TerminalZoneHandle, TerminalZoneProps>(
  function TerminalZone(
    {
      sessions,
      activeSessionId,
      onSessionCwdChange = undefined,
      loading = false,
      onPaneReady = undefined,
      onCommandSubmit = undefined,
      onSessionRestart = undefined,
      deferTerminalFit = false,
      service,
      setSessionActivePane,
      updateBrowserPaneUrl = undefined,
      addPane,
      removePane,
      setSessionPlacements = undefined,
      isZoneFocused = true,
      onContainerFocus = undefined,
      onBurner = undefined,
      onSyncBurner = undefined,
      activeBurnerPaneKeys = undefined,
      openBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      outOfSyncBurnerPaneKeys = undefined,
      showPaneFocusHighlight = true,
      terminalFontFamily = undefined,
      layoutRegistry = undefined,
    }: TerminalZoneProps,
    ref
  ): ReactElement {
    const outerDivRef = useRef<HTMLDivElement>(null)
    const activeSplitViewRef = useRef<SplitViewHandle | null>(null)

    const setActiveSplitViewRefFn = useRef(
      (handle: SplitViewHandle | null): void => {
        activeSplitViewRef.current = handle
      }
    )

    useImperativeHandle(ref, () => ({
      focusActivePane(): boolean {
        if (!activeSplitViewRef.current) {
          outerDivRef.current?.focus()

          return false
        }

        const focused = activeSplitViewRef.current.focusActivePane()
        if (!focused) {
          outerDivRef.current?.focus()
        }

        return focused
      },
    }))

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
      // onContainerFocus is NOT called here — onFocus (bubbling) covers
      // both pointer and keyboard Tab paths, avoiding a double invocation.
      const target =
        event.target instanceof Element ? event.target : event.currentTarget

      if (
        !target.closest(
          'button,input,textarea,a,select,[tabindex]:not([tabindex="-1"])'
        )
      ) {
        event.currentTarget.focus()
      }
    }

    return (
      <div
        ref={outerDivRef}
        data-testid="terminal-zone"
        data-container-id={TERMINAL_CONTAINER_ID}
        tabIndex={-1}
        className={`flex min-h-0 flex-1 flex-col ${
          isZoneFocused ? 'opacity-100' : 'opacity-[0.65]'
        } transition-opacity duration-[220ms]`}
        onPointerDown={handlePointerDown}
        onFocus={(): void => {
          onContainerFocus?.()
        }}
      >
        {/* Layout controls live in the workspace top chrome bar (main-stage
            handoff J3) — TerminalZone renders no toolbar of its own. */}

        {/* Terminal content area — relative + absolute inner to give xterm explicit dimensions */}
        <div
          data-testid="terminal-content"
          className="relative min-h-0 flex-1 bg-surface"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center font-mono text-on-surface/60">
              <p>Restoring sessions...</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex h-full items-center justify-center font-mono text-on-surface/60">
              <p>No active session. Click + in the sidebar to create one.</p>
            </div>
          ) : (
            // Render all sessions but hide inactive ones to keep PTY sessions alive.
            sessions.map((session) => {
              const isActive = session.id === activeSessionId

              return (
                <div
                  key={session.id}
                  id={`session-panel-${session.id}`}
                  data-testid="terminal-pane"
                  data-session-id={session.id}
                  className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
                >
                  <SplitView
                    ref={isActive ? setActiveSplitViewRefFn.current : null}
                    session={session}
                    service={service}
                    isActive={isActive}
                    onSessionCwdChange={onSessionCwdChange}
                    onPaneReady={onPaneReady}
                    onCommandSubmit={onCommandSubmit}
                    onSessionRestart={onSessionRestart}
                    onSetActivePane={setSessionActivePane}
                    onBrowserPaneUrlChange={updateBrowserPaneUrl}
                    onRequestFocus={onContainerFocus}
                    onAddPane={addPane}
                    onClosePane={removePane}
                    onPanePlacementsChange={setSessionPlacements}
                    onBurner={onBurner}
                    onSyncBurner={onSyncBurner}
                    layoutRegistry={layoutRegistry}
                    activeBurnerPaneKeys={activeBurnerPaneKeys}
                    openBurnerPaneKeys={openBurnerPaneKeys}
                    runningBurnerPaneKeys={runningBurnerPaneKeys}
                    outOfSyncBurnerPaneKeys={outOfSyncBurnerPaneKeys}
                    deferTerminalFit={deferTerminalFit}
                    showPaneFocusHighlight={showPaneFocusHighlight}
                    terminalFontFamily={terminalFontFamily}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }
)
