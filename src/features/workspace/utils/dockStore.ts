// UI-only persistence + subscription for the workspace dock state (open,
// active tab, position). WORKSPACE-GLOBAL: one dock for the app, shared by
// every session. Mirrors the guards in sidebarCollapsedStore (SSR /
// sandboxed contexts / quota errors fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore`; the snapshot object identity
// changes only when a field actually changes, which keeps React re-renders
// minimal.

import type { DockPosition } from '../components/DockSwitcher'

export type DockTab = 'editor' | 'diff'

export interface DockState {
  open: boolean
  tab: DockTab
  position: DockPosition
}

const STORAGE_KEY = 'vimeflow:workspace:dock'

const DEFAULT_STATE: DockState = {
  open: false,
  tab: 'diff',
  position: 'bottom',
}

const isDockTab = (value: unknown): value is DockTab =>
  value === 'editor' || value === 'diff'

const isDockPosition = (value: unknown): value is DockPosition =>
  value === 'top' || value === 'bottom' || value === 'left' || value === 'right'

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

const readPersisted = (): DockState => {
  const storage = getStorage()
  if (!storage) {
    return DEFAULT_STATE
  }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_STATE
    }
    const candidate = parsed as Partial<DockState>

    return {
      open: candidate.open === true,
      tab: isDockTab(candidate.tab) ? candidate.tab : DEFAULT_STATE.tab,
      position: isDockPosition(candidate.position)
        ? candidate.position
        : DEFAULT_STATE.position,
    }
  } catch {
    return DEFAULT_STATE
  }
}

let current: DockState = readPersisted()
const listeners = new Set<() => void>()

export const getDockState = (): DockState => current

const update = (patch: Partial<DockState>): void => {
  const next: DockState = { ...current, ...patch }
  if (
    next.open === current.open &&
    next.tab === current.tab &&
    next.position === current.position
  ) {
    return
  }
  current = next

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => {
    listener()
  })
}

export const setDockOpen = (open: boolean): void => update({ open })

export const setDockTab = (tab: DockTab): void => update({ tab })

export const setDockPosition = (position: DockPosition): void =>
  update({ position })

export const subscribeDockState = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
