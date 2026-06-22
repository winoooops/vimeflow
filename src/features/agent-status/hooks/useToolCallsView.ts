import { useSyncExternalStore } from 'react'

export type ToolCallsView = 'jar' | 'tags'

export const TOOL_CALLS_VIEW_STORAGE_KEY = 'vimeflow:agent-status:toolCallsView'
const DEFAULT_VIEW: ToolCallsView = 'jar'

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    // Sandboxed / disabled storage — fall back to in-memory state.
    return null
  }
}

const readPersisted = (): ToolCallsView => {
  const storage = getStorage()
  if (!storage) {
    return DEFAULT_VIEW
  }
  try {
    return storage.getItem(TOOL_CALLS_VIEW_STORAGE_KEY) === 'tags'
      ? 'tags'
      : 'jar'
  } catch {
    // Read failure — use the default.
    return DEFAULT_VIEW
  }
}

let current: ToolCallsView = readPersisted()
const listeners = new Set<() => void>()

export const getToolCallsView = (): ToolCallsView => current

export const setToolCallsView = (view: ToolCallsView): void => {
  if (view === current) {
    return
  }
  current = view

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(TOOL_CALLS_VIEW_STORAGE_KEY, view)
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * The persisted Tool Calls view (`'jar' | 'tags'`) plus a setter. Backed by a
 * module-level pub/sub store (mirrors workspace's `sidebarCollapsedStore`) so
 * every mounted section agrees and the choice survives reloads.
 */
export const useToolCallsView = (): [
  ToolCallsView,
  (view: ToolCallsView) => void,
] => {
  const view = useSyncExternalStore(
    subscribe,
    getToolCallsView,
    getToolCallsView
  )

  return [view, setToolCallsView]
}
