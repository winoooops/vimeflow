import { describe, test, expect } from 'vitest'
import { mockNavigationItems, mockSettingsItem } from './mockNavigation'

describe('mockNavigation', () => {
  describe('mockNavigationItems', () => {
    test('should have 3 navigation items', () => {
      expect(mockNavigationItems).toHaveLength(3)
    })

    test('should have Dashboard as first item', () => {
      const dashboard = mockNavigationItems[0]
      expect(dashboard.id).toBe('dashboard')
      expect(dashboard.name).toBe('Dashboard')
      expect(dashboard.icon).toBe('dashboard')
      expect(dashboard.color).toBe('bg-emerald-500')
    })

    test('should have Source Control as second item', () => {
      const sourceControl = mockNavigationItems[1]
      expect(sourceControl.id).toBe('source-control')
      expect(sourceControl.name).toBe('Source Control')
      expect(sourceControl.icon).toBe('account_tree')
      expect(sourceControl.color).toBe('bg-amber-500')
    })

    test('should have Debugger as third item', () => {
      const debuggerItem = mockNavigationItems[2]
      expect(debuggerItem.id).toBe('debugger')
      expect(debuggerItem.name).toBe('Debugger')
      expect(debuggerItem.icon).toBe('bug_report')
      expect(debuggerItem.color).toBe('bg-rose-500')
    })

    test('each navigation item should have an onClick handler', () => {
      mockNavigationItems.forEach((item) => {
        expect(item.onClick).toBeDefined()
        expect(typeof item.onClick).toBe('function')
      })
    })
  })

  describe('mockSettingsItem', () => {
    test('should have correct settings data', () => {
      expect(mockSettingsItem.id).toBe('settings')
      expect(mockSettingsItem.name).toBe('Settings')
      expect(mockSettingsItem.icon).toBe('settings')
      expect(mockSettingsItem.color).toBe('bg-indigo-500')
    })

    test('should have onClick handler', () => {
      expect(mockSettingsItem.onClick).toBeDefined()
      expect(typeof mockSettingsItem.onClick).toBe('function')
    })
  })
})
