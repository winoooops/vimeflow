import { beforeEach, expect, test, vi } from 'vitest'
import type { ThemeDefinition } from './types'
import { THEME_STORAGE_KEY, themeService } from './service'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  themeService.apply('obsidian-lens')
})

test('apply writes CSS vars, data-theme, and color-scheme', () => {
  themeService.apply('flexoki')
  const root = document.documentElement
  expect(root.dataset.theme).toBe('flexoki')
  expect(root.style.colorScheme).toBe('light')
  expect(root.style.getPropertyValue('--color-surface')).toBe('#fffcf0')
})

test('apply persists and current() reflects the active theme', () => {
  themeService.apply('flexoki')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('flexoki')
  expect(themeService.current().id).toBe('flexoki')
  expect(themeService.displayed().id).toBe('flexoki')
})

test('subscribers are notified once per apply with the new theme', () => {
  const seen = vi.fn()
  const unsubscribe = themeService.subscribe(seen)
  themeService.apply('flexoki')
  expect(seen).toHaveBeenCalledTimes(1)
  expect((seen.mock.calls[0][0] as ThemeDefinition).id).toBe('flexoki')
  unsubscribe()
  themeService.apply('obsidian-lens')
  expect(seen).toHaveBeenCalledTimes(1)
})

test('preview updates the displayed theme and subscribers without persisting', () => {
  const seen = vi.fn()
  const unsubscribe = themeService.subscribe(seen)
  themeService.apply('obsidian-lens')
  seen.mockClear()

  themeService.preview('flexoki')

  expect(themeService.current().id).toBe('obsidian-lens')
  expect(themeService.displayed().id).toBe('flexoki')
  expect(document.documentElement.dataset.theme).toBe('flexoki')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('obsidian-lens')
  expect(seen).toHaveBeenCalledTimes(1)
  expect((seen.mock.calls[0][0] as ThemeDefinition).id).toBe('flexoki')
  unsubscribe()
})

test('apply commits the displayed preview theme', () => {
  themeService.apply('obsidian-lens')
  themeService.preview('flexoki')

  themeService.apply('flexoki')

  expect(themeService.current().id).toBe('flexoki')
  expect(themeService.displayed().id).toBe('flexoki')
})

test('init falls back to obsidian-lens for unknown stored ids', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'no-such-theme')
  themeService.init()
  expect(themeService.current().id).toBe('obsidian-lens')
})

test('init applies a valid stored theme', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'flexoki')
  themeService.init()
  expect(document.documentElement.dataset.theme).toBe('flexoki')
})

test('list exposes both themes for pickers', () => {
  expect(themeService.list().map((t) => t.id)).toEqual([
    'obsidian-lens',
    'flexoki',
    'gruvbox-dark',
    'gruvbox-light',
    'tokyo-night',
    'dracula',
  ])
})
