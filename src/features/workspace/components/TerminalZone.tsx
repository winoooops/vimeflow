import type { ReactElement } from 'react'
import type { Session } from '../types'
import {
  TerminalPane,
  type TerminalPaneMode,
} from '../../terminal/components/TerminalPane'
import type { ITerminalService } from '../../terminal/services/terminalService'
import type {
  RestoreData,
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../hooks/useSessionManager'

export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionCwdChange?: (sessionId: string, cwd: string) => void
  /** Restore data per session id, populated during mount-time restore */
  restoreData?: Map<string, RestoreData>
  /** True until the initial restore IPC + drain completes */
  loading?: boolean
  /**
   * Called by each TerminalPane once its live pty-data subscription is
   * attached. Forwarded from `useSessionManager.notifyPaneReady`.
   */
  onPaneReady?: (
    sessionId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  /**
   * Called when the user clicks Restart on an Exited (awaiting-restart) pane.
   */
  onSessionRestart?: (sessionId: string) => void
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
  restoreData = undefined,
  loading = false,
  onPaneReady = undefined,
  onSessionRestart = undefined,
  service,
}: TerminalZoneProps): ReactElement => (
  <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
    {/* DEBUG: zone info (dev only) */}
    {import.meta.env.DEV && (
      <div className="bg-yellow-900/50 px-2 py-0.5 text-xs font-mono text-yellow-300">
        DEBUG TerminalZone: {sessions.length} sessions | active=
        {activeSessionId ?? 'none'}
      </div>
    )}

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
          <p>No active session. Click + to create a new terminal.</p>
        </div>
      ) : (
        // Render all sessions but hide inactive ones to keep PTY sessions alive.
        // Decide explicit mode for this pane. Pinning the lifecycle here
        // avoids the previous bug (TerminalPane inferred from
        // restoredFrom===undefined, which spawned a hidden duplicate PTY
        // for newly-created sessions and resurrected dead ones on reload).
        sessions.map((session) => {
          const isActive = session.id === activeSessionId
          const restore = restoreData?.get(session.id)

          // Rules (status-first, round 3 Finding 3 / codex P2):
          //  - status === 'completed' (cached or just-Exited) →
          //    'awaiting-restart'. Render a Restart button; do NOT
          //    auto-spawn. Status check wins over restoreData because
          //    round-2 F1 made restoreData get seeded for every session
          //    (so per-session buffering works for newly-created tabs
          //    too) and nothing clears it when the PTY later exits. With
          //    restoreData-first precedence, a shell that terminates
          //    after mount stayed in 'attach' mode forever — the new
          //    Restart UX was unreachable until a full reload.
          //  - Has restoreData → 'attach'. Covers Alive restored sessions
          //    AND newly-created sessions (createSession seeds an empty
          //    restoreData slot so the pane attaches instead of spawning).
          //  - Otherwise → 'spawn' (legacy fallback).
          let mode: TerminalPaneMode = 'spawn'
          if (session.status === 'completed') {
            mode = 'awaiting-restart'
          } else if (restore) {
            mode = 'attach'
          }

          return (
            <div
              key={session.id}
              data-testid="terminal-pane"
              data-session-id={session.id}
              data-cwd={session.workingDirectory}
              data-mode={mode}
              className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
            >
              <TerminalPane
                sessionId={session.id}
                cwd={session.workingDirectory}
                service={service}
                restoredFrom={restore}
                mode={mode}
                onCwdChange={(cwd) => onSessionCwdChange?.(session.id, cwd)}
                onPaneReady={onPaneReady}
                onRestart={onSessionRestart}
              />
            </div>
          )
        })
      )}
    </div>
  </div>
)
