// src/theme/service.ts
import { toCssVars } from './cssVars'
import { flexoki } from './themes/flexoki'
import { gruvboxDark } from './themes/gruvbox/gruvbox-dark'
import { gruvboxLight } from './themes/gruvbox/gruvbox-light'
import { obsidianLens } from './themes/obsidian-lens'
import type { ThemeDefinition, ThemeId } from './types'

export const THEME_STORAGE_KEY = 'vimeflow:theme'

const themeModules = [
  {
    path: './themes/obsidian-lens',
    exportName: 'obsidianLens',
    fallback: obsidianLens,
  },
  {
    path: './themes/flexoki',
    exportName: 'flexoki',
    fallback: flexoki,
  },
  {
    path: './themes/gruvbox/gruvbox-dark',
    exportName: 'gruvboxDark',
    fallback: gruvboxDark,
  },
  {
    path: './themes/gruvbox/gruvbox-light',
    exportName: 'gruvboxLight',
    fallback: gruvboxLight,
  },
] as const

let themes: readonly ThemeDefinition[] = themeModules.map(
  ({ fallback }) => fallback
)

const DEFAULT_THEME = obsidianLens

type Listener = (theme: ThemeDefinition) => void

let active: ThemeDefinition = DEFAULT_THEME

const listeners = new Set<Listener>()

const writeDom = (theme: ThemeDefinition): void => {
  const root = document.documentElement

  for (const [name, value] of Object.entries(toCssVars(theme))) {
    root.style.setProperty(name, value)
  }

  root.dataset.theme = theme.id
  root.style.colorScheme = theme.kind
}

const apply = (id: ThemeId): void => {
  const next = themes.find((t) => t.id === id) ?? DEFAULT_THEME

  active = next
  writeDom(next)
  window.localStorage.setItem(THEME_STORAGE_KEY, next.id)
  listeners.forEach((listener) => listener(next))
}

export const themeService = {
  apply,
  current: (): ThemeDefinition => active,
  list: (): readonly ThemeDefinition[] => themes,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener)

    return (): void => {
      listeners.delete(listener)
    }
  },
  /** Read persisted choice and apply it. Called once, pre-render. */
  init: (): void => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    const found = themes.find((t) => t.id === stored)

    apply(found ? found.id : DEFAULT_THEME.id)
  },
}

/* Dev-only: editing a theme file re-applies the active theme live, so
 * Flexoki value tuning shows on screen without a reload (spec §5). */
if (import.meta.hot) {
  import.meta.hot.accept(
    themeModules.map(({ path }) => path),
    (mods) => {
      themes = themeModules.map((themeModule, index) => {
        const next = (
          mods[index] as Record<string, ThemeDefinition | undefined> | undefined
        )?.[themeModule.exportName]

        return (
          next ??
          themes.find((t) => t.id === themeModule.fallback.id) ??
          themeModule.fallback
        )
      })
      apply(active.id)
    }
  )
}
