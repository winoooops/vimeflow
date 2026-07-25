import { describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from './settingsDefaults'

describe('DEFAULT_SETTINGS', () => {
  test('matches the AppSettings::default() values (version 1)', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      closeWithNoTabs: 'platform',
      onLastWindowClosed: 'platform',
      useSystemPathPrompts: true,
      useSystemPrompts: true,
      redactPrivateValues: false,
      cliOpenBehavior: 'existing',
      aesthetic: 'obsidian',
      accentHue: 285,
      density: 'comfortable',
      uiFont: 'instrument',
      monoFont: 'jetbrains',
      terminalFontFamily: 'JetBrains Mono',
      reservoirSwell: 'soft-mound',
      sessionIslandDisplay: 'dots',
      diffViewStyle: 'split',
      diffTheme: 'auto',
      diffLineDiffType: 'word',
      diffIndicators: 'classic',
      diffOverflow: 'scroll',
      diffShowLineNumbers: true,
      diffBackgroundTint: true,
      diffFileHeader: true,
      diffStickyHeader: true,
      keymapPreset: 'vimeflow',
      agentShimEnabled: true,
      customKeybindings: {},
    })
  })
})
