import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { setDockOpen, setDockPosition, setDockTab } from '../utils/dockStore'
import { useDockState } from './useDockState'

describe('useDockState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setDockOpen(false)
    setDockTab('diff')
    setDockPosition('bottom')
  })

  test('exposes the dock state fields', () => {
    const { result } = renderHook(() => useDockState())
    expect(result.current.isDockOpen).toBe(false)
    expect(result.current.dockTab).toBe('diff')
    expect(result.current.dockPosition).toBe('bottom')
  })

  test('setters update the exposed state and persist', () => {
    const { result } = renderHook(() => useDockState())

    act(() => {
      result.current.setDockOpen(true)
      result.current.setDockTab('editor')
      result.current.setDockPosition('left')
    })

    expect(result.current.isDockOpen).toBe(true)
    expect(result.current.dockTab).toBe('editor')
    expect(result.current.dockPosition).toBe('left')
    expect(
      JSON.parse(window.localStorage.getItem('vimeflow:workspace:dock') ?? '')
    ).toEqual({ open: true, tab: 'editor', position: 'left' })
  })
})
