import { describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSettingsDialog } from './useSettingsDialog'

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

  test('Meta+, toggles the dialog open', () => {
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

  test('Ctrl+, toggles the dialog open', () => {
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
})
