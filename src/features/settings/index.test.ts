import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ALIASES,
  SETTINGS_SECTIONS,
  SETTINGS_SUBSECTIONS,
  SettingsContent,
  SettingsDialog,
  VIM_KEYMAP_GROUPS,
  useSettingsDialog,
} from './index'

describe('settings feature barrel', () => {
  test('exports the SettingsDialog component', () => {
    expect(SettingsDialog).toBeInstanceOf(Function)
  })

  test('exports the SettingsContent component', () => {
    expect(SettingsContent).toBeInstanceOf(Function)
  })

  test('exports the useSettingsDialog hook', () => {
    expect(useSettingsDialog).toBeInstanceOf(Function)
  })

  test('exports section constants', () => {
    expect(SETTINGS_SECTIONS.length).toBeGreaterThan(0)
    expect(SETTINGS_SUBSECTIONS.length).toBeGreaterThan(0)
    expect(VIM_KEYMAP_GROUPS.length).toBeGreaterThan(0)
    expect(DEFAULT_ALIASES.length).toBeGreaterThan(0)
  })
})
