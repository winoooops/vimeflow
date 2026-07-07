// Remembers the layout the user last created a session with, so the New Session
// dialog can default to it next time instead of always 'single'. UI-only
// preference; SSR / sandboxed / quota failures fall back to null (the caller
// then uses its own default). Mirrors the guards in sidebarCollapsedStore.
const STORAGE_KEY = 'vimeflow:newSession:lastLayout'

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

export const getLastLayout = (): string | null => {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  try {
    return storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const setLastLayout = (layoutId: string): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(STORAGE_KEY, layoutId)
  } catch {
    // ignore quota / sandbox write failures — this is a best-effort preference
  }
}
