import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useSidebarTabShortcut,
  type UseSidebarTabShortcutParams,
} from './useSidebarTabShortcut'

const appended: HTMLElement[] = []

const append = (element: HTMLElement): HTMLElement => {
  document.body.appendChild(element)
  appended.push(element)

  return element
}

const fireKey = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body
): boolean => {
  const code =
    modifiers.code ??
    (key.length === 1 && /[a-zA-Z]/.test(key) ? `Key${key.toUpperCase()}` : undefined)
  const event = new KeyboardEvent('keydown', {
    key,
    code,
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
  overrides: Partial<UseSidebarTabShortcutParams> = {}
): UseSidebarTabShortcutParams => ({
  onShowSessions: vi.fn(),
  onShowFiles: vi.fn(),
  modKey: '⌘',
  ...overrides,
})

describe('useSidebarTabShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    appended.forEach((element) => element.remove())
    appended.length = 0
  })

  test('⌘⇧S shows Sessions on macOS', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('S', { metaKey: true, shiftKey: true })

    expect(props.onShowSessions).toHaveBeenCalledOnce()
    expect(props.onShowFiles).not.toHaveBeenCalled()
    expect(prevented).toBe(true)
  })

  test('⌘⇧F shows Files on macOS', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('F', { metaKey: true, shiftKey: true })

    expect(props.onShowFiles).toHaveBeenCalledOnce()
    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(prevented).toBe(true)
  })

  test('Ctrl+⇧S / Ctrl+⇧F switch on Linux', () => {
    const props = makeProps({ modKey: 'Ctrl' })
    renderHook(() => useSidebarTabShortcut(props))

    fireKey('S', { ctrlKey: true, shiftKey: true })
    fireKey('F', { ctrlKey: true, shiftKey: true })

    expect(props.onShowSessions).toHaveBeenCalledOnce()
    expect(props.onShowFiles).toHaveBeenCalledOnce()
  })

  test('requires Shift — bare ⌘S falls through to save', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('s', { metaKey: true })

    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores the opposite modifier so it reaches the terminal', () => {
    // On macOS we only claim ⌘⇧S/F; Ctrl+⇧S must pass through to the PTY.
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('S', { ctrlKey: true, shiftKey: true })

    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores other letters', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    fireKey('A', { metaKey: true, shiftKey: true })

    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(props.onShowFiles).not.toHaveBeenCalled()
  })

  test('matches physical S/F keys even when event.key is non-Latin', () => {
    // Cyrillic: the physical S key produces 'ы' in the active IME, but
    // event.code still identifies it as KeyS.
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('ы', { metaKey: true, shiftKey: true, code: 'KeyS' })

    expect(props.onShowSessions).toHaveBeenCalledOnce()
    expect(prevented).toBe(true)
  })

  test('bails while a modal dialog is open', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('S', { metaKey: true, shiftKey: true })

    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('defers to a plain text input (e.g. session rename field)', () => {
    const input = append(document.createElement('input'))

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('S', { metaKey: true, shiftKey: true }, input)

    expect(props.onShowSessions).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('still fires from inside the terminal zone (switch-from-anywhere)', () => {
    const zone = append(document.createElement('div'))
    zone.setAttribute('data-container-id', 'terminal')
    const textarea = document.createElement('textarea')
    zone.appendChild(textarea)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    fireKey('F', { metaKey: true, shiftKey: true }, textarea)

    expect(props.onShowFiles).toHaveBeenCalledOnce()
  })

  test('fires while the sidebar drawer is open even when focus is outside it', () => {
    const sidebarDialog = document.createElement('div')
    sidebarDialog.setAttribute('role', 'dialog')
    sidebarDialog.setAttribute('aria-label', 'Sidebar')
    append(sidebarDialog)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    // Focus is still on document.body (the opener/terminal did not move it).
    fireKey('F', { metaKey: true, shiftKey: true }, document.body)

    expect(props.onShowFiles).toHaveBeenCalledOnce()
  })

  test('still defers to a non-sidebar dialog even if the sidebar drawer is open', () => {
    const sidebarDialog = document.createElement('div')
    sidebarDialog.setAttribute('role', 'dialog')
    sidebarDialog.setAttribute('aria-label', 'Sidebar')
    append(sidebarDialog)

    const otherDialog = document.createElement('div')
    otherDialog.setAttribute('role', 'dialog')
    append(otherDialog)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSidebarTabShortcut(props))

    const prevented = fireKey('F', { metaKey: true, shiftKey: true })

    expect(props.onShowFiles).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('detaches its listener on unmount', () => {
    const props = makeProps({ modKey: '⌘' })
    const { unmount } = renderHook(() => useSidebarTabShortcut(props))

    unmount()
    fireKey('S', { metaKey: true, shiftKey: true })

    expect(props.onShowSessions).not.toHaveBeenCalled()
  })
})
