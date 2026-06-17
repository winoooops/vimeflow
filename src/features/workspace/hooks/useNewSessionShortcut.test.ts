import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBindings, type CustomKeybindings } from '../../keymap/resolve'
import { TERMINAL_CONTAINER_ID } from '../containerIds'
import {
  useNewSessionShortcut,
  type UseNewSessionShortcutParams,
} from './useNewSessionShortcut'

const appended: HTMLElement[] = []

const append = (element: HTMLElement): HTMLElement => {
  document.body.appendChild(element)
  appended.push(element)

  return element
}

// `<div data-container-id="...">` with a child the event fires from, so
// `event.target.closest(...)` resolves to the container in the source.
const appendContainerWithChild = (
  containerId: string,
  childTag = 'div'
): HTMLElement => {
  const container = document.createElement('div')
  container.setAttribute('data-container-id', containerId)
  const child = document.createElement(childTag)
  container.appendChild(child)
  append(container)

  return child
}

const fireFrom = (
  target: HTMLElement,
  modifiers: Partial<KeyboardEventInit> = {}
): void => {
  const event = new KeyboardEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    target.dispatchEvent(event)
  })
}

const matchesFor = (
  isMac: boolean,
  overrides: CustomKeybindings = {}
): UseNewSessionShortcutParams['matches'] => {
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
  overrides: Partial<UseNewSessionShortcutParams> = {}
): UseNewSessionShortcutParams => ({
  onNewSession: vi.fn(),
  matches: matchesFor(true),
  ...overrides,
})

describe('useNewSessionShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    while (appended.length > 0) {
      appended.pop()?.remove()
    }
  })

  describe('meta (⌘) modifier', () => {
    test('⌘N (no shift) creates a session', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true })

      expect(props.onNewSession).toHaveBeenCalledOnce()
    })

    test('⌘⇧N does not fire (shift not allowed on meta)', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true, shiftKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })

    test('⌘⌥N does not fire (alt always bails)', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true, altKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl modifier', () => {
    test('Ctrl+⇧N creates a session', () => {
      const props = makeProps({ matches: matchesFor(false) })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { ctrlKey: true, shiftKey: true })

      expect(props.onNewSession).toHaveBeenCalledOnce()
    })

    test('bare Ctrl+N (no shift) does not fire — left to the terminal', () => {
      const props = makeProps({ matches: matchesFor(false) })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { ctrlKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })
  })

  test('bails when a dialog matching DIALOG_SELECTOR is in the DOM', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)
    const target = append(document.createElement('div'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('⌘N fires from inside the terminal zone', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = appendContainerWithChild(TERMINAL_CONTAINER_ID, 'textarea')
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).toHaveBeenCalledOnce()
  })

  test('bails when the target is a plain <input> (e.g. the rename field)', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('input'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('removes the listener on unmount', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('div'))
    const { unmount } = renderHook(() => useNewSessionShortcut(props))

    unmount()
    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('ignores auto-repeat (held key) events', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('div'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true, repeat: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('fires on a rebound combo supplied by the registry matcher', () => {
    const props = makeProps({
      matches: matchesFor(true, { 'new-session': 'Mod+KeyK' }),
    })
    const target = append(document.createElement('div'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { key: 'k', code: 'KeyK', metaKey: true })

    expect(props.onNewSession).toHaveBeenCalledOnce()
  })
})
