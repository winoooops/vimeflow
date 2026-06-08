import { CACHE_HISTORY_LIMIT } from '../../agent-status/utils/cacheRate'

const STORAGE_KEY_PREFIX = 'vimeflow:agent:cacheHistory:'

const storageKey = (ptyId: string): string => `${STORAGE_KEY_PREFIX}${ptyId}`

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

const isPercent = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100

export const readCacheHistory = (ptyId: string): number[] => {
  const storage = getStorage()
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(storageKey(ptyId))
    if (raw === null) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isPercent)) {
      return []
    }

    return parsed.slice(-CACHE_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export const writeCacheHistory = (ptyId: string, history: number[]): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.setItem(storageKey(ptyId), JSON.stringify(history))
  } catch {
    // Quota exceeded / private mode — in-memory state stays consistent.
  }
}

export const deleteCacheHistory = (ptyId: string): void => {
  const storage = getStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(storageKey(ptyId))
  } catch {
    // Match the writer's silent-on-failure policy.
  }
}
