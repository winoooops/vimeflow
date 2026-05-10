import { describe, test, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
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

  test('mousemove updates size within bounds', async () => {
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

    await waitFor(() => {
      expect(result.current.size).toBe(356)
    })
  })

  test('coalesces rapid mousemove updates to one animation frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    try {
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
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
      })

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
      expect(result.current.size).toBe(256)

      const callback = frameCallbacks[0]
      if (!callback) {
        throw new Error('Expected resize animation frame to be scheduled')
      }

      act(() => {
        callback(16)
      })

      expect(result.current.size).toBe(376)
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
  })

  test('commit-on-end mode previews drag size before committing state', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const onDragPreview = vi.fn()

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    try {
      const { result } = renderHook(() =>
        useResizable({
          initial: 256,
          min: 100,
          max: 500,
          updateMode: 'commit-on-end',
          onDragPreview,
        })
      )

      act(() => {
        result.current.handleMouseDown({
          preventDefault: () => undefined,
          clientX: 200,
          clientY: 0,
        } as React.MouseEvent)
      })

      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
      })

      expect(result.current.size).toBe(256)
      expect(onDragPreview).not.toHaveBeenCalled()

      const callback = frameCallbacks[0]
      if (!callback) {
        throw new Error('Expected resize animation frame to be scheduled')
      }

      act(() => {
        callback(16)
      })

      expect(result.current.size).toBe(256)
      expect(onDragPreview).toHaveBeenCalledWith(376)

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })

      expect(result.current.size).toBe(376)
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
  })

  test('live mode does not call onDragPreview alongside state updates', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const onDragPreview = vi.fn()

    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        frameCallbacks.push(callback)

        return frameCallbacks.length
      })

    try {
      const { result } = renderHook(() =>
        useResizable({
          initial: 256,
          min: 100,
          max: 500,
          updateMode: 'live',
          onDragPreview,
        })
      )

      act(() => {
        result.current.handleMouseDown({
          preventDefault: () => undefined,
          clientX: 200,
          clientY: 0,
        } as React.MouseEvent)
      })

      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
      })

      const callback = frameCallbacks[0]
      if (!callback) {
        throw new Error('Expected resize animation frame to be scheduled')
      }

      act(() => {
        callback(16)
      })

      expect(result.current.size).toBe(376)
      expect(onDragPreview).not.toHaveBeenCalled()
    } finally {
      requestAnimationFrameSpy.mockRestore()
    }
  })

  test('mouseup flushes pending size before ending drag', () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((): number => 1)

    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)

    try {
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
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
      })

      expect(result.current.size).toBe(256)

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })

      expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
      expect(result.current.size).toBe(376)
      expect(result.current.isDragging).toBe(false)
    } finally {
      requestAnimationFrameSpy.mockRestore()
      cancelAnimationFrameSpy.mockRestore()
    }
  })

  test('size is clamped to min', async () => {
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

    await waitFor(() => {
      expect(result.current.size).toBe(100)
    })
  })

  test('vertical direction grows as clientY increases', async () => {
    const { result } = renderHook(() =>
      useResizable({
        initial: 200,
        min: 100,
        max: 500,
        direction: 'vertical',
      })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 0,
        clientY: 100,
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }))
    })

    // Dragging down (clientY 100 → 150): +50 delta, size 200 → 250
    await waitFor(() => {
      expect(result.current.size).toBe(250)
    })
  })

  test('vertical + invert: dragging UP grows the panel (bottom-anchored drawer)', async () => {
    // Simulates a bottom-anchored drawer with a top-edge drag handle:
    // dragging UP (clientY decreases) must GROW the panel, not shrink it.
    const { result } = renderHook(() =>
      useResizable({
        initial: 200,
        min: 100,
        max: 500,
        direction: 'vertical',
        invert: true,
      })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 0,
        clientY: 200,
      } as React.MouseEvent)
    })

    act(() => {
      // Drag UP: clientY 200 → 150 (raw delta -50, inverted delta +50)
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }))
    })

    await waitFor(() => {
      expect(result.current.size).toBe(250)
    })
  })

  test('vertical + invert: dragging DOWN shrinks the panel', async () => {
    const { result } = renderHook(() =>
      useResizable({
        initial: 300,
        min: 100,
        max: 500,
        direction: 'vertical',
        invert: true,
      })
    )

    act(() => {
      result.current.handleMouseDown({
        preventDefault: () => undefined,
        clientX: 0,
        clientY: 100,
      } as React.MouseEvent)
    })

    act(() => {
      // Drag DOWN: clientY 100 → 200 (raw delta +100, inverted delta -100)
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }))
    })

    await waitFor(() => {
      expect(result.current.size).toBe(200)
    })
  })

  test('size is clamped to max', async () => {
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

    await waitFor(() => {
      expect(result.current.size).toBe(500)
    })
  })

  test('initial value above max is clamped on mount', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 600, min: 100, max: 500 })
    )

    expect(result.current.size).toBe(500)
  })

  test('initial value below min is clamped on mount', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 50, min: 100, max: 500 })
    )

    expect(result.current.size).toBe(100)
  })
})
