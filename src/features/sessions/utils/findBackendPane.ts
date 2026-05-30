import type { Pane, Session } from '../types'
import { findActivePane } from './activeSessionPane'
import { isShellPane } from './paneKind'

export const findBackendSessionPane = (session: Session): Pane | undefined => {
  const activePane = findActivePane(session)
  if (!activePane) {
    return undefined
  }

  if (isShellPane(activePane)) {
    return activePane
  }

  const shellPanes = session.panes.filter(isShellPane)

  return shellPanes.find((p) => p.status === 'running') ?? shellPanes[0]
}
