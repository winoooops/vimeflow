import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NativeOverlayActivityPopoverRequest } from './nativeOverlayActivity'
import { useNativeActivityPopoverHost } from './useNativeActivityPopoverHost'

const request: NativeOverlayActivityPopoverRequest = {
  surfaceId: 'activity-popover-1',
  kind: 'popover',
  anchorRect: { x: 640, y: 120, width: 240, height: 48 },
  placement: 'left',
  payload: {
    kind: 'popover',
    popover: 'activity',
    ariaLabel: 'BASH activity details',
    activateActionId: 'activity:activate',
    event: {
      id: 'activity-1',
      kind: 'bash',
      timestamp: '2026-07-10T12:00:00.000Z',
      status: 'done',
      body: 'npm test',
      tool: 'Bash',
      durationMs: 1200,
    },
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useNativeActivityPopoverHost', () => {
  test('exposes the activation action from the request', () => {
    const { result } = renderHook(() =>
      useNativeActivityPopoverHost({ request, close: vi.fn() })
    )

    expect(result.current.activateActionId).toBe('activity:activate')
  })

  test('closes after the pointer leaves both the anchor and card', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    renderHook(() => useNativeActivityPopoverHost({ request, close }))

    fireEvent.mouseMove(document, { clientX: 0, clientY: 0 })
    await act(() => vi.advanceTimersByTime(150))

    expect(close).toHaveBeenCalledOnce()
  })
})
