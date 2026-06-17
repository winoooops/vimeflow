import type { AppSettings } from '../../../bindings/AppSettings'

export const DEFAULT_SETTINGS: AppSettings = {
  // Must match CURRENT_APP_SETTINGS_VERSION in crates/backend/src/settings/app_settings.rs
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
  customKeybindings: {},
}
