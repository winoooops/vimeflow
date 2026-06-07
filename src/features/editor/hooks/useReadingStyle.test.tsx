import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { useReadingStyle } from './useReadingStyle'
import { setReadingStyleId } from '../utils/readingStyleStore'

describe('useReadingStyle', () => {
  afterEach(() => {
    act(() => {
      setReadingStyleId('comfortable')
    })
  })

  test('returns the active style and re-renders when the store changes', () => {
    const { result } = renderHook(() => useReadingStyle())

    expect(result.current.styleId).toBe('comfortable')
    expect(result.current.style.fontPx).toBe(18.5)

    act(() => {
      result.current.setStyleId('compact')
    })

    expect(result.current.styleId).toBe('compact')
    expect(result.current.style.fontPx).toBe(16)
  })
})
