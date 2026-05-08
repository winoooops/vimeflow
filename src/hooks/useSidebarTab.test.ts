import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DEFAULT_SIDEBAR_TAB, useSidebarTab } from './useSidebarTab'

describe('useSidebarTab', () => {
  test('default initial value is sessions', () => {
    const { result } = renderHook(() => useSidebarTab())

    expect(result.current.activeTab).toBe('sessions')
    expect(DEFAULT_SIDEBAR_TAB).toBe('sessions')
  })

  test('accepts a custom initial value', () => {
    const { result } = renderHook(() => useSidebarTab({ initial: 'files' }))

    expect(result.current.activeTab).toBe('files')
  })

  test('setActiveTab updates activeTab', () => {
    const { result } = renderHook(() => useSidebarTab())

    act(() => {
      result.current.setActiveTab('files')
    })

    expect(result.current.activeTab).toBe('files')
  })

  test('setActiveTab reference is stable across renders', () => {
    const { result, rerender } = renderHook(() => useSidebarTab())
    const firstSetter = result.current.setActiveTab

    rerender()

    expect(result.current.setActiveTab).toBe(firstSetter)
  })

  test('setting to the same tab keeps activeTab equal', () => {
    const { result } = renderHook(() => useSidebarTab())

    act(() => {
      result.current.setActiveTab('sessions')
    })

    expect(result.current.activeTab).toBe('sessions')
  })
})
