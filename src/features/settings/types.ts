import type { ReactNode } from 'react'
import type { ShortcutInput } from '../../lib/formatShortcut'

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'keymap'
  | 'agents'
  | 'editor'
  | 'terminal'
  | 'languages'
  | 'search'
  | 'window'
  | 'panels'
  | 'version'
  | 'collab'
  | 'ai'
  | 'network'

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  icon: string
}

export type SettingsTargetId = string

export interface SettingsTarget {
  id: SettingsTargetId
  section: SettingsSectionId
  label: string
  hint?: string
  subsection?: string
}

export type SettingsSubsectionId = string

export interface SettingsSubsection {
  id: SettingsSubsectionId
  section: SettingsSectionId
  label: string
  targetId: SettingsTargetId
  targetIds: SettingsTargetId[]
}

export type SettingsSearchNavigationDirection = 'next' | 'previous'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export interface SettingsSidebarProps {
  sections: SettingsSection[]
  targets?: SettingsTarget[]
  subsections?: SettingsSubsection[]
  active: SettingsSectionId
  activeSubsectionId?: SettingsSubsectionId | null
  activeTargetId?: SettingsTargetId | null
  activeSearchResultKey?: string | null
  expandedSectionIds?: ReadonlySet<SettingsSectionId>
  onPick: (id: SettingsSectionId) => void
  onPickTarget?: (target: SettingsTarget) => void
  onPickSubsection?: (subsection: SettingsSubsection) => void
  onExpandedSectionIdsChange?: (
    expandedSectionIds: ReadonlySet<SettingsSectionId>
  ) => void
  onClearQuery?: () => void
  onNavigateSearchResult?: (
    direction: SettingsSearchNavigationDirection
  ) => void
  onConfirmSearchResult?: () => void
  query: string
  onQuery: (query: string) => void
}

export interface IconProps {
  name: string
  size?: number
  fill?: boolean
  className?: string
}

export interface KbdProps {
  children: ReactNode
}

export interface RowProps {
  label: string
  hint?: string
  children?: ReactNode
  last?: boolean
  settingsTargetId?: SettingsTargetId
  settingsTargetActive?: boolean
}

export interface PaneTitleProps {
  title: string
  sub?: string
}

export interface SettingsPaneTargetProps {
  activeTargetId?: SettingsTargetId | null
}

export interface ToggleProps {
  on?: boolean
  onChange: (value: boolean) => void
  'aria-label'?: string
}

export interface SelectOption {
  id: string
  label: string
}

export interface SelectProps {
  value: string
  options: SelectOption[] | string[]
  onChange: (value: string) => void
  width?: string | number
  'aria-label'?: string
}

export interface GhostButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}

export interface TextInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: string | number
  mono?: boolean
  'aria-label'?: string
}

export interface AppearanceScheme {
  id: string
  label: string
  accent: string
  surface: string
  text: string
}

export type KeymapKeys = ShortcutInput[] | ((isMac: boolean) => ShortcutInput[])

export interface KeymapBinding {
  id: string
  label: string
  keys: KeymapKeys
}

export interface KeymapGroup {
  zone: string
  bindings: KeymapBinding[]
}

export type { AgentAlias } from '../../bindings/AgentAlias'

export interface PlaceholderPaneProps {
  section: SettingsSection
}

export interface UseSettingsDialogReturn {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}
