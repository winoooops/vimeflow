export { SettingsDialog } from './SettingsDialog'

export { useSettingsDialog } from './hooks/useSettingsDialog'

export {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAP_GROUPS,
  SETTINGS_TARGET_IDS,
  SETTINGS_TARGETS,
  SETTINGS_SECTIONS,
  VIM_KEYMAP_GROUPS,
  keymapCommandTargetId,
  keymapStaticTargetId,
} from './sections'

export type {
  AgentAlias,
  AppearanceScheme,
  IconProps,
  KbdProps,
  KeymapBinding,
  KeymapGroup,
  SettingsDialogProps,
  SettingsHeaderProps,
  SettingsPaneTargetProps,
  SettingsScope,
  SettingsSection,
  SettingsSectionId,
  SettingsSidebarProps,
  SettingsTarget,
  SettingsTargetId,
} from './types'
