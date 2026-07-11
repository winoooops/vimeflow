import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NativeOverlayActivityPopoverRequest } from '@/components/nativeOverlayActivity'
import type { ActivityEvent } from '../types/activityEvent'
import {
  isNativeActivityPopoverRequest,
  useNativeActivityPopoverHost,
  useNativeActivityPopoverSource,
} from './useNativeActivityPopover'

const event: ActivityEvent = {
  id: 'activity-1',
  kind: 'bash',
  timestamp: '2026-07-10T12:00:00.000Z',
  status: 'done',
  body: 'npm test',
  tool: 'Bash',
  durationMs: 1200,
}

const request: NativeOverlayActivityPopoverRequest = {
  surfaceId: 'activity-popover-1',
  kind: 'popover',
  anchorRect: { x: 640, y: 120, width: 240, height: 48 },
  placement: 'left',
  payload: {
    kind: 'popover',
    popover: 'activity',
    ariaLabel: 'BASH activity details',
    event,
    activateActionId: 'activity:activate',
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('native activity popover hooks', () => {
  test('builds the payload and keeps activation in the owner renderer', () => {
    const onActivate = vi.fn()

    const { result } = renderHook(() =>
      useNativeActivityPopoverSource({
        event,
        ariaLabel: 'BASH activity details',
        onActivate,
      })
    )

    const actionId = result.current.payload.activateActionId
    expect(actionId).toBeDefined()
    expect(result.current.payload.event).toBe(event)

    const action = result.current.actions.get(actionId!)
    expect(typeof action).toBe('function')
    if (typeof action === 'function') {
      action()
    }
    expect(onActivate).toHaveBeenCalledOnce()
  })

  test('recognizes only complete activity popover requests', () => {
    expect(isNativeActivityPopoverRequest(request)).toBe(true)
    expect(
      isNativeActivityPopoverRequest({
        ...request,
        payload: { ...request.payload, event: { ...event, tool: undefined } },
      })
    ).toBe(false)
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
