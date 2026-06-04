import { describe, test, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarCollapsed } from './useSidebarCollapsed'
import { setSidebarCollapsed } from '../utils/sidebarCollapsedStore'

describe('useSidebarCollapsed', () => {
  afterEach(() => {
    // Reset the workspace-global store so each test starts from the default.
    // Wrapped in act because a still-mounted hook may be subscribed and a
    // store change notifies its useSyncExternalStore listener (a React update).
    act(() => {
      setSidebarCollapsed(false)
    })
  })

  test('returns collapsed, toggle, and setCollapsed', () => {
    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current.collapsed).toBe(false)
    expect(typeof result.current.toggle).toBe('function')
    expect(typeof result.current.setCollapsed).toBe('function')
  })

  test('collapsed reflects the store value on mount', () => {
    setSidebarCollapsed(true)

    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current.collapsed).toBe(true)
  })

  test('toggle flips the value and re-renders', () => {
    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current.collapsed).toBe(false)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(false)
  })

  test('setCollapsed(true) sets the value', () => {
    const { result } = renderHook(() => useSidebarCollapsed())

    act(() => {
      result.current.setCollapsed(true)
    })

    expect(result.current.collapsed).toBe(true)
  })

  test('setCollapsed(false) sets the value', () => {
    setSidebarCollapsed(true)

    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.setCollapsed(false)
    })

    expect(result.current.collapsed).toBe(false)
  })

  test('external store changes update the hook', () => {
    const { result } = renderHook(() => useSidebarCollapsed())

    expect(result.current.collapsed).toBe(false)

    // Mutate the store directly, outside the hook, to prove the
    // useSyncExternalStore subscription drives a re-render.
    act(() => {
      setSidebarCollapsed(true)
    })

    expect(result.current.collapsed).toBe(true)
  })
})
