import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBindings, type CustomKeybindings } from '../../keymap/resolve'
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
    code: 'KeyB',
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
): UseSidebarShortcutParams['matches'] => {
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
  overrides: Partial<UseSidebarShortcutParams> = {}
): UseSidebarShortcutParams => ({
  onToggle: vi.fn(),
  onToggleActivityPanel: vi.fn(),
  matches: matchesFor(true),
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
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true })

      expect(props.onToggle).toHaveBeenCalledOnce()
    })

    test('⌘⇧B does not toggle (shift not allowed on meta)', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true, shiftKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })

    test('⌘⌥B does not toggle (alt always bails)', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { metaKey: true, altKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })

    test('⌘R toggles the right activity panel only', () => {
      const props = makeProps({ matches: matchesFor(true) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { key: 'r', code: 'KeyR', metaKey: true })

      expect(props.onToggleActivityPanel).toHaveBeenCalledOnce()
      expect(props.onToggle).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl modifier', () => {
    test('Ctrl+⇧B toggles', () => {
      const props = makeProps({ matches: matchesFor(false) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { ctrlKey: true, shiftKey: true })

      expect(props.onToggle).toHaveBeenCalledOnce()
    })

    test('bare Ctrl+B (no shift) does not toggle — left to the terminal', () => {
      const props = makeProps({ matches: matchesFor(false) })
      const target = append(document.createElement('div'))
      renderHook(() => useSidebarShortcut(props))

      fireFrom(target, { ctrlKey: true })

      expect(props.onToggle).not.toHaveBeenCalled()
    })
  })

  test('bails when a real dialog matching DIALOG_SELECTOR is in the DOM', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-label', 'Unsaved changes')
    append(dialog)
    const target = append(document.createElement('div'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('toggles when the compact sidebar drawer (role=dialog aria-label=Sidebar) is open', () => {
    const props = makeProps({ matches: matchesFor(false) })
    const sidebarDialog = document.createElement('div')
    sidebarDialog.setAttribute('role', 'dialog')
    sidebarDialog.setAttribute('aria-label', 'Sidebar')
    const target = document.createElement('button')
    sidebarDialog.appendChild(target)
    append(sidebarDialog)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { ctrlKey: true, shiftKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('does not toggle the activity panel through the compact sidebar dialog', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const sidebarDialog = document.createElement('div')
    sidebarDialog.setAttribute('role', 'dialog')
    sidebarDialog.setAttribute('aria-label', 'Sidebar')
    const target = document.createElement('button')
    sidebarDialog.appendChild(target)
    append(sidebarDialog)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { key: 'r', code: 'KeyR', metaKey: true })

    expect(props.onToggleActivityPanel).not.toHaveBeenCalled()
  })

  test('meta: bails when dock is active and target is inside the dock', () => {
    const props = makeProps({
      matches: matchesFor(true),
      activeContainerId: DOCK_CONTAINER_ID,
    })
    const target = appendContainerWithChild(DOCK_CONTAINER_ID)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('meta: ⌘B toggles when target is inside the terminal zone', () => {
    const props = makeProps({
      matches: matchesFor(true),
      activeContainerId: TERMINAL_CONTAINER_ID,
    })
    const target = appendContainerWithChild(TERMINAL_CONTAINER_ID, 'textarea')
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('bails when the target is a plain <input> (not terminal/codemirror)', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('input'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('removes the listener on unmount', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('div'))
    const { unmount } = renderHook(() => useSidebarShortcut(props))

    unmount()
    fireFrom(target, { metaKey: true })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('fires on a rebound combo supplied by the registry matcher', () => {
    const props = makeProps({
      matches: matchesFor(true, { 'sidebar-toggle': 'Mod+KeyK' }),
    })
    const target = append(document.createElement('div'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { key: 'k', code: 'KeyK', metaKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('fires the activity toggle on its rebound registry combo', () => {
    const props = makeProps({
      matches: matchesFor(true, {
        'activity-panel-toggle': 'Mod+Shift+KeyR',
      }),
    })
    const target = append(document.createElement('div'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, {
      key: 'R',
      code: 'KeyR',
      metaKey: true,
      shiftKey: true,
    })

    expect(props.onToggleActivityPanel).toHaveBeenCalledOnce()
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  test('ignores held activity-toggle repeats', () => {
    const props = makeProps({ matches: matchesFor(true) })
    const target = append(document.createElement('div'))
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, {
      key: 'r',
      code: 'KeyR',
      metaKey: true,
      repeat: true,
    })

    expect(props.onToggleActivityPanel).not.toHaveBeenCalled()
  })

  test('does not defer rebound meta combos to the dock unless the key is B', () => {
    const props = makeProps({
      matches: matchesFor(true, { 'sidebar-toggle': 'Mod+KeyK' }),
      activeContainerId: DOCK_CONTAINER_ID,
    })
    const target = appendContainerWithChild(DOCK_CONTAINER_ID)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { key: 'k', code: 'KeyK', metaKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  test('does not defer a rebound modified B combo to the dock', () => {
    const props = makeProps({
      matches: matchesFor(true, {
        'sidebar-toggle': 'Mod+Shift+KeyB',
      }),
      activeContainerId: DOCK_CONTAINER_ID,
    })
    const target = appendContainerWithChild(DOCK_CONTAINER_ID)
    renderHook(() => useSidebarShortcut(props))

    fireFrom(target, { key: 'B', metaKey: true, shiftKey: true })

    expect(props.onToggle).toHaveBeenCalledOnce()
  })
})
