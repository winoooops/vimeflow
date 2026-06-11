import { describe, expect, test } from 'vitest'
import {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAPS,
  SETTINGS_SECTIONS,
} from './sections'

describe('SETTINGS_SECTIONS', () => {
  test('contains the fourteen expected categories', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(14)
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'general',
      'appearance',
      'keymap',
      'agents',
      'editor',
      'terminal',
      'languages',
      'search',
      'window',
      'panels',
      'version',
      'collab',
      'ai',
      'network',
    ])
  })

  test('each section has id, label, and icon', () => {
    SETTINGS_SECTIONS.forEach((s) => {
      expect(s.id).toBeDefined()
      expect(s.label).toBeDefined()
      expect(s.icon).toBeDefined()
    })
  })
})

describe('BUILTIN_SCHEMES', () => {
  test('contains the five expected schemes with literal hex', () => {
    expect(BUILTIN_SCHEMES).toHaveLength(5)
    expect(BUILTIN_SCHEMES.map((s) => s.id)).toEqual([
      'obsidian',
      'editorial',
      'dense',
      'navigator',
      'flexoki',
    ])
  })

  test('each scheme defines literal accent, surface, and text colors', () => {
    BUILTIN_SCHEMES.forEach((s) => {
      expect(s.accent).toMatch(/^#/)
      expect(s.surface).toMatch(/^#/)
      expect(s.text).toMatch(/^#/)
    })
  })
})

describe('KEYMAPS', () => {
  test('contains the expected bindings', () => {
    expect(KEYMAPS.some((b) => b.id === 'open_settings')).toBe(true)
    expect(KEYMAPS.some((b) => b.id === 'open_palette')).toBe(true)
  })

  test('each binding has id, label, and keys', () => {
    KEYMAPS.forEach((b) => {
      expect(b.id).toBeDefined()
      expect(b.label).toBeDefined()
      expect(b.keys.length).toBeGreaterThan(0)
    })
  })
})

describe('DEFAULT_ALIASES', () => {
  test('contains three default aliases', () => {
    expect(DEFAULT_ALIASES).toHaveLength(3)
  })

  test('each alias has the required fields', () => {
    DEFAULT_ALIASES.forEach((a) => {
      expect(a.id).toBeDefined()
      expect(a.alias).toBeDefined()
      expect(a.agent).toBeDefined()
      expect(a.model).toBeDefined()
      expect(a.extra).toBeDefined()
    })
  })
})
