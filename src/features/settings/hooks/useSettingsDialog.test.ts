import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { KEYMAP_CAPTURE_TARGET_ATTRIBUTE } from '../../keymap/capture'
import type { BackendApi } from '../../../lib/backend'
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
  afterEach(() => {
    delete window.vimeflow
    vi.unstubAllGlobals()
  })

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
  })

  test('open requests the native settings window when the bridge is present', () => {
    const openWindow = vi.fn().mockResolvedValue(undefined)
    window.vimeflow = {
      settings: {
        openWindow,
      },
    } as unknown as BackendApi
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.open())

    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(result.current.isOpen).toBe(false)
  })

  test('shortcut requests the native settings window when the bridge is present', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'test-linux',
      platform: 'Linux x86_64',
    })
    const openWindow = vi.fn().mockResolvedValue(undefined)
    window.vimeflow = {
      settings: {
        openWindow,
      },
    } as unknown as BackendApi
    const { result } = renderHook(() => useSettingsDialog())

    act(() => {
      const event = new KeyboardEvent('keydown', {
        ctrlKey: true,
        key: ',',
        bubbles: true,
      })
      document.dispatchEvent(event)
    })

    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(result.current.isOpen).toBe(false)
  })

  test('falls back to the dialog if native settings window opening fails', async () => {
    window.vimeflow = {
      settings: {
        openWindow: vi.fn().mockRejectedValue(new Error('failed')),
      },
    } as unknown as BackendApi
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.open())

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true)
    })
  })

  test('toggle closes the fallback dialog after native window opening fails', async () => {
    const openWindow = vi.fn().mockRejectedValue(new Error('failed'))
    window.vimeflow = {
      settings: {
        openWindow,
      },
    } as unknown as BackendApi
    const { result } = renderHook(() => useSettingsDialog())

    act(() => result.current.toggle())

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true)
    })

    act(() => result.current.toggle())

    expect(result.current.isOpen).toBe(false)
    expect(openWindow).toHaveBeenCalledTimes(1)
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
