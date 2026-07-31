// UI-only persistence + subscription for the right activity-panel collapse
// preference. This is a WORKSPACE-GLOBAL choice (one flag for the app, not
// per-session) so the panel stays collapsed/expanded as you switch sessions.
// Mirrors features/workspace/utils/sidebarCollapsedStore (SSR / sandboxed
// contexts / quota errors all fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore` so the fixed toggle, the
// activity-panel shortcut, and the command palette entry all stay in sync
// the instant the flag changes.

const STORAGE_KEY = 'vimeflow:workspace:activityPanelCollapsed'

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

const readPersisted = (): boolean => {
  const storage = getStorage()
  if (!storage) {
    return false
  }
  try {
    return storage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let current: boolean = readPersisted()
const listeners = new Set<() => void>()

export const getActivityPanelCollapsed = (): boolean => current

export const setActivityPanelCollapsed = (collapsed: boolean): void => {
  if (collapsed === current) {
    return
  }
  current = collapsed

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false')
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => {
    listener()
  })
}

export const subscribeActivityPanelCollapsed = (
  listener: () => void
): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
