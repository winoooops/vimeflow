// src/theme/service.ts
import { toCssVars } from './cssVars'
import { flexoki } from './themes/flexoki'
import { obsidianLens } from './themes/obsidian-lens'
import type { ThemeDefinition, ThemeId } from './types'

export const THEME_STORAGE_KEY = 'vimeflow:theme'

let themes: readonly ThemeDefinition[] = [obsidianLens, flexoki]

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
    ['./themes/obsidian-lens', './themes/flexoki'],
    ([obsMod, flexMod]) => {
      const nextObsidian =
        (obsMod as { obsidianLens?: ThemeDefinition } | undefined)
          ?.obsidianLens ??
        themes.find((t) => t.id === 'obsidian-lens') ??
        obsidianLens

      const nextFlexoki =
        (flexMod as { flexoki?: ThemeDefinition } | undefined)?.flexoki ??
        themes.find((t) => t.id === 'flexoki') ??
        flexoki

      themes = [nextObsidian, nextFlexoki]
      apply(active.id)
    }
  )
}
