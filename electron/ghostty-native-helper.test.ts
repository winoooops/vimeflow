import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

import {
  isGhosttyNativeEnabled,
  toGhosttyScreenFrame,
} from './ghostty-native-helper'

describe('ghostty native helper', () => {
  test('enables only on macOS with the feature flag', () => {
    expect(
      isGhosttyNativeEnabled('darwin', { VITE_GHOSTTY_NATIVE_MACOS: '1' })
    ).toBe(true)

    expect(
      isGhosttyNativeEnabled('linux', { VITE_GHOSTTY_NATIVE_MACOS: '1' })
    ).toBe(false)

    expect(isGhosttyNativeEnabled('darwin', {})).toBe(false)
  })

  test('projects renderer pane bounds into window screen bounds', () => {
    expect(
      toGhosttyScreenFrame(
        { x: 100, y: 50, width: 900, height: 700 },
        { x: 10.2, y: 20.6, width: 300.4, height: 200.5 },
        true
      )
    ).toEqual({
      x: 110,
      y: 71,
      width: 300,
      height: 201,
      visible: true,
    })

    expect(
      toGhosttyScreenFrame(
        { x: 100, y: 50, width: 900, height: 700 },
        { x: 10, y: 20, width: 0, height: 200 },
        true
      ).visible
    ).toBe(false)
  })
})
