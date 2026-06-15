import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useBurnerToggleShortcut,
  type UseBurnerToggleShortcutParams,
} from './useBurnerToggleShortcut'

const appended: HTMLElement[] = []

const append = (el: HTMLElement): HTMLElement => {
  document.body.appendChild(el)
  appended.push(el)

  return el
}

const fireBackquote = (
  modifiers: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body
): boolean => {
  const event = new KeyboardEvent('keydown', {
    code: 'Backquote',
    key: '`',
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
  overrides: Partial<UseBurnerToggleShortcutParams> = {}
): UseBurnerToggleShortcutParams => ({
  onToggle: vi.fn(),
  ...overrides,
})

describe('useBurnerToggleShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    appended.forEach((el) => el.remove())
    appended.length = 0
  })

  test('Ctrl+` toggles the burner', () => {
    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    const prevented = fireBackquote({ ctrlKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
    expect(prevented).toBe(true)
  })

  test('fires from inside the terminal zone too', () => {
    const zone = append(document.createElement('div'))
    zone.setAttribute('data-container-id', 'terminal')
    const textarea = document.createElement('textarea')
    zone.appendChild(textarea)

    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    fireBackquote({ ctrlKey: true }, textarea)

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('ignores ⌘+` (reserved for OS window cycling)', () => {
    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    const prevented = fireBackquote({ metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores Ctrl+Shift+` and Ctrl+Alt+`', () => {
    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    fireBackquote({ ctrlKey: true, shiftKey: true })
    fireBackquote({ ctrlKey: true, altKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('ignores a bare backtick (reaches the terminal)', () => {
    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    const prevented = fireBackquote({})

    expect(props.onToggle).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores held-key repeats', () => {
    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    fireBackquote({ ctrlKey: true, repeat: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('bails while a modal dialog is open', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    const props = makeProps()
    renderHook(() => useBurnerToggleShortcut(props))

    const prevented = fireBackquote({ ctrlKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('detaches its listener on unmount', () => {
    const props = makeProps()
    const { unmount } = renderHook(() => useBurnerToggleShortcut(props))

    unmount()
    fireBackquote({ ctrlKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })
})
