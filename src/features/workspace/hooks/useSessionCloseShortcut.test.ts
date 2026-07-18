import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBindings, type CustomKeybindings } from '../../keymap/resolve'
import {
  useSessionCloseShortcut,
  type UseSessionCloseShortcutParams,
} from './useSessionCloseShortcut'

const appended: HTMLElement[] = []

const append = (el: HTMLElement): HTMLElement => {
  document.body.appendChild(el)
  appended.push(el)

  return el
}

const fireKeyW = (
  modifiers: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body
): boolean => {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyW',
    key: 'w',
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
): UseSessionCloseShortcutParams['matches'] => {
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
  overrides: Partial<UseSessionCloseShortcutParams> = {}
): UseSessionCloseShortcutParams => ({
  onCloseActiveSession: vi.fn(),
  matches: matchesFor(true),
  ...overrides,
})

describe('useSessionCloseShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    appended.forEach((el) => el.remove())
    appended.length = 0
  })

  test('⌘W fires on macOS', () => {
    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

    expect(fireKeyW({ metaKey: true })).toBe(true)
    expect(props.onCloseActiveSession).toHaveBeenCalledOnce()
  })

  test('Ctrl+⇧W fires on Linux', () => {
    const props = makeProps({ matches: matchesFor(false) })
    renderHook(() => useSessionCloseShortcut(props))

    expect(fireKeyW({ ctrlKey: true, shiftKey: true })).toBe(true)
    expect(props.onCloseActiveSession).toHaveBeenCalledOnce()
  })

  test('Linux leaves bare Ctrl+W for the terminal delete-word', () => {
    const props = makeProps({ matches: matchesFor(false) })
    renderHook(() => useSessionCloseShortcut(props))

    const prevented = fireKeyW({ ctrlKey: true })

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('ignores key repeat', () => {
    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

    fireKeyW({ metaKey: true, repeat: true })

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
  })

  test('bails while a modal dialog is open', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

    fireKeyW({ metaKey: true })

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
  })

  test('defers to a focused editor / plain text input', () => {
    const editor = append(document.createElement('div'))
    editor.className = 'cm-editor'
    const content = document.createElement('div')
    content.setAttribute('contenteditable', 'true')
    editor.appendChild(content)

    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

    const prevented = fireKeyW({ metaKey: true }, content)

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  test('still fires from inside the terminal zone', () => {
    const zone = append(document.createElement('div'))
    zone.setAttribute('data-container-id', 'terminal')
    const textarea = document.createElement('textarea')
    zone.appendChild(textarea)

    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

    fireKeyW({ metaKey: true }, textarea)

    expect(props.onCloseActiveSession).toHaveBeenCalledOnce()
  })

  test('ignores other keys', () => {
    const props = makeProps({ matches: matchesFor(true) })
    renderHook(() => useSessionCloseShortcut(props))

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

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
  })

  test('detaches its listener on unmount', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const { unmount } = renderHook(() => useSessionCloseShortcut(props))

    unmount()
    fireKeyW({ metaKey: true })

    expect(props.onCloseActiveSession).not.toHaveBeenCalled()
  })

  test('fires on a rebound combo supplied by the registry matcher', () => {
    const props = makeProps({
      matches: matchesFor(true, { 'session-close': 'Mod+KeyQ' }),
    })
    renderHook(() => useSessionCloseShortcut(props))

    const event = new KeyboardEvent('keydown', {
      code: 'KeyQ',
      key: 'q',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.body.dispatchEvent(event)
    })

    expect(props.onCloseActiveSession).toHaveBeenCalledOnce()
  })
})
