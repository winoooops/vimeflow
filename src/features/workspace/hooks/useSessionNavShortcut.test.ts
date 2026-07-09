import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBindings, type CustomKeybindings } from '../../keymap/resolve'
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

const matchesFor = (
  isMac: boolean,
  overrides: CustomKeybindings = {}
): UseSessionNavShortcutParams['matches'] => {
  const superKey: PlatformSuper = isMac ? 'meta' : 'ctrl'
  const resolved = resolveBindings(overrides, isMac, superKey)

  return (event: KeyboardEvent, id: CommandId): boolean =>
    eventMatchesChord(
      event,
      resolved.get(id)!,
      superKey,
      getCommand(id).matchPolicy
    )
}

const makeProps = (
  overrides: Partial<UseSessionNavShortcutParams> = {}
): UseSessionNavShortcutParams => ({
  onPrevSession: vi.fn(),
  onNextSession: vi.fn(),
  matches: matchesFor(true),
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
    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionNavShortcut(props))

    expect(fireBracket('BracketLeft', { metaKey: true })).toBe(true)
    expect(fireBracket('BracketRight', { metaKey: true })).toBe(true)

    expect(props.onPrevSession).toHaveBeenCalledOnce()
    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('Ctrl+⇧[ / Ctrl+⇧] cycle on Linux', () => {
    const props = makeProps({ matches: matchesFor(false) })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { ctrlKey: true, shiftKey: true })
    fireBracket('BracketRight', { ctrlKey: true, shiftKey: true })

    expect(props.onPrevSession).toHaveBeenCalledOnce()
    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('macOS rejects the Shift variant', () => {
    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { metaKey: true, shiftKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })

  test('Linux leaves bare Ctrl+[ for the terminal ESC', () => {
    const props = makeProps({ matches: matchesFor(false) })
    renderHook(() => useSessionNavShortcut(props))

    const prevented = fireBracket('BracketLeft', { ctrlKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores the opposite modifier so it reaches the terminal', () => {
    const props = makeProps({ matches: matchesFor(true) })
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

    const props = makeProps({ matches: matchesFor(true) })
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

    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketRight', { metaKey: true }, textarea)

    expect(props.onNextSession).toHaveBeenCalledOnce()
  })

  test('bails while a modal dialog is open', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionNavShortcut(props))

    fireBracket('BracketLeft', { metaKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })

  test('ignores other keys', () => {
    const props = makeProps({ matches: matchesFor(true) })
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
    const props = makeProps({ matches: matchesFor(true) })
    const { unmount } = renderHook(() => useSessionNavShortcut(props))

    unmount()
    fireBracket('BracketLeft', { metaKey: true })

    expect(props.onPrevSession).not.toHaveBeenCalled()
  })

  test('fires on rebound combos supplied by the registry matcher', () => {
    const props = makeProps({
      matches: matchesFor(true, {
        'session-prev': 'Mod+KeyJ',
        'session-next': 'Mod+KeyK',
      }),
    })
    renderHook(() => useSessionNavShortcut(props))

    const prev = new KeyboardEvent('keydown', {
      code: 'KeyJ',
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })

    const next = new KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(prev)
      document.body.dispatchEvent(next)
    })

    expect(props.onPrevSession).toHaveBeenCalledOnce()
    expect(props.onNextSession).toHaveBeenCalledOnce()
  })
})
