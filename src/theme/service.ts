// src/theme/service.ts
import { toCssVars } from './cssVars'
import { ayu } from './themes/ayu'
import { dracula } from './themes/dracula'
import { eldritch } from './themes/eldritch'
import { flexoki } from './themes/flexoki'
import { gruvboxDark } from './themes/gruvbox/gruvbox-dark'
import { gruvboxLight } from './themes/gruvbox/gruvbox-light'
import { kanagawa } from './themes/kanagawa'
import { nord } from './themes/nord'
import { obsidianLens } from './themes/obsidian-lens'
import { rosePine } from './themes/rose-pine'
import { tokyoNightTheme } from './themes/tokyo-night'
import { deriveTheme } from './derive'
import { parseStoredThemeScheme } from './json'
import type { ThemeDefinition, ThemeId, ThemeScheme } from './types'

export const THEME_STORAGE_KEY = 'vimeflow:theme'

export const CUSTOM_THEMES_STORAGE_KEY = 'vimeflow:custom-themes'

const themeModules = [
  {
    exportName: 'obsidianLens',
    fallback: obsidianLens,
  },
  {
    exportName: 'flexoki',
    fallback: flexoki,
  },
  {
    exportName: 'gruvboxDark',
    fallback: gruvboxDark,
  },
  {
    exportName: 'gruvboxLight',
    fallback: gruvboxLight,
  },
  {
    exportName: 'tokyoNightTheme',
    fallback: tokyoNightTheme,
  },
  {
    exportName: 'dracula',
    fallback: dracula,
  },
  {
    exportName: 'ayu',
    fallback: ayu,
  },
  {
    exportName: 'eldritch',
    fallback: eldritch,
  },
  {
    exportName: 'kanagawa',
    fallback: kanagawa,
  },
  {
    exportName: 'nord',
    fallback: nord,
  },
  {
    exportName: 'rosePine',
    fallback: rosePine,
  },
] as const

let builtInThemes: readonly ThemeDefinition[] = themeModules.map(
  ({ fallback }) => fallback
)
let customSchemes: readonly ThemeScheme[] = []
let themes: readonly ThemeDefinition[] = builtInThemes

const DEFAULT_THEME = obsidianLens

type Listener = (theme: ThemeDefinition) => void

let active: ThemeDefinition = DEFAULT_THEME
let displayed: ThemeDefinition = DEFAULT_THEME
let storageSyncInitialized = false

const listeners = new Set<Listener>()

const renameCollidingCustomSchemes = (
  schemes: readonly ThemeScheme[]
): {
  schemes: readonly ThemeScheme[]
  migratedIds: ReadonlyMap<ThemeId, ThemeId>
} => {
  const builtInIds = new Set(builtInThemes.map((theme) => theme.id))

  const occupiedIds = new Set([
    ...builtInIds,
    ...schemes
      .filter((scheme) => !builtInIds.has(scheme.id))
      .map((scheme) => scheme.id),
  ])
  const migratedIds = new Map<ThemeId, ThemeId>()

  const nextSchemes = schemes.map((scheme) => {
    if (!builtInIds.has(scheme.id)) {
      return scheme
    }

    const baseId = `${scheme.id}-custom`
    let nextId = baseId
    let index = 2

    while (occupiedIds.has(nextId)) {
      nextId = `${baseId}-${index}`
      index += 1
    }

    occupiedIds.add(nextId)
    if (!migratedIds.has(scheme.id)) {
      migratedIds.set(scheme.id, nextId)
    }

    return {
      ...scheme,
      id: nextId,
    }
  })

  return { schemes: nextSchemes, migratedIds }
}

const rebuildThemes = (): void => {
  const customThemes = customSchemes.map(deriveTheme)
  const builtInIds = new Set(builtInThemes.map((theme) => theme.id))

  themes = [
    ...builtInThemes,
    ...customThemes.filter((theme) => !builtInIds.has(theme.id)),
  ]
}

const isBuiltIn = (id: ThemeId): boolean =>
  builtInThemes.some((theme) => theme.id === id)

