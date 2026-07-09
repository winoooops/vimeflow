import { describe, expect, test, vi } from 'vitest'
import type {
  AgentAlias,
  AppearanceScheme,
  KeymapBinding,
  SettingsDialogProps,
  SettingsSection,
} from './types'
import { BUILTIN_SCHEMES } from './sections'

describe('settings types compile and shape contracts', () => {
  test('SettingsDialogProps shape', () => {
    const props: SettingsDialogProps = {
      open: true,
      onClose: vi.fn(),
    }

    expect(props.open).toBe(true)
    expect(typeof props.onClose).toBe('function')
  })

  test('SettingsSection shape', () => {
    const section: SettingsSection = {
      id: 'appearance',
      label: 'Appearance',
      icon: 'palette',
    }

    expect(section.id).toBe('appearance')
  })

  test('AppearanceScheme shape', () => {
    const scheme: AppearanceScheme | undefined = BUILTIN_SCHEMES[0]

    expect(scheme?.accent).toMatch(/^#/)
    expect(scheme?.surface).toMatch(/^#/)
  })

  test('KeymapBinding shape', () => {
    const binding: KeymapBinding = {
      id: 'open_settings',
      label: 'Open settings',
      keys: ['⌘', ','],
    }

    expect(binding.keys).toContain(',')
  })

  test('AgentAlias shape', () => {
    const alias: AgentAlias = {
      id: 'a1',
      alias: 'cc',
      agent: 'claude',
      model: 'sonnet-4',
      extra: '',
      account: null,
    }

    expect(alias.agent).toBe('claude')
  })
})
