import type { PaneLayoutId } from '../../../sessions/types'
import { isPaneLayoutId } from '../../layout-registry'

export const SHOWN_LAYOUTS_STORAGE_KEY = 'vimeflow_shown_layouts'

export const HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY = 'vimeflow_hidden_custom'

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

const parseLayoutIds = (
  raw: string | null,
  fallback: readonly PaneLayoutId[]
): readonly PaneLayoutId[] => {
  if (raw === null) {
    return fallback
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return fallback
    }

    return parsed.filter(
      (value): value is PaneLayoutId =>
        typeof value === 'string' && isPaneLayoutId(value)
    )
  } catch {
    return fallback
  }
}

export const readLayoutDisplayPreference = (
  storageKey: string,
  fallback: readonly PaneLayoutId[]
): readonly PaneLayoutId[] => {
  const storage = getStorage()

  return parseLayoutIds(storage?.getItem(storageKey) ?? null, fallback)
}

export const writeLayoutDisplayPreference = (
  storageKey: string,
  layoutIds: readonly PaneLayoutId[]
): void => {
  const storage = getStorage()
  if (storage === null) {
    return
  }

  try {
    storage.setItem(storageKey, JSON.stringify(layoutIds))
  } catch {
    // Presentation preferences should never block workspace rendering.
  }
}
