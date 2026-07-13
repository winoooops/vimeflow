import { expect, test } from 'vitest'
import { themeToScheme } from './derive'
import { parseThemeJson, serializeTheme } from './json'
import { obsidianLens } from './themes/obsidian-lens'

test('exports only color scheme identity and base palette', () => {
  const exported = JSON.parse(serializeTheme(obsidianLens)) as Record<
    string,
    unknown
  >

  expect(Object.keys(exported)).toEqual(['id', 'label', 'kind', 'palette'])
  expect(exported).not.toHaveProperty('ui')
  expect(exported).not.toHaveProperty('effects')
  expect(exported).not.toHaveProperty('shadows')
  expect(exported).not.toHaveProperty('syntax')
  expect(exported).not.toHaveProperty('terminal')
  expect(exported).not.toHaveProperty('agents')
})

test('round-trips the base palette extracted from a runtime theme', () => {
  expect(parseThemeJson(serializeTheme(obsidianLens))).toEqual(
    themeToScheme(obsidianLens)
  )
})

test('accepts a safe custom color scheme id', () => {
  const scheme = themeToScheme(obsidianLens)

  const parsed = parseThemeJson(
    JSON.stringify({
      ...scheme,
      id: 'my-custom-theme',
      label: 'My Theme',
    })
  )

  expect(parsed.id).toBe('my-custom-theme')
  expect(parsed.label).toBe('My Theme')
})

test('rejects missing base palette colors', () => {
  const scheme = themeToScheme(obsidianLens)

  const palette = Object.fromEntries(
    Object.entries(scheme.palette).filter(([key]) => key !== 'primary')
  )

  expect(() => parseThemeJson(JSON.stringify({ ...scheme, palette }))).toThrow(
    'palette.primary'
  )
})

test('rejects non-hex base palette colors', () => {
  const scheme = themeToScheme(obsidianLens)

  expect(() =>
    parseThemeJson(
      JSON.stringify({
        ...scheme,
        palette: { ...scheme.palette, primary: 'red' },
      })
    )
  ).toThrow('palette.primary must be a six-digit hex color')
})
