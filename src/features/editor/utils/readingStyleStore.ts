// UI-only persistence + subscription for the markdown reading-style preference.
// Lives at the frontend layer (localStorage) — it's a pure presentation choice,
// shared across every reading view and persisted across restarts. Mirrors the
// guards in features/sessions/utils/activityPanelCollapsedStore (SSR / sandboxed
// contexts / quota errors all fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore` so the ⚙ menu and the reading
// view (and any number of docks) stay in sync the instant the choice changes.

import {
  DEFAULT_READING_STYLE,
  isReadingStyleId,
  type ReadingStyleId,
} from '../data/readingStyles'

const STORAGE_KEY = 'vimeflow:editor:readingStyle'

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

const readPersisted = (): ReadingStyleId => {
  const storage = getStorage()
  if (!storage) {
    return DEFAULT_READING_STYLE.id
  }
  try {
    const value = storage.getItem(STORAGE_KEY)

    return isReadingStyleId(value) ? value : DEFAULT_READING_STYLE.id
  } catch {
    return DEFAULT_READING_STYLE.id
  }
}

let current: ReadingStyleId = readPersisted()
const listeners = new Set<() => void>()

export const getReadingStyleId = (): ReadingStyleId => current

export const setReadingStyleId = (id: ReadingStyleId): void => {
  if (id === current) {
    return
  }
  current = id

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, id)
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => {
    listener()
  })
}

export const subscribeReadingStyle = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
