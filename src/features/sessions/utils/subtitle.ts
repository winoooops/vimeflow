import type { Session } from '../types'
import { findActivePane } from './activeSessionPane'

export const subtitle = (session: Session): string => {
  if (session.currentAction !== undefined && session.currentAction !== '') {
    return session.currentAction
  }

  // Legacy persisted/test sessions can predate pane arrays; keep their
  // baseline working directory usable until storage migration is complete.
  const activePaneCwd = Array.isArray(session.panes)
    ? findActivePane(session)?.cwd
    : undefined
  const cwd = activePaneCwd ?? session.workingDirectory

  // Normalize Windows `\` to `/` first — Tauri can hand back native
  // separators (e.g. `C:\Users\alice\repo`); a `/`-only split would
  // collapse to one segment and render the full path instead of the
  // basename.
  const normalized = cwd.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) {
    return cwd || '~'
  }
  if (parts.length === 1) {
    return parts[0]
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
