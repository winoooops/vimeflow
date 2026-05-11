import type { ReactElement } from 'react'
import type { Session } from '../../sessions/types'
import {
  TerminalPane,
  type TerminalPaneMode,
} from '../../terminal/components/TerminalPane'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../sessions/hooks/useSessionManager'
import { findActivePane } from '../../sessions/utils/activeSessionPane'
import { isOpenSessionStatus } from '../../sessions/utils/pickNextVisibleSessionId'

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
}: TerminalZoneProps): ReactElement => (
  <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
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
        // Decide explicit mode for this pane. Pinning the lifecycle here
        // avoids the previous bug (TerminalPane inferred from
        // restoredFrom===undefined, which spawned a hidden duplicate PTY
        // for newly-created sessions and resurrected dead ones on reload).
        sessions.map((session) => {
          const isActive = session.id === activeSessionId
          // Non-throwing variant: transient invariant violations (e.g. zero
          // active panes mid-state-update during 5b multi-pane edits) must
          // not crash the render tree. The session row is skipped until the
          // invariant is restored by the next mutation tick.
          const activePane = findActivePane(session)
          if (!activePane) {
            return null
          }

          // Rules (status-first, round 3 Finding 3 / codex P2):
          //  - Exited statuses (completed OR errored) →
          //    'awaiting-restart'. Render a Restart button; do NOT
          //    auto-spawn. Status check wins over restoreData because
          //    round-2 F1 made restoreData get seeded for every session
          //    (so per-session buffering works for newly-created tabs
          //    too) and nothing clears it when the PTY later exits. With
          //    restoreData-first precedence, a shell that terminates
          //    after mount stayed in 'attach' mode forever — the new
          //    Restart UX was unreachable until a full reload.
          //    Errored peers completed in the SessionStatus union (both
          //    are visible in the Sidebar Recent group + retained in the
          //    SessionTabs strip when active) so both must route here;
          //    skipping errored leaves a zombie attach or silent respawn
          //    on a dead PTY.
          //  - Has pane.restoreData → 'attach'. Covers Alive restored sessions
          //    AND newly-created sessions (createSession seeds an empty
          //    restoreData slot so the pane attaches instead of spawning).
          //  - Otherwise → 'spawn' (legacy fallback).
          let mode: TerminalPaneMode = 'spawn'
          if (
            activePane.status === 'completed' ||
            activePane.status === 'errored'
          ) {
            mode = 'awaiting-restart'
          } else if (activePane.restoreData) {
            mode = 'attach'
          }

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
          const hasVisibleTab = isActive || isOpenSessionStatus(session.status)

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
              data-pane-id={activePane.id}
              data-pty-id={activePane.ptyId}
              data-cwd={activePane.cwd}
              data-mode={mode}
              className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
            >
              {/* F16 (codex connector P1): key the inner TerminalPane by
                  pane.ptyId so a restartSession (which preserves Session.id
                  but rotates pane.ptyId) forces a clean unmount/remount of
                  the xterm + useTerminal subtree. Without this, the
                  mount-initialized refs inside useTerminal stay bound to
                  the dead pre-restart PTY and the user-visible pane
                  appears detached after restart. The outer wrapper div
                  keyed by session.id (above) is unchanged, so sidebar /
                  tab-strip / ARIA associations don't churn. */}
              <TerminalPane
                key={activePane.ptyId}
                session={session}
                pane={activePane}
                service={service}
                mode={mode}
                onCwdChange={(cwd) =>
                  onSessionCwdChange?.(session.id, activePane.id, cwd)
                }
                onPaneReady={onPaneReady}
                onRestart={onSessionRestart}
                isActive={isActive}
                deferFit={deferTerminalFit}
              />
            </div>
          )
        })
      )}
    </div>
  </div>
)
