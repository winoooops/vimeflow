import { describe, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { KEYMAP_CAPTURE_TARGET_ATTRIBUTE } from '../../keymap/capture'
import { useSettingsDialog } from './useSettingsDialog'

const dispatchFromRecorder = (init: KeyboardEventInit): void => {
  const recorder = document.createElement('button')
  recorder.setAttribute(KEYMAP_CAPTURE_TARGET_ATTRIBUTE, 'true')
  document.body.append(recorder)

  try {
    recorder.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      })
    )
  } finally {
    recorder.remove()
  }
}

describe('useSettingsDialog', () => {
  test('initial state is closed', () => {
    const { result } = renderHook(() => useSettingsDialog())

    expect(result.current.isOpen).toBe(false)
  })

  test('open sets isOpen to true', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.open())

    expect(result.current.isOpen).toBe(true)
  })

  test('close sets isOpen to false', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.open())
    act(() => result.current.close())

    expect(result.current.isOpen).toBe(false)
  })

  test('toggle flips isOpen', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(true)

    act(() => result.current.toggle())
    expect(result.current.isOpen).toBe(false)
  })

  test('Meta+, toggles the dialog open on macOS', () => {
    vi.stubGlobal('navigator', { userAgent: 'test-mac', platform: 'MacIntel' })
    const { result } = renderHook(() => useSettingsDialog())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        metaKey: true,
        key: ',',
        bubbles: true,
      })
      document.dispatchEvent(event)
    })

    expect(result.current.isOpen).toBe(true)
    vi.unstubAllGlobals()
  })

  test('Ctrl+, toggles the dialog open on non-macOS', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'test-linux',
      platform: 'Linux x86_64',
    })
    const { result } = renderHook(() => useSettingsDialog())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        ctrlKey: true,
        key: ',',
        bubbles: true,
      })
      document.dispatchEvent(event)
    })

    expect(result.current.isOpen).toBe(true)
    vi.unstubAllGlobals()
  })

  test('Escape closes the dialog when open', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.open())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      })
      document.dispatchEvent(event)
    })

    expect(result.current.isOpen).toBe(false)
  })

  test('Escape does nothing when dialog is closed', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      })
      document.dispatchEvent(event)
    })

    expect(result.current.isOpen).toBe(false)
  })

  test('keymap recorder events do not toggle or close the dialog', () => {
    const { result } = renderHook(() => useSettingsDialog())

    act(() => {
      dispatchFromRecorder({ ctrlKey: true, key: ',' })
    })

    expect(result.current.isOpen).toBe(false)

    act(() => result.current.open())
    act(() => {
      dispatchFromRecorder({ key: 'Escape' })
    })

    expect(result.current.isOpen).toBe(true)
  })
})
