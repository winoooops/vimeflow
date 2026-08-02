import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { setActivityPanelCollapsed } from '../utils/activityPanelCollapsedStore'
import { useActivityPanelCollapsed } from './useActivityPanelCollapsed'

describe('useActivityPanelCollapsed', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivityPanelCollapsed(false)
  })

  test('exposes the current flag and setCollapsed updates it', () => {
    const { result } = renderHook(() => useActivityPanelCollapsed())
    expect(result.current.collapsed).toBe(false)

    act(() => {
      result.current.setCollapsed(true)
    })
    expect(result.current.collapsed).toBe(true)
  })

  test('toggle flips the flag and persists it', () => {
    const { result } = renderHook(() => useActivityPanelCollapsed())

    act(() => {
      result.current.toggle()
    })
    expect(result.current.collapsed).toBe(true)
    expect(
      window.localStorage.getItem('vimeflow:workspace:activityPanelCollapsed')
    ).toBe('true')
  })
})
