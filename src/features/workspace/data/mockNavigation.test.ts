import { describe, test, expect } from 'vitest'
import { mockNavigationItems, mockSettingsItem } from './mockNavigation'

describe('mockNavigation', () => {
  test('mockNavigationItems is empty during the deprecation cycle', () => {
    expect(mockNavigationItems).toHaveLength(0)
  })

  test('mockSettingsItem keeps its shape for backward-compat callers', () => {
    expect(mockSettingsItem).toMatchObject({
      id: 'settings',
      name: 'Settings',
      icon: 'settings',
      color: 'bg-indigo-500',
    })
    expect(typeof mockSettingsItem.onClick).toBe('function')
  })
})
