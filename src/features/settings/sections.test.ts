import { describe, expect, test } from 'vitest'
import {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAP_GROUPS,
  SETTINGS_SECTIONS,
  VIM_KEYMAP_GROUPS,
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

describe('KEYMAP_GROUPS', () => {
  test('contains the expected base bindings', () => {
    const ids = KEYMAP_GROUPS.flatMap((g) => g.bindings).map((b) => b.id)

    expect(ids).toContain('palette')
    expect(ids).toContain('cycle-layout')
  })

  test('each group has a zone and at least one binding', () => {
    KEYMAP_GROUPS.forEach((g) => {
      expect(g.zone).toBeDefined()
      expect(g.bindings.length).toBeGreaterThan(0)
    })
  })

  test('each binding has id, label, and keys', () => {
    KEYMAP_GROUPS.flatMap((g) => g.bindings).forEach((b) => {
      expect(b.id).toBeDefined()
      expect(b.label).toBeDefined()
      expect(b.keys.length).toBeGreaterThan(0)
    })
  })
})

describe('VIM_KEYMAP_GROUPS', () => {
  test('contains vim-specific bindings', () => {
    const ids = VIM_KEYMAP_GROUPS.flatMap((g) => g.bindings).map((b) => b.id)

    expect(ids).toContain('vim-q')
    expect(ids).toContain('vim-cycle')
  })

  test('each binding has id, label, and keys', () => {
    VIM_KEYMAP_GROUPS.flatMap((g) => g.bindings).forEach((b) => {
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
