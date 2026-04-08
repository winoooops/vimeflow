import type { NavigationItem } from '../types'

export const mockNavigationItems: NavigationItem[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    icon: 'dashboard',
    color: 'bg-emerald-500',
    onClick: (): void => {
      // Navigate to dashboard view
    },
  },
  {
    id: 'source-control',
    name: 'Source Control',
    icon: 'account_tree',
    color: 'bg-amber-500',
    onClick: (): void => {
      // Navigate to source control view
    },
  },
  {
    id: 'debugger',
    name: 'Debugger',
    icon: 'bug_report',
    color: 'bg-rose-500',
    onClick: (): void => {
      // Navigate to debugger view
    },
  },
]

export const mockSettingsItem: NavigationItem = {
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  color: 'bg-indigo-500',
  onClick: (): void => {
    // Open settings modal
  },
}
