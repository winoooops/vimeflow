import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DOCK_CONTAINER_ID, TERMINAL_CONTAINER_ID } from '../containerIds'
import {
  useSidebarShortcut,
  type UseSidebarShortcutParams,
} from './useSidebarShortcut'

const appended: HTMLElement[] = []

const append = (element: HTMLElement): HTMLElement => {
  document.body.appendChild(element)
  appended.push(element)

  return element
}

// Build a `<div data-container-id="...">` with a child the event is dispatched
// from, so `event.target.closest(...)` resolves to the container in the source.
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
    key: 'b',
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  act(() => {
    target.dispatchEvent(event)
  })
}

const makeProps = (
  overrides: Partial<UseSidebarShortcutParams> = {}
): UseSidebarShortcutParams => ({
  onToggle: vi.fn(),
  modKey: '⌘',
  activeContainerId: TERMINAL_CONTAINER_ID,
  ...overrides,
})

describe('useSidebarShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    while (appended.length > 0) {
      appended.pop()?.remove()
    }
  })

  describe('meta (⌘) modifier', () => {
    test('⌘B (no shift) toggles', () => {
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true })

      expect(props.onToggle).toHaveBeenCalledOnce()
    })

    test('⌘⇧B does not toggle (shift not allowed on meta)', () => {
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true, shiftKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })

    test('⌘⌥B does not toggle (alt always bails)', () => {
      const props = makeProps({ modKey: '⌘' })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true, altKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl modifier', () => {
    test('Ctrl+⇧B toggles', () => {
      const props = makeProps({ modKey: 'Ctrl' })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { ctrlKey: true, shiftKey: true })

      expect(props.onToggle).toHaveBeenCalledOnce()
    })

    test('bare Ctrl+B (no shift) does not toggle — left to the terminal', () => {
      const props = makeProps({ modKey: 'Ctrl' })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { ctrlKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })
  })

  test('bails when a dialog matching DIALOG_SELECTOR is in the DOM', () => {
    const props = makeProps({ modKey: '⌘' })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    append(dialog)
    const target = append(document.createElement('div'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('meta: bails when dock is active and target is inside the dock', () => {
    const props = makeProps({
      modKey: '⌘',
      activeContainerId: DOCK_CONTAINER_ID,
    })
    const target = appendContainerWithChild(DOCK_CONTAINER_ID)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('meta: ⌘B toggles when target is inside the terminal zone', () => {
    const props = makeProps({
      modKey: '⌘',
      activeContainerId: TERMINAL_CONTAINER_ID,
    })
    const target = appendContainerWithChild(TERMINAL_CONTAINER_ID, 'textarea')
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('bails when the target is a plain <input> (not terminal/codemirror)', () => {
    const props = makeProps({ modKey: '⌘' })
    const target = append(document.createElement('input'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('removes the listener on unmount', () => {
    const props = makeProps({ modKey: '⌘' })
    const target = append(document.createElement('div'))
    const { unmount } = renderHook(() => useSidebarShortcut(props))

    unmount()
    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })
})