const loadCustomThemes = (): void => {
  const stored = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)
  if (stored === null) {
    customSchemes = []
    rebuildThemes()

    return
  }

  try {
    const parsed: unknown = JSON.parse(stored)

    const parsedSchemes = Array.isArray(parsed)
      ? parsed.flatMap((theme) => {
          try {
            return [parseStoredThemeScheme(theme)]
          } catch {
            return []
          }
        })
      : []
    const migration = renameCollidingCustomSchemes(parsedSchemes)
    customSchemes = migration.schemes

    if (migration.migratedIds.size > 0) {
      window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify(customSchemes)
      )

      const storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY)

      const migratedActiveId =
        storedThemeId === null
          ? undefined
          : migration.migratedIds.get(storedThemeId)

      if (migratedActiveId !== undefined) {
        window.localStorage.setItem(THEME_STORAGE_KEY, migratedActiveId)
      }
    }
  } catch {
    customSchemes = []
  }

  rebuildThemes()
}

const writeDom = (theme: ThemeDefinition): void => {
  const root = document.documentElement

  for (const [name, value] of Object.entries(toCssVars(theme))) {
    root.style.setProperty(name, value)
  }

  root.dataset.theme = theme.id
  root.style.colorScheme = theme.kind
}

const activate = (id: ThemeId, persist: boolean): void => {
  const next = themes.find((t) => t.id === id) ?? DEFAULT_THEME

  active = next
  displayed = next
  writeDom(next)
  if (persist) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next.id)
  }
  listeners.forEach((listener) => listener(next))
}

const apply = (id: ThemeId): void => {
  activate(id, true)
}

const preview = (id: ThemeId): void => {
  const next = themes.find((t) => t.id === id) ?? DEFAULT_THEME

  displayed = next
  writeDom(next)
  listeners.forEach((listener) => listener(next))
}

const install = (scheme: ThemeScheme): void => {
  if (isBuiltIn(scheme.id)) {
    throw new Error('Built-in theme ids cannot be replaced')
  }

  customSchemes = [
    ...customSchemes.filter((candidate) => candidate.id !== scheme.id),
    scheme,
  ]
  rebuildThemes()
  window.localStorage.setItem(
    CUSTOM_THEMES_STORAGE_KEY,
    JSON.stringify(customSchemes)
  )
  apply(scheme.id)
}

const syncThemeStorage = (event: StorageEvent): void => {
  if (event.storageArea !== null && event.storageArea !== window.localStorage) {
    return
  }

  if (event.key === CUSTOM_THEMES_STORAGE_KEY) {
    const activeId = active.id
    loadCustomThemes()
    activate(activeId, false)

    return
  }

  if (event.key === THEME_STORAGE_KEY && event.newValue !== null) {
    activate(event.newValue, false)
  }
}

const initializeStorageSync = (): void => {
  if (storageSyncInitialized) {
    return
  }

  window.addEventListener('storage', syncThemeStorage)
  storageSyncInitialized = true
}

export const themeService = {
  apply,
  preview,
  current: (): ThemeDefinition => active,
  displayed: (): ThemeDefinition => displayed,
  list: (): readonly ThemeDefinition[] => themes,
  isBuiltIn,
  install,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)

    return (): void => {
      listeners.delete(listener)
    }
  },
  /** Read persisted choice and apply it. Called once, pre-render. */
  init: (): void => {
    initializeStorageSync()
    loadCustomThemes()
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    const found = themes.find((t) => t.id === stored)

    apply(found ? found.id : DEFAULT_THEME.id)
  },
  _resetCustomThemesForTest: (): void => {
    customSchemes = []
    window.localStorage.removeItem(CUSTOM_THEMES_STORAGE_KEY)
    rebuildThemes()
  },
}

/* Dev-only: editing a theme file re-applies the active theme live, so
 * Flexoki value tuning shows on screen without a reload (spec §5). */
if (import.meta.hot) {
  // The dependency array is a static literal because Vite's HMR boundary
  // requires static analysis. Positions must match `themeModules` order:
  // array index -> exportName mapping above.
  import.meta.hot.accept(
    [
      './themes/obsidian-lens',
      './themes/flexoki',
      './themes/gruvbox/gruvbox-dark',
      './themes/gruvbox/gruvbox-light',
      './themes/tokyo-night',
      './themes/dracula',
      './themes/ayu',
      './themes/eldritch',
      './themes/kanagawa',
      './themes/nord',
      './themes/rose-pine',
    ],
    (mods) => {
      builtInThemes = themeModules.map((themeModule, index) => {
        const next = (
          mods[index] as Record<string, ThemeDefinition | undefined> | undefined
        )?.[themeModule.exportName]

        return (
          next ??
          builtInThemes.find((t) => t.id === themeModule.fallback.id) ??
          themeModule.fallback
        )
      })
      rebuildThemes()
      apply(active.id)
    }
  )
}
