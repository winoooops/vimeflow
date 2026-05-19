/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
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
        {/*
          The static keyboard-shortcut legend that used to live in
          this toolbar (`Mod+1-4 pane · Mod+\ layout · Mod+e editor ·
          Mod+g diff · Mod+b back`) was removed during the tooltip
          rollout — three of the five shortcuts are now surfaced via
          per-button tooltips (Mod+1-4 on pane slots, Mod+E on the
          Editor tab, Mod+G on the Diff Viewer tab). The remaining
          two — Mod+\ (cycle layout) and Mod+B (focus terminal from
          dock) — currently have NO in-UI discovery surface. See
          https://github.com/winoooops/vimeflow/issues/225 for the
          follow-up that introduces a focus-aware status-bar or
          adjacent-affordance pattern. Do NOT re-introduce a static
          legend here without coordinating with that issue.
        */}
        {showToolbar ? (
          <div
            data-testid="layout-toolbar"
            className="flex shrink-0 items-center gap-2 bg-surface-container px-3 py-2"
          >
            <LayoutSwitcher
              activeLayoutId={activeSession.layout}
              onPick={onPickLayout}
            />
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
