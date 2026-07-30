// UI-only persistence + subscription for the workspace sidebar collapse
// preference. This is a WORKSPACE-GLOBAL choice (one flag for the app, not
// per-session) so the sidebar stays collapsed/expanded as you switch sessions.
// Mirrors the guards in features/editor/utils/readingStyleStore and
// features/sessions/utils/activityPanelCollapsedStore (SSR / sandboxed
// contexts / quota errors all fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore` so the in-card toggle, the icon
// rail toggle, the ⌘B shortcut, and the `:toggle-sidebar` command all stay in
// sync the instant the flag changes.

const STORAGE_KEY = 'vimeflow:workspace:sidebarCollapsed'

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

export const getSidebarCollapsed = (): boolean => current

export const setSidebarCollapsed = (collapsed: boolean): void => {
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

export const subscribeSidebarCollapsed = (
  listener: () => void
): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
