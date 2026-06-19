export { SettingsDialog } from './SettingsDialog'

export { useSettingsDialog } from './hooks/useSettingsDialog'

export {
  BUILTIN_SCHEMES,
  DEFAULT_ALIASES,
  KEYMAP_GROUPS,
  SETTINGS_TARGET_IDS,
  SETTINGS_SUBSECTIONS,
  SETTINGS_TARGETS,
  SETTINGS_SECTIONS,
  VIM_KEYMAP_GROUPS,
  keymapCommandTargetId,
  keymapStaticTargetId,
  settingsSubsectionId,
} from './sections'

export type {
  AgentAlias,
  AppearanceScheme,
  IconProps,
  KbdProps,
  KeymapBinding,
  KeymapGroup,
  SettingsDialogProps,
  SettingsPaneTargetProps,
  SettingsSection,
  SettingsSectionId,
  SettingsSidebarProps,
  SettingsSubsection,
  SettingsSubsectionId,
  SettingsTarget,
  SettingsTargetId,
} from './types'
