import { afterEach, describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  TOOL_CALLS_VIEW_STORAGE_KEY,
  getToolCallsView,
  setToolCallsView,
  useToolCallsView,
} from './useToolCallsView'

afterEach(() => {
  // Wrap the reset: a mounted hook may still be subscribed when this runs.
  act(() => {
    setToolCallsView('jar')
  })
  localStorage.clear()
})

describe('useToolCallsView', () => {
  test('defaults to the packed (jar) view', () => {
    expect(getToolCallsView()).toBe('jar')
  })

  test('setToolCallsView updates the value and persists it', () => {
    setToolCallsView('tags')

    expect(getToolCallsView()).toBe('tags')
    expect(localStorage.getItem(TOOL_CALLS_VIEW_STORAGE_KEY)).toBe('tags')
  })

  test('the hook reflects external changes to the store', () => {
    const { result } = renderHook(() => useToolCallsView())

    expect(result.current[0]).toBe('jar')

    act(() => {
      result.current[1]('tags')
    })

    expect(result.current[0]).toBe('tags')
  })

  test('a no-op set (same value) does not persist', () => {
    setToolCallsView('jar')

    expect(localStorage.getItem(TOOL_CALLS_VIEW_STORAGE_KEY)).toBeNull()
  })
})
