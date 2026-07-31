import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getActivityPanelCollapsed,
  setActivityPanelCollapsed,
  subscribeActivityPanelCollapsed,
} from './activityPanelCollapsedStore'

const STORAGE_KEY = 'vimeflow:workspace:activityPanelCollapsed'

describe('activityPanelCollapsedStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivityPanelCollapsed(false)
  })

  test('defaults to false when nothing is persisted', () => {
    expect(getActivityPanelCollapsed()).toBe(false)
  })

  test('set persists to localStorage and updates the snapshot', () => {
    setActivityPanelCollapsed(true)
    expect(getActivityPanelCollapsed()).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  test('set is a no-op when the value is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActivityPanelCollapsed(listener)
    setActivityPanelCollapsed(false)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('subscribers are notified on change and unsubscribe stops notifications', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActivityPanelCollapsed(listener)
    setActivityPanelCollapsed(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setActivityPanelCollapsed(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('a fresh module load seeds from persisted localStorage', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    vi.resetModules()
    const fresh = await import('./activityPanelCollapsedStore')
    expect(fresh.getActivityPanelCollapsed()).toBe(true)
  })
})
