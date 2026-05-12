import { useCallback, type ReactElement } from 'react'
import type { LayoutId, Session } from '../../sessions/types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import { isOpenSessionStatus } from '../../sessions/utils/pickNextVisibleSessionId'
import { LayoutSwitcher } from '../../terminal/components/LayoutSwitcher'
import { SplitView } from '../../terminal/components/SplitView'

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
  /**
   * Modifier glyph for the toolbar hint ('⌘' on macOS, 'Ctrl' on other
   * platforms). Sourced from `WorkspaceView` so the visible label and
   * `usePaneShortcuts.preferModifier` (which gates which modifier the
   * hook intercepts) share a single platform-detection site and can
   * never drift. Defaults to `'Ctrl'` for tests / sandboxed renders
   * that don't pass it explicitly.
   */
  modKey?: '⌘' | 'Ctrl'
}

export const TerminalZone = ({
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
  modKey = 'Ctrl',
}: TerminalZoneProps): ReactElement => {
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
    <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
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
            <span>+1-4 focus</span>
            <span>·</span>
            <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>
            <span>+{'\\'} cycle</span>
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
              No active session. Click + in the session tab bar above to create
              one.
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
                  session={session}
                  service={service}
                  isActive={isActive}
                  onSessionCwdChange={onSessionCwdChange}
                  onPaneReady={onPaneReady}
                  onSessionRestart={onSessionRestart}
                  onSetActivePane={setSessionActivePane}
                  deferTerminalFit={deferTerminalFit}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
