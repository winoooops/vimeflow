import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    target.dispatchEvent(event)
  })
}

const makeProps = (
  overrides: Partial<UseNewSessionShortcutParams> = {}
): UseNewSessionShortcutParams => ({
  onNewSession: vi.fn(),
  modKey: '⌘',
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
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true })

      expect(props.onNewSession).toHaveBeenCalledOnce()
    })

    test('⌘⇧N does not fire (shift not allowed on meta)', () => {
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true, shiftKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })

    test('⌘⌥N does not fire (alt always bails)', () => {
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { metaKey: true, altKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl modifier', () => {
    test('Ctrl+⇧N creates a session', () => {
      const props = makeProps({ modKey: 'Ctrl' })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { ctrlKey: true, shiftKey: true })

      expect(props.onNewSession).toHaveBeenCalledOnce()
    })

    test('bare Ctrl+N (no shift) does not fire — left to the terminal', () => {
      const props = makeProps({ modKey: 'Ctrl' })
      const target = append(document.createElement('div'))
      renderHook(() => useNewSessionShortcut(props))

      fireFrom(target, { ctrlKey: true })

      expect(props.onNewSession).not.toHaveBeenCalled()
    })
  })

  test('bails when a dialog matching DIALOG_SELECTOR is in the DOM', () => {
    const props = makeProps({ modKey: '⌘' })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)
    const target = append(document.createElement('div'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('⌘N fires from inside the terminal zone', () => {
    const props = makeProps({ modKey: '⌘' })
    const target = appendContainerWithChild(TERMINAL_CONTAINER_ID, 'textarea')
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).toHaveBeenCalledOnce()
  })

  test('bails when the target is a plain <input> (e.g. the rename field)', () => {
    const props = makeProps({ modKey: '⌘' })
    const target = append(document.createElement('input'))
    renderHook(() => useNewSessionShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })

  test('removes the listener on unmount', () => {
    const props = makeProps({ modKey: '⌘' })
    const target = append(document.createElement('div'))
    const { unmount } = renderHook(() => useNewSessionShortcut(props))

    unmount()
    fireFrom(target, { metaKey: true })

    expect(props.onNewSession).not.toHaveBeenCalled()
  })
})
