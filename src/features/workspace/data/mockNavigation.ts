import type { NavigationItem } from '../types'

// Kept for one cycle so external callers compile. The rail body
// no longer iterates this array -- see
// docs/superpowers/specs/2026-05-20-icon-rail-trim-design.md section 7.1.
// A follow-up cleanup PR removes both exports once the Settings
// dialog lands.
export const mockNavigationItems: NavigationItem[] = []

export const mockSettingsItem: NavigationItem = {
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  color: 'bg-indigo-500',
  onClick: (): void => {
    // No-op; the rail's settings button is aria-disabled and
    // does not consult this handler.
  },
}
