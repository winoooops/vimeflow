import type { Session } from '../../workspace/types'

export const subtitle = (session: Session): string => {
  if (session.currentAction !== undefined && session.currentAction !== '') {
    return session.currentAction
  }
  // Normalize Windows `\` to `/` first — Tauri can hand back native
  // separators (e.g. `C:\Users\alice\repo`); a `/`-only split would
  // collapse to one segment and render the full path instead of the
  // basename.
  const normalized = session.workingDirectory.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) {
    return session.workingDirectory || '~'
  }
  if (parts.length === 1) {
    return parts[0]
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
