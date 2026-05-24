import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  deleteActivityPanelCollapsed,
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

  test('deleteActivityPanelCollapsed removes a persisted entry', () => {
    writeActivityPanelCollapsed('sess-1', true)
    expect(
      window.localStorage.getItem(
        'vimeflow:sessions:activityPanelCollapsed:sess-1'
      )
    ).toBe('true')

    deleteActivityPanelCollapsed('sess-1')

    expect(
      window.localStorage.getItem(
        'vimeflow:sessions:activityPanelCollapsed:sess-1'
      )
    ).toBeNull()
    expect(readActivityPanelCollapsed('sess-1')).toBe(false)
  })

  test('deleteActivityPanelCollapsed is a no-op when no entry exists', () => {
    expect(() => {
      deleteActivityPanelCollapsed('never-written')
    }).not.toThrow()
  })

  test('deleteActivityPanelCollapsed only touches the requested session', () => {
    writeActivityPanelCollapsed('sess-1', true)
    writeActivityPanelCollapsed('sess-2', true)

    deleteActivityPanelCollapsed('sess-1')

    expect(readActivityPanelCollapsed('sess-1')).toBe(false)
    expect(readActivityPanelCollapsed('sess-2')).toBe(true)
  })
})
