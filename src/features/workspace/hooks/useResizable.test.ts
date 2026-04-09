import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizable } from './useResizable'

describe('useResizable', () => {
  test('returns initial size', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    expect(result.current.size).toBe(256)
    expect(result.current.isDragging).toBe(false)
  })

  test('handleMouseDown sets isDragging to true', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 200,
        clientY: 0,
      } as React.MouseEvent)
    })

    expect(result.current.isDragging).toBe(true)
  })

  test('mouseup ends dragging', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 200,
        clientY: 0,
      } as React.MouseEvent)
    })

    expect(result.current.isDragging).toBe(true)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(result.current.isDragging).toBe(false)
  })

  test('mousemove updates size within bounds', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 256, min: 100, max: 500 })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 200,
        clientY: 0,
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    expect(result.current.size).toBe(356)
  })

  test('size is clamped to min', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 150, min: 100, max: 500 })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 200,
        clientY: 0,
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }))
    })

    expect(result.current.size).toBe(100)
  })

  test('size is clamped to max', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 400, min: 100, max: 500 })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 200,
        clientY: 0,
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }))
    })

    expect(result.current.size).toBe(500)
  })
})
