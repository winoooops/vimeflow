import type { ReactElement } from 'react'
import type { Session, SessionStatus, ContextPanelType } from '../types'
import { ContextSwitcher } from './ContextSwitcher'

export interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (sessionId: string) => void
  activeContextTab: ContextPanelType
  onContextTabChange: (tab: ContextPanelType) => void
}

function getStatusBadgeClasses(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'bg-primary-container text-primary'
    case 'paused':
      return 'bg-secondary-container/20 text-secondary'
    case 'completed':
      return 'bg-surface-container text-on-surface'
    case 'errored':
      return 'bg-error-container text-error'
  }
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
  activeContextTab,
  onContextTabChange,
}: SidebarProps): ReactElement => (
  <div
    className="flex h-full w-[260px] flex-col bg-surface-container-low"
    data-testid="sidebar"
  >
    {/* Sessions section header */}
    <div className="px-3 py-2">
      <h2 className="font-label text-sm font-semibold uppercase tracking-wider text-on-surface/70">
        Sessions
      </h2>
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
                flex flex-col gap-1 rounded-lg border-l-4 p-3
                text-left transition-colors
                ${
                  isActive
                    ? 'border-l-primary bg-surface-container'
                    : 'border-l-transparent hover:bg-surface-container/50'
                }
              `}
              aria-label={session.name}
            >
              {/* Session name and status */}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-label text-sm font-medium text-on-surface">
                  {session.name}
                </span>

                <span
                  className={`
                    rounded-full px-2 py-0.5 font-label text-xs font-medium
                    ${getStatusBadgeClasses(session.status)}
                  `}
                >
                  {session.status}
                </span>
              </div>

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

    {/* Context Switcher at bottom */}
    <ContextSwitcher
      activeTab={activeContextTab}
      onTabChange={onContextTabChange}
    />
  </div>
)
