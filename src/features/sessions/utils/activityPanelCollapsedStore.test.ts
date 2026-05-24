import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  readActivityPanelCollapsed,
  writeActivityPanelCollapsed,
} from './activityPanelCollapsedStore'

describe('activityPanelCollapsedStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  test('defaults to false when nothing is persisted', () => {
    expect(readActivityPanelCollapsed('sess-1')).toBe(false)
  })

  test('round-trips true', () => {
    writeActivityPanelCollapsed('sess-1', true)
    expect(readActivityPanelCollapsed('sess-1')).toBe(true)
  })

  test('round-trips false', () => {
    writeActivityPanelCollapsed('sess-1', true)
    writeActivityPanelCollapsed('sess-1', false)
    expect(readActivityPanelCollapsed('sess-1')).toBe(false)
  })

  test('isolates by session id', () => {
    writeActivityPanelCollapsed('sess-1', true)
    writeActivityPanelCollapsed('sess-2', false)
    expect(readActivityPanelCollapsed('sess-1')).toBe(true)
    expect(readActivityPanelCollapsed('sess-2')).toBe(false)
    expect(readActivityPanelCollapsed('sess-3')).toBe(false)
  })

  test('treats unparseable values as false', () => {
    window.localStorage.setItem(
      'vimeflow:sessions:activityPanelCollapsed:sess-1',
      'garbage'
    )
    expect(readActivityPanelCollapsed('sess-1')).toBe(false)
  })
})
