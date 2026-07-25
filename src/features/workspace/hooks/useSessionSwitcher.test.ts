import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SESSION_SWITCHER_DIALOG_TEST_ID } from '@/features/sessions/components/SessionSwitcher'
import type { CommandId } from '../../keymap/catalog'
import type { Chord, Mod } from '../../keymap/chord'
import {
  useSessionSwitcher,
  type SessionSwitcherController,
} from './useSessionSwitcher'

const ctrlTab = (repeat = false): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    code: 'Tab',
    key: 'Tab',
    ctrlKey: true,
    repeat,
    bubbles: true,
  })

const ctrlShiftTab = (): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    code: 'Tab',
    key: 'Tab',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
  })

const ctrlKeyUp = (): KeyboardEvent =>
  new KeyboardEvent('keyup', {
    code: 'ControlLeft',
    key: 'Control',
    bubbles: true,
  })

const matches = (event: KeyboardEvent, id: CommandId): boolean => {
  if (event.type !== 'keydown' || event.code !== 'Tab' || !event.ctrlKey) {
    return false
  }
  if (id === 'session-switch-next') {
    return !event.shiftKey
  }

  return id === 'session-switch-prev' && event.shiftKey
}

const bindingFor = (id: CommandId): Chord =>
  id === 'session-switch-prev'
    ? { code: 'Tab', mods: new Set<Mod>(['Ctrl', 'Shift']) }
    : { code: 'Tab', mods: new Set<Mod>(['Ctrl']) }

type SwitcherHarness = RenderHookResult<
  SessionSwitcherController,
  { ids: readonly string[] }
> & {
  onCommit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
}

const setup = (
  orderedIds: readonly string[],
  activeSessionId: string | null = orderedIds[0] ?? null
): SwitcherHarness => {
  const onCommit = vi.fn()
  const onCancel = vi.fn()

  const rendered = renderHook(
    ({ ids }: { ids: readonly string[] }) =>
      useSessionSwitcher({
        orderedIds: ids,
        activeSessionId,
        matches,
        bindingFor,
        onCommit,
        onCancel,
      }),
    { initialProps: { ids: orderedIds } }
  )

  return { ...rendered, onCommit, onCancel }
}

const appended: HTMLElement[] = []

const append = (el: HTMLElement): HTMLElement => {
  document.body.appendChild(el)
  appended.push(el)

  return el
}

afterEach(() => {
  appended.forEach((el) => el.remove())
  appended.length = 0
  vi.restoreAllMocks()
})

describe('useSessionSwitcher', () => {
  test('a foreign open dialog blocks the chord from opening', () => {
    const dialog = append(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')

    const { result } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(false)
  })

  test('its own exiting dialog does not block a rapid second tap', () => {
    const exiting = append(document.createElement('div'))
    exiting.setAttribute('role', 'dialog')
    exiting.setAttribute('data-testid', SESSION_SWITCHER_DIALOG_TEST_ID)

    const { result, onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(true)

    act(() => void document.dispatchEvent(ctrlKeyUp()))
    expect(onCommit).toHaveBeenCalledWith('B')
  })

  test('quick tap commits the previous session (MRU index 1)', () => {
    const { result, onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(true)
    expect(result.current.selectedIndex).toBe(1)

    act(() => void document.dispatchEvent(ctrlKeyUp()))
    expect(onCommit).toHaveBeenCalledWith('B')
    expect(result.current.open).toBe(false)
  })

  test('quick tap from outside the live set commits the first MRU session', () => {
    const { result, onCommit } = setup(['A', 'B'], 'recent')

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.selectedIndex).toBe(0)

    act(() => void document.dispatchEvent(ctrlKeyUp()))
    expect(onCommit).toHaveBeenCalledWith('A')
  })

  test('held Ctrl with repeated Tab advances with wraparound', () => {
    const { result } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(2)
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(0)
  })

  test('ctrl+shift+tab opens selecting the last entry and steps backward', () => {
    const { result } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlShiftTab()))
    expect(result.current.selectedIndex).toBe(2)
    act(() => void document.dispatchEvent(ctrlShiftTab()))
    expect(result.current.selectedIndex).toBe(1)
  })

  test('escape cancels without committing', () => {
    const { result, onCommit, onCancel } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
          })
        )
    )
    expect(onCancel).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  test('lost keyup: a modifier-free keydown commits like a release', () => {
    const { onCommit } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'a',
            code: 'KeyA',
            bubbles: true,
          })
        )
    )
    expect(onCommit).toHaveBeenCalledWith('B')
  })

  test('enter commits the current selection', () => {
    const { onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    act(
      () =>
        void document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            ctrlKey: true,
            bubbles: true,
          })
        )
    )
    expect(onCommit).toHaveBeenCalledWith('C')
  })

  test('window blur cancels', () => {
    const { result, onCancel } = setup(['A', 'B'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(onCancel).toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  test('selection clamps when the list shrinks while open', () => {
    const { result, rerender } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    act(() => void document.dispatchEvent(ctrlTab(true)))
    expect(result.current.selectedIndex).toBe(2)

    rerender({ ids: ['A', 'B'] })
    expect(result.current.selectedIndex).toBe(1)
  })

  test('reorder while open keeps the selected session identity', () => {
    const { result, rerender } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.selectedIndex).toBe(1)

    rerender({ ids: ['B', 'C', 'A'] })
    expect(result.current.selectedIndex).toBe(0)
  })

  test('release after a reorder commits the session picked before it', () => {
    const { result, rerender, onCommit } = setup(['A', 'B', 'C'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.selectedIndex).toBe(1)

    rerender({ ids: ['C', 'A', 'B'] })
    act(() => void document.dispatchEvent(ctrlKeyUp()))
    expect(onCommit).toHaveBeenCalledWith('B')
  })

  test('zero sessions: the chord does not open', () => {
    const { result } = setup([])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(false)
  })

  test('single session opens inert at index 0', () => {
    const { result } = setup(['A'])

    act(() => void document.dispatchEvent(ctrlTab()))
    expect(result.current.open).toBe(true)
    expect(result.current.selectedIndex).toBe(0)
  })
})
