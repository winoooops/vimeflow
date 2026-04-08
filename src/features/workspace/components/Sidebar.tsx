import type { ReactElement } from 'react'
import type { Session } from '../types'
import { FileExplorer } from './panels/FileExplorer'

export interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (sessionId: string) => void
  onNewInstance?: () => void
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) {
    return 'just now'
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }

  return `${diffDays}d ago`
}

export const Sidebar = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewInstance = undefined,
}: SidebarProps): ReactElement => (
  <div
    className="flex h-full w-64 flex-col bg-surface-container-low"
    data-testid="sidebar"
  >
    {/* Sessions section header */}
    <div className="flex items-center justify-between px-3 py-2">
      <h2 className="font-label text-sm font-semibold uppercase tracking-wider text-on-surface/70">
        Active Sessions
      </h2>
      <button
        type="button"
        onClick={onNewInstance}
        className="material-symbols-outlined text-lg text-primary transition-transform hover:rotate-90"
        aria-label="Add session"
        title="Add session"
      >
        add
      </button>
    </div>

    {/* Session list */}
    <div
      className="flex flex-1 flex-col gap-1 overflow-y-auto px-2"
      data-testid="session-list"
    >
      {sessions.length === 0 ? (
        <div className="px-3 py-4 text-center text-sm text-on-surface/50">
          No sessions
        </div>
      ) : (
        sessions.map((session) => {
          const isActive = session.id === activeSessionId

          return (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                onSessionClick(session.id)
              }}
              className={`
                flex flex-col gap-1 rounded-lg p-3
                text-left transition-colors relative group
                ${
                  isActive
                    ? 'bg-slate-800/80 text-primary-container'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }
              `}
              aria-label={session.name}
            >
              {/* Icon and session name */}
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">
                  {isActive ? 'terminal' : 'history'}
                </span>
                <span className="truncate font-label text-sm font-medium">
                  {session.name}
                </span>
              </div>

              {/* LIVE badge on hover for active session */}
              {isActive && (
                <span className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 rounded-full bg-primary px-2 py-0.5 font-label text-xs font-bold text-on-primary transition-opacity">
                  LIVE
                </span>
              )}

              {/* Timestamp */}
              <span
                className="font-body text-xs text-on-surface/60"
                data-testid="session-timestamp"
              >
                {formatRelativeTime(session.lastActivityAt)}
              </span>
            </button>
          )
        })
      )}
    </div>

    {/* File Explorer section */}
    <FileExplorer />

    {/* New Instance button */}
    <div className="p-3">
      <button
        type="button"
        onClick={onNewInstance}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
        aria-label="New Instance"
      >
        <span className="material-symbols-outlined text-lg">bolt</span>
        <span>New Instance</span>
      </button>
    </div>
  </div>
)
