import { describe, expect, test } from 'vitest'
import {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAPS,
  SETTINGS_SECTIONS,
  SettingsDialog,
  useSettingsDialog,
} from './index'

describe('settings feature barrel', () => {
  test('exports the SettingsDialog component', () => {
    expect(SettingsDialog).toBeInstanceOf(Function)
  })

  test('exports the useSettingsDialog hook', () => {
    expect(useSettingsDialog).toBeInstanceOf(Function)
  })

  test('exports section and scheme constants', () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0)
    expect(BUILTIN_SCHEMES.length).toBeGreaterThan(0)
    expect(KEYMAPS.length).toBeGreaterThan(0)
    expect(DEFAULT_ALIASES.length).toBeGreaterThan(0)
  })
})
