import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useNewSessionDialog } from './useNewSessionDialog'

describe('useNewSessionDialog', () => {
  test('open() snapshots the provided cwd; close() resets open', () => {
    const { result } = renderHook(() => useNewSessionDialog())
    expect(result.current.open).toBe(false)
    act(() => result.current.openWith('/Users/x/proj'))
    expect(result.current.open).toBe(true)
    expect(result.current.defaultCwd).toBe('/Users/x/proj')
    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
  })

  test('openWith falls back to ~ when no cwd given', () => {
    const { result } = renderHook(() => useNewSessionDialog())
    act(() => result.current.openWith(undefined))
    expect(result.current.defaultCwd).toBe('~')
  })
})
