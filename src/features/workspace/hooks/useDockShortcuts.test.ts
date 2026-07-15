import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBindings, type CustomKeybindings } from '../../keymap/resolve'
import { DOCK_CONTAINER_ID, TERMINAL_CONTAINER_ID } from '../containerIds'
import { useDockShortcuts } from './useDockShortcuts'

const fire = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent & { preventDefaultSpy: ReturnType<typeof vi.spyOn> } => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  document.dispatchEvent(event)

  return Object.assign(event, { preventDefaultSpy })
}

const attachDockAndFocus = (): HTMLElement => {
  const element = document.createElement('section')
  element.setAttribute('data-container-id', DOCK_CONTAINER_ID)
  element.setAttribute('tabindex', '-1')
  document.body.appendChild(element)
  element.focus()

  return element
}

const removeElement = (element: HTMLElement): void => {
  document.body.removeChild(element)
}

const blurActiveElement = (): void => {
  const activeElement = document.activeElement as HTMLElement | null
  activeElement?.blur?.()
}

const matchesFor = (
  isMac: boolean,
  overrides: CustomKeybindings = {}
): Parameters<typeof useDockShortcuts>[0]['matches'] => {
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

describe('useDockShortcuts', () => {
  const makeProps = (
    overrides: Partial<Parameters<typeof useDockShortcuts>[0]> = {}
  ): Parameters<typeof useDockShortcuts>[0] => ({
    activeContainerId: DOCK_CONTAINER_ID,
    openDock: vi.fn(),
    claimTerminal: vi.fn(),
    matches: matchesFor(false),
    modKey: 'Ctrl',
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('Ctrl+e calls openDock("editor") and prevents default', () => {
    const props = makeProps()
    const dockElement = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).toHaveBeenCalledWith('editor')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeElement(dockElement)
  })

  test('Ctrl+g calls openDock("diff") and prevents default', () => {
    const props = makeProps()
    const dockElement = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('g', { ctrlKey: true })

    expect(props.openDock).toHaveBeenCalledWith('diff')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeElement(dockElement)
  })

  test('Ctrl+b when dock active and activeElement in dock calls claimTerminal', () => {
    const props = makeProps({ activeContainerId: DOCK_CONTAINER_ID })
    const dockElement = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeElement(dockElement)
  })

  test('Ctrl+b when dock active but activeElement outside dock is a no-op', () => {
    const props = makeProps({ activeContainerId: DOCK_CONTAINER_ID })
    blurActiveElement()
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+b when terminal active passes through', () => {
    const props = makeProps({ activeContainerId: TERMINAL_CONTAINER_ID })
    renderHook(() => useDockShortcuts(props))

    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('no modifier is a no-op', () => {
    const props = makeProps()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e')

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Shift+Ctrl+e is a no-op', () => {
    const props = makeProps()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true, shiftKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('focus-editor fires on a rebound combo supplied by the registry matcher', () => {
    const props = makeProps({
      matches: matchesFor(false, { 'focus-editor': 'Mod+KeyO' }),
    })
    const dockElement = attachDockAndFocus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('o', { ctrlKey: true })

    expect(props.openDock).toHaveBeenCalledWith('editor')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeElement(dockElement)
  })

  test('Ctrl+e from within a dialog is a no-op', () => {
    const props = makeProps()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)
    inner.focus()
    renderHook(() => useDockShortcuts(props))

    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dialog)
  })

  test('macOS modifier mode accepts Cmd+e and ignores Ctrl+e', () => {
    const props = makeProps({ matches: matchesFor(true), modKey: '⌘' })
    renderHook(() => useDockShortcuts(props))

    fire('e', { ctrlKey: true })
    expect(props.openDock).not.toHaveBeenCalled()

    fire('e', { metaKey: true })
    expect(props.openDock).toHaveBeenCalledWith('editor')
  })

  test('unmount removes listener', () => {
    const props = makeProps()
    const { unmount } = renderHook(() => useDockShortcuts(props))

    unmount()
    fire('e', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
  })

  test('Ctrl+e does not fire when focus is inside terminal zone (xterm readline guard)', () => {
    // xterm uses a hidden textarea for PTY input; Ctrl+e is readline "end-of-line".
    // The hook must pass through when the event originates from the terminal zone.
    const props = makeProps()

    const terminalZone = document.createElement('div')
    terminalZone.setAttribute('data-container-id', TERMINAL_CONTAINER_ID)
    const xtermTextarea = document.createElement('textarea')
    xtermTextarea.className = 'xterm-helper-textarea'
    terminalZone.appendChild(xtermTextarea)
    document.body.appendChild(terminalZone)
    xtermTextarea.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(terminalZone)
  })

  test('Ctrl+g does not fire when focus is inside terminal zone (xterm abort guard)', () => {
    const props = makeProps()

    const terminalZone = document.createElement('div')
    terminalZone.setAttribute('data-container-id', TERMINAL_CONTAINER_ID)
    const xtermTextarea = document.createElement('textarea')
    xtermTextarea.className = 'xterm-helper-textarea'
    terminalZone.appendChild(xtermTextarea)
    document.body.appendChild(terminalZone)
    xtermTextarea.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('g', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(terminalZone)
  })

  test('Ctrl+e does not fire when CodeMirror has focus (vim scroll guard)', () => {
    // CodeMirror vim: Ctrl+e scrolls viewport down — must not be stolen.
    const props = makeProps()

    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.setAttribute('contenteditable', 'true')
    cmContent.className = 'cm-content'
    cmEditor.appendChild(cmContent)
    document.body.appendChild(cmEditor)
    cmContent.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('e', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(cmEditor)
  })

  test('Ctrl+b does not fire claimTerminal when CodeMirror has focus (vim scroll-back guard)', () => {
    // vim normal mode: Ctrl+b scrolls one page backward — must not trigger claimTerminal.
    // CodeMirror lives inside the dock section, so both activeContainerId and closest() checks
    // would pass without the !inCodeMirror guard.
    const props = makeProps({ activeContainerId: DOCK_CONTAINER_ID })

    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.setAttribute('contenteditable', 'true')
    cmContent.className = 'cm-content'
    cmEditor.appendChild(cmContent)
    document.body.appendChild(cmEditor)
    cmContent.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('b', { ctrlKey: true })

    expect(props.claimTerminal).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(cmEditor)
  })

  test('Ctrl+g does not fire when CodeMirror has focus (vim print location guard)', () => {
    // CodeMirror vim: Ctrl+g prints file/line info — must not switch to diff.
    const props = makeProps()

    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.setAttribute('contenteditable', 'true')
    cmContent.className = 'cm-content'
    cmEditor.appendChild(cmContent)
    document.body.appendChild(cmEditor)
    cmContent.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('g', { ctrlKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(cmEditor)
  })

  test('Cmd+g fires openDock("diff") from within the terminal zone (macOS jump-to-diff)', () => {
    // macOS terminals drive vim/readline with Ctrl, so Cmd+g never collides — it
    // must reach the diff dock even when xterm has focus (VIM-277).
    const props = makeProps({ matches: matchesFor(true), modKey: '⌘' })

    const terminalZone = document.createElement('div')
    terminalZone.setAttribute('data-container-id', TERMINAL_CONTAINER_ID)
    const xtermTextarea = document.createElement('textarea')
    xtermTextarea.className = 'xterm-helper-textarea'
    terminalZone.appendChild(xtermTextarea)
    document.body.appendChild(terminalZone)
    xtermTextarea.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('g', { metaKey: true })

    expect(props.openDock).toHaveBeenCalledWith('diff')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    document.body.removeChild(terminalZone)
  })

  test('Cmd+e fires openDock("editor") from within the terminal zone (macOS jump-to-editor)', () => {
    const props = makeProps({ matches: matchesFor(true), modKey: '⌘' })

    const terminalZone = document.createElement('div')
    terminalZone.setAttribute('data-container-id', TERMINAL_CONTAINER_ID)
    const xtermTextarea = document.createElement('textarea')
    xtermTextarea.className = 'xterm-helper-textarea'
    terminalZone.appendChild(xtermTextarea)
    document.body.appendChild(terminalZone)
    xtermTextarea.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('e', { metaKey: true })

    expect(props.openDock).toHaveBeenCalledWith('editor')
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    document.body.removeChild(terminalZone)
  })

  test('Cmd+g does not fire when CodeMirror has focus (find-next preserved)', () => {
    // CodeMirror binds Cmd/Ctrl+g to find-next; the guard must still hold there
    // even though it now lets Cmd+g out of the terminal zone (VIM-277).
    const props = makeProps({ modKey: '⌘' })

    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.setAttribute('contenteditable', 'true')
    cmContent.className = 'cm-content'
    cmEditor.appendChild(cmContent)
    document.body.appendChild(cmEditor)
    cmContent.focus()

    renderHook(() => useDockShortcuts(props))
    const event = fire('g', { metaKey: true })

    expect(props.openDock).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(cmEditor)
  })
})
