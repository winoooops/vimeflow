import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useDockToggleShortcut,
  type UseDockToggleShortcutParams,
} from './useDockToggleShortcut'

const appended: HTMLElement[] = []

const append = (element: HTMLElement): HTMLElement => {
  document.body.appendChild(element)
  appended.push(element)

  return element
}

const fireDigit0 = (
  modifiers: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body
): boolean => {
  const event = new KeyboardEvent('keydown', {
    code: 'Digit0',
    key: '0',
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    target.dispatchEvent(event)
  })

  return event.defaultPrevented
}

const makeProps = (
  overrides: Partial<UseDockToggleShortcutParams> = {}
): UseDockToggleShortcutParams => ({
  onToggle: vi.fn(),
  modKey: '⌘',
  ...overrides,
})

describe('useDockToggleShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    appended.forEach((element) => element.remove())
    appended.length = 0
  })

  test('⌘+0 toggles on macOS', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useDockToggleShortcut(props))

    const prevented = fireDigit0({ metaKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
    expect(prevented).toBe(true)
  })

  test('Ctrl+0 toggles on Linux', () => {
    const props = makeProps({ modKey: 'Ctrl' })
    renderHook(() => useDockToggleShortcut(props))

    const prevented = fireDigit0({ ctrlKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
    expect(prevented).toBe(true)
  })

  test('ignores the opposite modifier so it reaches the terminal', () => {
    // On macOS we only claim ⌘0; Ctrl+0 must pass through to the PTY.
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useDockToggleShortcut(props))

    const prevented = fireDigit0({ ctrlKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores other digits', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useDockToggleShortcut(props))

    const event = new KeyboardEvent('keydown', {
      code: 'Digit1',
      key: '1',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(event)
    })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('fires on Shift+0 so AZERTY/QWERTZ layouts still toggle', () => {
    // The digit 0 sits on a shifted key on several layouts; matching the
    // physical Digit0 keeps the shortcut reachable there.
    const props = makeProps({ modKey: 'Ctrl' })
    renderHook(() => useDockToggleShortcut(props))

    fireDigit0({ ctrlKey: true, shiftKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('bails while a modal dialog is open', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useDockToggleShortcut(props))

    const prevented = fireDigit0({ metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('detaches its listener on unmount', () => {
    const props = makeProps({ modKey: '⌘' })
    const { unmount } = renderHook(() => useDockToggleShortcut(props))

    unmount()
    fireDigit0({ metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })
})
