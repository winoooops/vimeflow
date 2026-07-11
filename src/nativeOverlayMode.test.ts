import { describe, expect, test } from 'vitest'
import {
  isNativeOverlayHostMode,
  nativeOverlayHostModeFrom,
} from './nativeOverlayMode'

describe('native overlay mode routing', () => {
  test('treats activity popover windows as native overlay hosts', () => {
    expect(isNativeOverlayHostMode('popover')).toBe(true)
    expect(nativeOverlayHostModeFrom('popover')).toBe('menu')
  })

  test('keeps tooltip windows on the tooltip host mode', () => {
    expect(isNativeOverlayHostMode('tooltip')).toBe(true)
    expect(nativeOverlayHostModeFrom('tooltip')).toBe('tooltip')
  })

  test('rejects the normal app window path', () => {
    expect(isNativeOverlayHostMode(null)).toBe(false)
    expect(isNativeOverlayHostMode('')).toBe(false)
  })
})
