import type { AppSettings } from '../../../bindings/AppSettings'

export const DEFAULT_SETTINGS: AppSettings = {
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
  keymapPreset: 'vimeflow',
  agentShimEnabled: true,
}
