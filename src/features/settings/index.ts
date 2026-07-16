export { SettingsDialog } from './SettingsDialog'

export { SettingsContent } from './SettingsContent'

export { useSettingsDialog } from './hooks/useSettingsDialog'

export {
  DEFAULT_ALIASES,
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
