import { expect, test } from 'vitest'
import { dracula } from './dracula'
import { flexoki } from './flexoki'
import { gruvboxDark } from './gruvbox/gruvbox-dark'
import { gruvboxLight } from './gruvbox/gruvbox-light'
import { obsidianLens } from './obsidian-lens'
import { tokyoNightTheme } from './tokyo-night'

const themes = [
  obsidianLens,
  flexoki,
  gruvboxDark,
  gruvboxLight,
  tokyoNightTheme,
  dracula,
] as const

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '')

  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ]
}

const linearize = (channel: number): number =>
  channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

const luminance = (hex: string): number => {
  const [red, green, blue] = hexToRgb(hex).map(linearize)

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

test('app surface backgrounds stay distinct from terminal canvas backgrounds', () => {
  const surfaceRungs = [
    'surface',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
    'surface-container-highest',
    'surface-bright',
    'browser-bar',
  ] as const

  for (const theme of themes) {
    for (const surface of surfaceRungs) {
      expect(theme.ui[surface]).not.toBe(theme.terminal.background)
    }
  }
})

test('browser bar chrome stays distinct from its app surface parent', () => {
  for (const theme of themes) {
    expect(theme.ui['browser-bar']).not.toBe(theme.ui.surface)
  }
})

test('browser bar chrome stays distinct from adjacent toolbar surface', () => {
  for (const theme of themes) {
    expect(theme.ui['browser-bar']).not.toBe(
      theme.ui['surface-container-lowest']
    )
  }
})

test('nested app surface rungs stay distinct from adjacent lower rungs', () => {
  const adjacentSurfaceRungs = [
    'surface',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
  ] as const

  for (const theme of themes) {
    for (let index = 1; index < adjacentSurfaceRungs.length; index += 1) {
      const previousRung = adjacentSurfaceRungs[index - 1]
      const currentRung = adjacentSurfaceRungs[index]

      expect(theme.ui[currentRung]).not.toBe(theme.ui[previousRung])
    }
  }
})

test('compact surfaces keep label text at AA contrast', () => {
  const compactSurfaces = [
    'surface-container',
    'surface-container-high',
    'surface-container-highest',
    'surface-bright',
  ] as const

  for (const theme of themes) {
    for (const surface of compactSurfaces) {
      expect(
        contrastRatio(theme.ui['on-surface-variant'], theme.ui[surface])
      ).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('interactive top surface rungs keep distinct hover and elevation states', () => {
  const topSurfaceThemes = [gruvboxDark, gruvboxLight, tokyoNightTheme] as const

  const topSurfaceRungs = [
    'surface-container-high',
    'surface-container-highest',
    'surface-bright',
  ] as const

  for (const theme of topSurfaceThemes) {
    const topSurfaceValues = topSurfaceRungs.map((rung) => theme.ui[rung])

    expect(new Set(topSurfaceValues).size).toBe(topSurfaceValues.length)
  }
})

test('gruvbox surface ladders preserve elevation ordering', () => {
  const gruvboxThemes = [gruvboxDark, gruvboxLight] as const

  const surfaceRungs = [
    'surface',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
    'surface-container-highest',
    'surface-bright',
  ] as const

  for (const theme of gruvboxThemes) {
    const surfaceLuminance = surfaceRungs.map((rung) =>
      luminance(theme.ui[rung])
    )

    for (let index = 1; index < surfaceLuminance.length; index += 1) {
      const previousLuminance = surfaceLuminance[index - 1]
      const currentLuminance = surfaceLuminance[index]

      if (theme.kind === 'dark') {
        expect(currentLuminance).toBeGreaterThan(previousLuminance)
      } else {
        expect(currentLuminance).toBeLessThan(previousLuminance)
      }
    }
  }
})
