import type { ReactElement } from 'react'
import { List } from '../../sessions/components/List'
import type { Session, SessionCloseResult } from '../../sessions/types'
import type { PaneLayoutRegistry } from '../../terminal/layout-registry'

export interface SessionsViewProps {
  hidden?: boolean
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onRemoveSession: (id: string) => SessionCloseResult
  onRenameSession: (id: string, name: string) => void
  onReorderSessions: (reordered: Session[]) => void
  layoutRegistry: PaneLayoutRegistry
}

export const SessionsView = ({
  hidden = false,
  sessions,
  activeSessionId,
  onSessionClick,
  onRemoveSession,
  onRenameSession,
  onReorderSessions,
  layoutRegistry,
}: SessionsViewProps): ReactElement => (
  // Tailwind v4 puts utilities in a higher cascade layer than `@layer base`
  // (where Preflight's `[hidden] { display: none }` lives), so a hardcoded
  // `flex` utility on the same element silently overrides the HTML `hidden`
  // attribute and both panels render simultaneously. Conditionally toggle
  // between the `hidden` and `flex` utilities (both in the utilities layer)
  // so display behavior reliably tracks the prop. `display: none` also
  // hides the subtree from the accessibility tree, so we don't need a
  // separate `aria-hidden`.
  <div
    className={`min-h-0 flex-1 flex-col ${hidden ? 'hidden' : 'flex'}`}
    data-testid="sessions-view"
  >
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={onSessionClick}
      onRemoveSession={onRemoveSession}
      onRenameSession={onRenameSession}
      onReorderSessions={onReorderSessions}
      layoutRegistry={layoutRegistry}
    />
  </div>
)
