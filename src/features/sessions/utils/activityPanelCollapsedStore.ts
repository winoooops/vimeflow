// UI-only persistence for the per-session agent-activity-panel collapse
// preference. Lives at the frontend layer (localStorage) so the state is
// decoupled from the PTY/agent lifecycle — toggling the bar should not
// flow through the backend session cache, and surviving a restart is a
// pure UI concern.
//
// Default `false` (expanded) when nothing has been persisted or when
// localStorage is unavailable (SSR, sandboxed contexts, quota errors).

const STORAGE_KEY_PREFIX = 'vimeflow:sessions:activityPanelCollapsed:'

const storageKey = (sessionId: string): string =>
  `${STORAGE_KEY_PREFIX}${sessionId}`

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const readActivityPanelCollapsed = (sessionId: string): boolean => {
  const storage = getStorage()
  if (!storage) {
    return false
  }
  try {
    return storage.getItem(storageKey(sessionId)) === 'true'
  } catch {
    return false
  }
}

export const writeActivityPanelCollapsed = (
  sessionId: string,
  collapsed: boolean
): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.setItem(storageKey(sessionId), collapsed ? 'true' : 'false')
  } catch {
    // Quota exceeded / private mode — UI state stays consistent in memory.
  }
}
