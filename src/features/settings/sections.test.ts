import { describe, expect, test } from 'vitest'
import { DIFF_COMMANDS } from '../keymap/catalog'
import {
  AVAILABLE_SETTINGS_SECTION_IDS,
  AVAILABLE_SETTINGS_SECTIONS,
  DEFAULT_ALIASES,
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

  test('only renders sections with available options', () => {
    expect(AVAILABLE_SETTINGS_SECTION_IDS).toEqual([
      'general',
      'appearance',
      'keymap',
      'agents',
      'terminal',
      'version',
    ])

    expect(AVAILABLE_SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'general',
      'appearance',
      'keymap',
      'agents',
      'terminal',
      'version',
    ])
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
        expect.objectContaining({
          id: SETTINGS_TARGET_IDS.appearanceSessionIsland,
          section: 'appearance',
          label: 'Session Island',
        }),
        expect.objectContaining({
          id: SETTINGS_TARGET_IDS.versionDiffViewStyle,
          section: 'version',
          label: 'Diff Layout',
        }),
      ])
    )
  })

  test('indexes every registered Diff command', () => {
    const diffTargets = SETTINGS_TARGETS.filter(
      (target) => target.subsection === 'Diff (when focused)'
    )

    expect(diffTargets.map((target) => target.label)).toEqual(
      DIFF_COMMANDS.map((command) => command.label)
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
          targetIds: [SETTINGS_TARGET_IDS.appearanceUiFont],
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
        expect.objectContaining({
          id: 'version-hunk-appearance',
          section: 'version',
          label: 'Hunk Appearance',
          targetId: SETTINGS_TARGET_IDS.versionDiffViewStyle,
        }),
      ])
    )
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
  test('contains the supported default aliases', () => {
    expect(DEFAULT_ALIASES).toHaveLength(2)
    expect(DEFAULT_ALIASES.map((alias) => alias.agent)).toEqual([
      'claude',
      'codex',
    ])
  })

  test('each alias has the required fields', () => {
    DEFAULT_ALIASES.forEach((a) => {
      expect(a.id).toBeDefined()
      expect(a.alias).toBeDefined()
      expect(a.agent).toBeDefined()
      expect(a.extra).toBeDefined()
    })
  })

  test('defaults leave resume commands to session restoration', () => {
    expect(DEFAULT_ALIASES.every((alias) => alias.extra === '')).toBe(true)
  })
})

describe('Sessions keymap targets', () => {
  test('session switcher commands are searchable settings targets', () => {
    const ids = SETTINGS_TARGETS.map((t) => t.id)
    expect(ids).toContain(keymapCommandTargetId('session-switch-next'))
    expect(ids).toContain(keymapCommandTargetId('session-switch-prev'))
    expect(ids).toContain(keymapCommandTargetId('session-close'))
  })
})
