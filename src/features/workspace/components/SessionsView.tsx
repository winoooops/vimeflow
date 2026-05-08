import type { ReactElement } from 'react'
import { List } from '../../sessions/components/List'
import type { Session } from '../../sessions/types'

export interface SessionsViewProps {
  hidden?: boolean
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onCreateSession: () => void
  onRemoveSession: (id: string) => void
  onRenameSession: (id: string, name: string) => void
  onReorderSessions: (reordered: Session[]) => void
}

export const SessionsView = ({
  hidden = false,
  sessions,
  activeSessionId,
  onSessionClick,
  onCreateSession,
  onRemoveSession,
  onRenameSession,
  onReorderSessions,
}: SessionsViewProps): ReactElement => (
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="sessions-view"
  >
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={onSessionClick}
      onNewInstance={onCreateSession}
      onRemoveSession={onRemoveSession}
      onRenameSession={onRenameSession}
      onReorderSessions={onReorderSessions}
    />

    <button
      type="button"
      onClick={onCreateSession}
      className="m-3 flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
      aria-label="New Instance"
      data-testid="sessions-view-new-instance"
    >
      <span className="material-symbols-outlined text-lg">bolt</span>
      <span>New Instance</span>
    </button>
  </div>
)
