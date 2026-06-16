import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clearTerminalCache,
  disposeTerminalSession,
  terminalCache,
} from './terminalRegistry'
import type { TerminalRegistryEntry } from './terminalRegistry'

const createEntry = (): TerminalRegistryEntry => ({
  terminal: {
    cols: 80,
    rows: 24,
    element: undefined,
    open: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    refresh: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    hasSelection: vi.fn((): boolean => false),
    getSelection: vi.fn((): string => ''),
    paste: vi.fn(),
    selectAll: vi.fn(),
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
    attachKeyEventHandler: vi.fn(),
    applyTheme: vi.fn(),
  },
  fitController: { fit: vi.fn() },
  viewportReader: { readVisibleText: vi.fn((): string => '') },
})

describe('terminalRegistry', () => {
  afterEach(() => {
    terminalCache.clear()
  })

  test('clears and disposes every cached terminal', () => {
    const first = createEntry()
    const second = createEntry()

    terminalCache.set('pty-a', first)
    terminalCache.set('pty-b', second)

    clearTerminalCache()

    expect(first.terminal.dispose).toHaveBeenCalledOnce()
    expect(second.terminal.dispose).toHaveBeenCalledOnce()
    expect(terminalCache.size).toBe(0)
  })

  test('disposes one terminal session without touching other entries', () => {
    const first = createEntry()
    const second = createEntry()

    terminalCache.set('pty-a', first)
    terminalCache.set('pty-b', second)

    disposeTerminalSession('pty-a')

    expect(first.terminal.dispose).toHaveBeenCalledOnce()
    expect(second.terminal.dispose).not.toHaveBeenCalled()
    expect(terminalCache.has('pty-a')).toBe(false)
    expect(terminalCache.get('pty-b')).toBe(second)
  })
})
