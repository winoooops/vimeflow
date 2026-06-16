import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useDockToggleShortcut } from './useDockToggleShortcut'

const appended: HTMLElement[] = []

const append = (element: HTMLElement): HTMLElement => {
  document.body.appendChild(element)
  appended.push(element)

  return element
}

afterEach(() => {
  appended.forEach((element) => element.remove())
  appended.length = 0
})

const press = (code: string): boolean => {
  const event = new KeyboardEvent('keydown', {
    code,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    document.body.dispatchEvent(event)
  })

  return event.defaultPrevented
}

// `matches` stands in for the registry resolution; the hook is responsible only
// for calling it, the DIALOG guard, and the toggle. The modifier/code matching
// itself is covered by eventMatchesChord's own tests.
const matchesFor =
  (wanted: string) =>
  (event: KeyboardEvent, id: string): boolean =>
    id === 'dock-toggle' && event.code === wanted

describe('useDockToggleShortcut', () => {
  test('fires onToggle + preventDefault when matches() is true and no dialog is open', () => {
    const onToggle = vi.fn()
    renderHook(() =>
      useDockToggleShortcut({ onToggle, matches: matchesFor('Digit0') })
    )

    expect(press('Digit0')).toBe(true)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  test('does not fire when matches() is false', () => {
    const onToggle = vi.fn()
    renderHook(() =>
      useDockToggleShortcut({ onToggle, matches: matchesFor('KeyK') })
    )

    expect(press('Digit0')).toBe(false)
    expect(onToggle).not.toHaveBeenCalled()
  })

  test('fires on the rebound combo (matches resolves a different key)', () => {
    const onToggle = vi.fn()
    renderHook(() =>
      useDockToggleShortcut({ onToggle, matches: matchesFor('KeyK') })
    )

    press('KeyK')
    expect(onToggle).toHaveBeenCalledOnce()
  })

  test('defers to an open modal dialog (guard preserved)', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)

    const onToggle = vi.fn()
    renderHook(() =>
      useDockToggleShortcut({ onToggle, matches: matchesFor('Digit0') })
    )

    expect(press('Digit0')).toBe(false)
    expect(onToggle).not.toHaveBeenCalled()
  })

  test('detaches its listener on unmount', () => {
    const onToggle = vi.fn()
    const { unmount } = renderHook(() =>
      useDockToggleShortcut({ onToggle, matches: matchesFor('Digit0') })
    )

    unmount()
    press('Digit0')
    expect(onToggle).not.toHaveBeenCalled()
  })
})
