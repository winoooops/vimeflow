import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { pierreThemeForKind } from './pierreTheme'

export type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>

export type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>

export type DiffOverflow = NonNullable<BaseDiffOptions['overflow']>

export type DiffLineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

export const DIFF_STYLE_OPTIONS = [
  { id: 'split', label: 'Split' },
  { id: 'unified', label: 'Unified' },
]

export const DIFF_THEME_OPTIONS = [
  { id: 'auto', label: 'Follow app theme' },
  { id: 'pierre-dark', label: 'Pierre Dark' },
  { id: 'pierre-dark-soft', label: 'Pierre Dark Soft' },
  { id: 'pierre-light', label: 'Pierre Light' },
  { id: 'pierre-light-soft', label: 'Pierre Light Soft' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'one-dark-pro', label: 'One Dark Pro' },
]

const DIFF_THEME_IDS = new Set(DIFF_THEME_OPTIONS.map(({ id }) => id))

export const DIFF_LINE_DIFF_OPTIONS = [
  { id: 'word-alt', label: 'Word (enhanced)' },
  { id: 'word', label: 'Word' },
  { id: 'char', label: 'Character' },
  { id: 'none', label: 'None' },
]

export const DIFF_INDICATOR_OPTIONS = [
  { id: 'classic', label: 'Plus / minus' },
  { id: 'bars', label: 'Gutter bars' },
  { id: 'none', label: 'None' },
]

export const DIFF_OVERFLOW_OPTIONS = [
  { id: 'scroll', label: 'Horizontal scroll' },
  { id: 'wrap', label: 'Wrap long lines' },
]

export const resolveDiffStyle = (value: string): DiffStyle =>
  value === 'unified' ? 'unified' : 'split'

export const resolveDiffThemeSetting = (value: string): string =>
  DIFF_THEME_IDS.has(value) ? value : 'auto'

export const resolveDiffTheme = (
  value: string,
  workspaceThemeKind: 'dark' | 'light'
): DiffsThemeNames => {
  const theme = resolveDiffThemeSetting(value)

  return theme === 'auto' ? pierreThemeForKind(workspaceThemeKind) : theme
}

export const resolveDiffLineDiffType = (value: string): DiffLineDiffType => {
  switch (value) {
    case 'word-alt':
    case 'char':
    case 'none':
      return value
    default:
      return 'word'
  }
}

export const resolveDiffIndicators = (value: string): DiffIndicators => {
  switch (value) {
    case 'bars':
    case 'none':
      return value
    default:
      return 'classic'
  }
}

export const resolveDiffOverflow = (value: string): DiffOverflow =>
  value === 'wrap' ? 'wrap' : 'scroll'
