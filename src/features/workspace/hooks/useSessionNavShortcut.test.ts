import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useSessionNavShortcut,
  type UseSessionNavShortcutParams,
} from './useSessionNavShortcut'

const appended: HTMLElement[] = []

const append = (el: HTMLElement): HTMLElement => {
  document.body.appendChild(el)
  appended.push(el)

  return el
}

const fireBracket = (
  code: 'BracketLeft' | 'BracketRight',
  modifiers: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body
): boolean => {
  const event = new KeyboardEvent('keydown', {
    code,
    key: code === 'BracketLeft' ? '[' : ']',
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
  overrides: Partial<UseSessionNavShortcutParams> = {}
): UseSessionNavShortcutParams => ({
  onPrevSession: vi.fn(),
  onNextSession: vi.fn(),
  modKey: '⌘',
  ...overrides,
})

describe('useSessionNavShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    appended.forEach((el) => el.remove())
    appended.length = 0
  })

  test('⌘[ / ⌘] cycle prev / next on macOS', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    expect(fireBracket('BracketLeft', { metaKey: true })).toBe(true)
    expect(fireBracket('BracketRight', { metaKey: true })).toBe(true)

    expect(props.onPrevSession).toHaveBeenCalledOnce()
    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('Ctrl+⇧[ / Ctrl+⇧] cycle on Linux', () => {
    const props = makeProps({ modKey: 'Ctrl' })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { ctrlKey: true, shiftKey: true })
    fireBracket('BracketRight', { ctrlKey: true, shiftKey: true })

    expect(props.onPrevSession).toHaveBeenCalledOnce()
    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('macOS rejects the Shift variant', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { metaKey: true, shiftKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })

  test('Linux leaves bare Ctrl+[ for the terminal ESC', () => {
    const props = makeProps({ modKey: 'Ctrl' })
    renderHook(() => useSessionNavShortcut(props))

    const prevented = fireBracket('BracketLeft', { ctrlKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores the opposite modifier so it reaches the terminal', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    const prevented = fireBracket('BracketLeft', { ctrlKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('defers to a focused editor (CodeMirror owns ⌘[ / ⌘])', () => {
    const editor = append(document.createElement('div'))
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    content.setAttribute('contenteditable', 'true')
    editor.appendChild(content)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    const prevented = fireBracket('BracketLeft', { metaKey: true }, content)

    expect(props.onPrevSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('still fires from inside the terminal zone', () => {
    const zone = append(document.createElement('div'))
    zone.setAttribute('data-container-id', 'terminal')
    const textarea = document.createElement('textarea')
    zone.appendChild(textarea)

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketRight', { metaKey: true }, textarea)

    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('bails while a modal dialog is open', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { metaKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })

  test('ignores other keys', () => {
    const props = makeProps({ modKey: '⌘' })
    renderHook(() => useSessionNavShortcut(props))

    const event = new KeyboardEvent('keydown', {
      code: 'KeyP',
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(event)
    })

    expect(props.onPrevSession).not.toHaveBeenCalled()
    expect(props.onNextSession).not.toHaveBeenCalled()
  })

  test('detaches its listener on unmount', () => {
    const props = makeProps({ modKey: '⌘' })
    const { unmount } = renderHook(() => useSessionNavShortcut(props))

    unmount()
    fireBracket('BracketLeft', { metaKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })
})
