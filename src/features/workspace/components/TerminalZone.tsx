import { useCallback, useMemo, type ReactElement } from 'react'
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
}: TerminalZoneProps): ReactElement => {
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId
  )

  const showToolbar =
    !loading && sessions.length > 0 && activeSession !== undefined

  // `navigator.platform` is deprecated per MDN; prefer
  // `navigator.userAgentData.platform` (Chromium-only) and fall through
  // to the legacy field on WebKit / older browsers where `userAgentData`
  // is undefined. The chained form keeps the check valid in Tauri's
  // WebKit webview today AND in any future Chromium-based shell. The
  // legacy `navigator.platform` fallback is intentional — it's the only
  // programmatic platform signal on WebKit and the runtime value is
  // stable on every target Vimeflow ships against. TypeScript flags it
  // as deprecated (TS 6385) at the read site, but `tsc -b` does not
  // promote that to an error so the chained read compiles cleanly.
  // The platform check reads the (stable for a given browser session)
  // navigator value once and memoizes — TerminalZone re-renders on
  // every session activity tick, and re-running the DOM access every
  // time is wasted work even if it's cheap. `useMemo` with no deps
  // runs once per mount, mirrors the existing once-per-render IIFE
  // semantics, and remains compatible with the per-test
  // `Object.defineProperty(navigator, 'platform', …)` mock pattern —
  // the mock is set before each render, and useMemo's callback runs
  // on first render after the mock takes effect.
  const modKey = useMemo<string>(() => {
    if (typeof navigator === 'undefined') {
      return 'Ctrl'
    }

    const uad = (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData
    // Chromium's userAgentData.platform reports macOS as `"macOS"` (lower-
    // case "m"), while the legacy `navigator.platform` reports it as
    // `"MacIntel"` / `"MacPPC"`. Normalize to lowercase before the prefix
    // check so both shells produce the ⌘ glyph on macOS — the original
    // case-sensitive `.startsWith('Mac')` regressed Chromium users to
    // Ctrl (caught in codex verify cycle 1).
    const detected = (uad?.platform ?? navigator.platform).toLowerCase()

    return detected.startsWith('mac') ? '⌘' : 'Ctrl'
  }, [])

  // Memoised onPick so a future `React.memo(LayoutSwitcher)` would
  // see a stable reference until the active session id changes.
  // `setSessionLayout` is itself a stable `useCallback([])` exposed
  // from `useSessionManager`, so the dep list collapses to the
  // active session id.
  const activeSessionId_ = activeSession?.id

  const onPickLayout = useCallback(
    (layoutId: LayoutId): void => {
      if (activeSessionId_ === undefined) {
        return
      }
      setSessionLayout(activeSessionId_, layoutId)
    },
    [activeSessionId_, setSessionLayout]
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
