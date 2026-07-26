import { describe, expect, test } from 'vitest'
import { isNativeOverlayActivityPopoverPayload } from './nativeOverlayActivity'

const payload = {
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
    label: 'BASH',
    durationMs: 1200,
    bashResult: { passed: 4, total: 4 },
  },
}

describe('isNativeOverlayActivityPopoverPayload', () => {
  test('accepts a serializable activity popover', () => {
    expect(isNativeOverlayActivityPopoverPayload(payload)).toBe(true)
  })

  test('accepts a semantic tool kind introduced by an agent profile', () => {
    expect(
      isNativeOverlayActivityPopoverPayload({
        ...payload,
        event: { ...payload.event, kind: 'external' },
      })
    ).toBe(true)
  })

  test('rejects malformed nested activity data', () => {
    expect(
      isNativeOverlayActivityPopoverPayload({
        ...payload,
        event: { ...payload.event, durationMs: Number.NaN },
      })
    ).toBe(false)
  })
})
