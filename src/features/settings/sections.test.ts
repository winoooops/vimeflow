import { describe, expect, test } from 'vitest'
import {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAP_GROUPS,
  SETTINGS_TARGET_IDS,
  SETTINGS_SUBSECTIONS,
  SETTINGS_TARGETS,
  SETTINGS_SECTIONS,
  VIM_KEYMAP_GROUPS,
  keymapCommandTargetId,
  settingsSubsectionId,
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

describe('SETTINGS_TARGETS', () => {
  test('contains unique option target ids', () => {
    const ids = SETTINGS_TARGETS.map((target) => target.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('contains real settings rows and independent keymap command targets', () => {
    expect(SETTINGS_TARGETS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SETTINGS_TARGET_IDS.generalRedactPrivateValues,
          section: 'general',
          label: 'Redact Private Values',
        }),
        expect.objectContaining({
          id: keymapCommandTargetId('palette'),
          section: 'keymap',
          label: 'Open command palette',
        }),
        expect.objectContaining({
          id: keymapCommandTargetId('palette-leader'),
          section: 'keymap',
          label: 'Command palette leader',
        }),
        expect.objectContaining({
          id: SETTINGS_TARGET_IDS.terminalFontFamily,
          section: 'terminal',
          label: 'Terminal Font',
        }),
      ])
    )
  })
})

describe('SETTINGS_SUBSECTIONS', () => {
  test('derives unique subsection ids from section and label', () => {
    const ids = SETTINGS_SUBSECTIONS.map((subsection) => subsection.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(settingsSubsectionId('appearance', 'Fonts')).toBe('appearance-fonts')
  })

  test('contains subsection target groups in source order', () => {
    expect(SETTINGS_SUBSECTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'appearance-fonts',
          section: 'appearance',
          label: 'Fonts',
          targetId: SETTINGS_TARGET_IDS.appearanceUiFont,
          targetIds: [
            SETTINGS_TARGET_IDS.appearanceUiFont,
            SETTINGS_TARGET_IDS.appearanceMonoFont,
          ],
        }),
        expect.objectContaining({
          id: 'keymap-global',
          section: 'keymap',
          label: 'Global',
        }),
        expect.objectContaining({
          id: 'terminal-typography',
          section: 'terminal',
          label: 'Typography',
          targetId: SETTINGS_TARGET_IDS.terminalFontFamily,
          targetIds: [SETTINGS_TARGET_IDS.terminalFontFamily],
        }),
      ])
    )
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
      const resolved = typeof b.keys === 'function' ? b.keys(false) : b.keys
      expect(resolved.length).toBeGreaterThan(0)
    })
  })
})

describe('VIM_KEYMAP_GROUPS', () => {
  test('contains vim-specific bindings', () => {
    const ids = VIM_KEYMAP_GROUPS.flatMap((g) => g.bindings).map((b) => b.id)

    expect(ids).toContain('vim-q')
    expect(ids).toContain('vim-w')
  })

  test('each binding has id, label, and keys', () => {
    VIM_KEYMAP_GROUPS.flatMap((g) => g.bindings).forEach((b) => {
      expect(b.id).toBeDefined()
      expect(b.label).toBeDefined()
      const resolved = typeof b.keys === 'function' ? b.keys(false) : b.keys
      expect(resolved.length).toBeGreaterThan(0)
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
