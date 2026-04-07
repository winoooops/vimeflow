import type { ReactElement } from 'react'
import type { Session } from '../types'

export interface TerminalZoneProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionChange: (sessionId: string) => void
  onNewTab: () => void
}

export const TerminalZone = ({
  sessions,
  activeSessionId,
  onSessionChange,
  onNewTab,
}: TerminalZoneProps): ReactElement => {
  const handleTabClick = (sessionId: string): void => {
    if (activeSessionId === null || sessionId !== activeSessionId) {
      onSessionChange(sessionId)
    }
  }

  return (
    <div data-testid="terminal-zone" className="flex h-full flex-col">
      {/* Tab bar */}
      <div
        data-testid="tab-bar"
        className="flex items-center gap-1 bg-surface-container-lowest px-2"
      >
        {/* Session tabs */}
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId

          return (
            <button
              key={session.id}
              type="button"
              aria-label={`🤖 ${session.name}`}
              onClick={() => handleTabClick(session.id)}
              className={`
                border-b-2 px-3 py-2 font-label text-sm transition-colors
                ${
                  isActive
                    ? 'border-b-primary text-primary'
                    : 'border-b-transparent text-on-surface/60 hover:bg-surface-container/50 hover:text-on-surface'
                }
              `}
            >
              🤖 {session.name}
            </button>
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

      {/* Terminal content area */}
      <div
        data-testid="terminal-content"
        className="flex flex-1 items-center justify-center bg-surface font-mono text-on-surface/60"
      >
        <p>Terminal output will appear here</p>
      </div>
    </div>
  )
}
