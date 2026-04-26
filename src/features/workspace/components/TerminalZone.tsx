import type { ReactElement } from 'react'
import type { Session } from '../types'
import { TerminalPane } from '../../terminal/components/TerminalPane'
import type {
  RestoreData,
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../hooks/useSessionManager'

export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionChange: (sessionId: string) => void
  onNewTab: () => void
  onCloseTab?: (sessionId: string) => void
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
}

export const TerminalZone = ({
  sessions,
  activeSessionId,
  onSessionChange,
  onNewTab,
  onCloseTab = undefined,
  onSessionCwdChange = undefined,
  restoreData = undefined,
  loading = false,
  onPaneReady = undefined,
}: TerminalZoneProps): ReactElement => {
  const handleTabClick = (sessionId: string): void => {
    if (activeSessionId === null || sessionId !== activeSessionId) {
      onSessionChange(sessionId)
    }
  }

  return (
    <div data-testid="terminal-zone" className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div
        data-testid="tab-bar"
        className="flex items-center gap-1 bg-surface-container-lowest px-2"
      >
        {/* Session tabs */}
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId

          return (
            <div
              key={session.id}
              className={`
                group flex items-center border-b-2 transition-colors
                ${
                  isActive
                    ? 'border-b-primary text-primary'
                    : 'border-b-transparent text-on-surface/60 hover:bg-surface-container/50 hover:text-on-surface'
                }
              `}
            >
              <button
                type="button"
                aria-label={`🤖 ${session.name}`}
                onClick={() => handleTabClick(session.id)}
                className="px-3 py-2 font-label text-sm"
              >
                🤖 {session.name}
              </button>
              <button
                type="button"
                aria-label={`Close ${session.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab?.(session.id)
                }}
                className="mr-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-container group-hover:opacity-100"
              >
                <span className="material-symbols-outlined text-xs">close</span>
              </button>
            </div>
          )
        })}

        {/* New tab button */}
        <button
          type="button"
          aria-label="New tab"
          onClick={onNewTab}
          className="px-3 py-2 font-label text-sm text-on-surface/60 transition-colors hover:bg-surface-container/50 hover:text-on-surface"
        >
          +
        </button>
      </div>

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
          // Render all sessions but hide inactive ones to keep PTY sessions alive
          sessions.map((session) => {
            const isActive = session.id === activeSessionId
            const restore = restoreData?.get(session.id)

            return (
              <div
                key={session.id}
                data-testid="terminal-pane"
                data-session-id={session.id}
                data-cwd={session.workingDirectory}
                className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
              >
                <TerminalPane
                  sessionId={session.id}
                  cwd={session.workingDirectory}
                  restoredFrom={restore}
                  onCwdChange={(cwd) => onSessionCwdChange?.(session.id, cwd)}
                  onPaneReady={onPaneReady}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
