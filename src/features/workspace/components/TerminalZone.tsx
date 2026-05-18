/* eslint-disable react/require-default-props */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type PointerEvent,
  type ReactElement,
} from 'react'
import type { LayoutId, Session } from '../../sessions/types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import { isOpenSessionStatus } from '../../sessions/utils/pickNextVisibleSessionId'
import { LayoutSwitcher } from '../../terminal/components/LayoutSwitcher'
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
  /**
   * Called when the user clicks Restart on an Exited (awaiting-restart) pane.
   */
  onSessionRestart?: (sessionId: string) => void
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
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
  addPane: (sessionId: string) => void
  removePane: (sessionId: string, paneId: string) => void
  /**
   * Modifier glyph for the toolbar hint ('⌘' on macOS, 'Ctrl' on other
   * platforms). Sourced from `WorkspaceView` so the visible label and
   * `usePaneShortcuts.preferModifier` (which gates which modifier the
   * hook intercepts) share a single platform-detection site and can
   * never drift. Defaults to `'Ctrl'` for tests / sandboxed renders
   * that don't pass it explicitly.
   */
  modKey?: '⌘' | 'Ctrl'
  isZoneFocused?: boolean
  onContainerFocus?: () => void
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
      onSessionRestart = undefined,
      deferTerminalFit = false,
      service,
      setSessionActivePane,
      setSessionLayout,
      addPane,
      removePane,
      modKey = 'Ctrl',
      isZoneFocused = true,
      onContainerFocus = undefined,
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
      onContainerFocus?.()

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

    const activeSession = sessions.find(
      (session) => session.id === activeSessionId
    )

    const showToolbar =
      !loading && sessions.length > 0 && activeSession !== undefined

    // Memoised onPick so a future `React.memo(LayoutSwitcher)` would
    // see a stable reference until the active session id changes.
    // `setSessionLayout` is itself a stable `useCallback([])`, so the
    // dep list collapses to `pickSessionId`. The callback is only
    // mounted via `showToolbar === true`, which itself requires
    // `activeSession !== undefined`, so the undefined branch is
    // unreachable from the LayoutSwitcher mount site. The optional
    // chain stays in for the TS-level narrowing; the `if (!pickSessionId)`
    // bail satisfies the compiler without adding a non-null assertion.
    const pickSessionId = activeSession?.id

    const onPickLayout = useCallback(
      (layoutId: LayoutId): void => {
        if (!pickSessionId) {
          return
        }
        setSessionLayout(pickSessionId, layoutId)
      },
      [pickSessionId, setSessionLayout]
    )

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
        {showToolbar ? (
          <div
            data-testid="layout-toolbar"
            className="flex shrink-0 items-center gap-2 bg-surface-container px-3 py-2"
          >
            <LayoutSwitcher
              activeLayoutId={activeSession.layout}
              onPick={onPickLayout}
            />
            <span className="ml-auto hidden items-center gap-1 font-mono text-xs text-on-surface-muted sm:inline-flex">
              <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
              <span>+1-4 pane</span>
              <span>·</span>
              <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
              <span>+{'\\'} layout</span>
              <span>·</span>
              <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
              <span>+e editor</span>
              <span>·</span>
              <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
              <span>+g diff</span>
              <span>·</span>
              <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
              <span>+b back</span>
            </span>
          </div>
        ) : null}

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
              <p>
                No active session. Click + in the session tab bar above to
                create one.
              </p>
            </div>
          ) : (
            // Render all sessions but hide inactive ones to keep PTY sessions alive.
            sessions.map((session) => {
              const isActive = session.id === activeSessionId

              // SessionTabs.open keeps a tab for running/paused sessions OR
              // the active session — completed/errored non-active sessions
              // exist as panels here but have no corresponding tab id, so
              // aria-labelledby would point at a non-existent element. Only
              // wire the linkage when the panel actually has a visible tab
              // (= isActive OR open status). Hidden panels stay aria-clean.
              // Use the canonical `isOpenSessionStatus` predicate from the
              // utility (same source as Sidebar's Active/Recent grouping)
              // so a future non-open status (e.g. `suspended`) auto-flows
              // into both visibility surfaces without TerminalZone needing
              // a separate update.
              const hasVisibleTab =
                isActive || isOpenSessionStatus(session.status)

              return (
                <div
                  key={session.id}
                  id={`session-panel-${session.id}`}
                  role="tabpanel"
                  aria-labelledby={
                    hasVisibleTab ? `session-tab-${session.id}` : undefined
                  }
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
                    onSessionRestart={onSessionRestart}
                    onSetActivePane={setSessionActivePane}
                    onAddPane={addPane}
                    onClosePane={removePane}
                    deferTerminalFit={deferTerminalFit}
                    showPaneFocusHighlight={isZoneFocused}
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
