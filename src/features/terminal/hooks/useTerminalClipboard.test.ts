import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useTerminalClipboard } from './useTerminalClipboard'
import type { TerminalDisposable, TerminalSurface } from '../types'

interface MockClipboardTerminal extends TerminalSurface {
  clearSelection: () => void
}

interface MockTerminalControls {
  terminal: MockClipboardTerminal
  fireSelectionChange: (hasSelection: boolean) => void
  element: HTMLElement
}

type AttachedHandler = (event: KeyboardEvent) => boolean

const createMockTerminal = (): MockTerminalControls => {
  const element = document.createElement('div')
  const selectionListeners = new Set<() => void>()
  let selectionText = ''

  const terminal = {
    element,
    hasSelection: (): boolean => selectionText.length > 0,
    getSelection: (): string => selectionText,
    clearSelection: (): void => {
      selectionText = ''
    },
    clear: (): void => undefined,
    selectAll: (): void => {
      selectionText = 'EVERYTHING'
    },
    paste: (): void => undefined,
    attachKeyEventHandler: vi.fn(),
    onSelectionChange: (listener: () => void): TerminalDisposable => {
      selectionListeners.add(listener)

      return {
        dispose: (): void => {
          selectionListeners.delete(listener)
        },
      }
    },
  } as unknown as MockClipboardTerminal

  return {
    terminal,
    element,
    fireSelectionChange: (hasSelection): void => {
      selectionText = hasSelection ? 'EVERYTHING' : ''
      selectionListeners.forEach((listener) => {
        listener()
      })
    },
  }
}

interface ClipboardMockControls {
  writeTextMock: ReturnType<typeof vi.fn>
  readTextMock: ReturnType<typeof vi.fn>
  restore: () => void
}

const installClipboardMock = (
  overrides: {
    writeText?: () => Promise<void>
    readText?: () => Promise<string>
  } = {}
): ClipboardMockControls => {
  const writeTextMock = vi.fn(
    overrides.writeText ?? ((): Promise<void> => Promise.resolve())
  )

  const readTextMock = vi.fn(
    overrides.readText ?? ((): Promise<string> => Promise.resolve(''))
  )
  const original = window.navigator.clipboard

  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: writeTextMock, readText: readTextMock },
    configurable: true,
    writable: true,
  })

  return {
    writeTextMock,
    readTextMock,
    restore: (): void => {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: original,
        configurable: true,
        writable: true,
      })
    },
  }
}

const installExecCommandStub = (
  returnValue: boolean
): { restore: () => void; spy: ReturnType<typeof vi.fn> } => {
  const spy = vi.fn(() => returnValue)

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'execCommand'
  )

  Object.defineProperty(document, 'execCommand', {
    value: spy,
    configurable: true,
    writable: true,
  })

  return {
    spy,
    restore: (): void => {
      if (originalDescriptor) {
        Object.defineProperty(document, 'execCommand', originalDescriptor)

        return
      }

      delete (document as unknown as { execCommand?: unknown }).execCommand
    },
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const captureKeyHandler = (mock: MockTerminalControls): AttachedHandler => {
  const attachSpy = mock.terminal.attachKeyEventHandler as unknown as {
    mock: { calls: [AttachedHandler][] }
  }
  const calls = attachSpy.mock.calls
  const lastCall = calls[calls.length - 1]

  expect(lastCall).toBeDefined()

  return lastCall[0]
}

const keyboardEvent = (
  overrides: Partial<KeyboardEventInit> & {
    type?: string
    code: string
  }
): KeyboardEvent => {
  const { type = 'keydown', code, ...rest } = overrides

  return new KeyboardEvent(type, { code, ...rest })
}

test('terminal === null -> all callbacks are no-ops and state is empty', async () => {
  const { result } = renderHook(() => useTerminalClipboard({ terminal: null }))

  expect(result.current.hasSelection).toBe(false)
  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()
  expect(() => result.current.selectAll()).not.toThrow()
  expect(() => result.current.clear()).not.toThrow()
  expect(() => result.current.close()).not.toThrow()
  await expect(result.current.copy()).resolves.toBeUndefined()
  await expect(result.current.paste()).resolves.toBeUndefined()
})

test('hasSelection flips true when terminal.onSelectionChange fires with a selection', () => {
  const mock = createMockTerminal()

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  expect(result.current.hasSelection).toBe(false)
  act(() => {
    mock.fireSelectionChange(true)
  })

  expect(result.current.hasSelection).toBe(true)
})

test('hasSelection flips back to false when selection clears', () => {
  const mock = createMockTerminal()

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  act(() => {
    mock.fireSelectionChange(true)
  })
  expect(result.current.hasSelection).toBe(true)

  act(() => {
    mock.fireSelectionChange(false)
  })
  expect(result.current.hasSelection).toBe(false)
})

test('selectAll() forwards to terminal.selectAll', () => {
  const mock = createMockTerminal()
  const spy = vi.spyOn(mock.terminal, 'selectAll')

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  result.current.selectAll()

  expect(spy).toHaveBeenCalledOnce()
})

test('clear() forwards to terminal.clear, not clearSelection', () => {
  const mock = createMockTerminal()
  const clearSpy = vi.spyOn(mock.terminal, 'clear')
  const clearSelectionSpy = vi.spyOn(mock.terminal, 'clearSelection')

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  result.current.clear()

  expect(clearSpy).toHaveBeenCalledOnce()
  expect(clearSelectionSpy).not.toHaveBeenCalled()
})

test('copy() with selection writes selection text via navigator.clipboard.writeText', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )
    act(() => {
      mock.fireSelectionChange(true)
    })

    await result.current.copy()

    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('copy() with empty selection is a no-op', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )

    await result.current.copy()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('copy() falls back to execCommand("copy") when writeText rejects', async () => {
  const mock = createMockTerminal()

  const clipboard = installClipboardMock({
    writeText: () => Promise.reject(new Error('writeText denied')),
  })
  const execStub = installExecCommandStub(true)

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )
    act(() => {
      mock.fireSelectionChange(true)
    })

    await result.current.copy()

    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
    expect(execStub.spy).toHaveBeenCalledWith('copy')
  } finally {
    clipboard.restore()
    execStub.restore()
  }
})

test('copy() calls onCopyError when both writeText and execCommand fail', async () => {
  const mock = createMockTerminal()

  const clipboard = installClipboardMock({
    writeText: () => Promise.reject(new Error('writeText denied')),
  })
  const execStub = installExecCommandStub(false)
  const onCopyError = vi.fn()

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onCopyError,
      })
    )
    act(() => {
      mock.fireSelectionChange(true)
    })

    await result.current.copy()

    expect(onCopyError).toHaveBeenCalledOnce()
    expect(onCopyError.mock.calls[0][0]).toBeInstanceOf(Error)
  } finally {
    clipboard.restore()
    execStub.restore()
  }
})

test('copy() calls onCopyError when document.execCommand is undefined', async () => {
  const mock = createMockTerminal()

  const clipboard = installClipboardMock({
    writeText: () => Promise.reject(new Error('writeText denied')),
  })
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand')

  delete (document as unknown as { execCommand?: unknown }).execCommand
  const onCopyError = vi.fn()

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onCopyError,
      })
    )
    act(() => {
      mock.fireSelectionChange(true)
    })

    await result.current.copy()

    expect(onCopyError).toHaveBeenCalledOnce()
  } finally {
    clipboard.restore()
    if (original) {
      Object.defineProperty(document, 'execCommand', original)
    }
  }
})

test('paste() with non-empty clipboard calls terminal.paste(text)', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')

  const clipboard = installClipboardMock({
    readText: () => Promise.resolve('hello'),
  })

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )

    await result.current.paste()

    expect(pasteSpy).toHaveBeenCalledWith('hello')
  } finally {
    clipboard.restore()
  }
})

test('paste() with empty clipboard is a silent no-op', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()

  const clipboard = installClipboardMock({
    readText: () => Promise.resolve(''),
  })

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('paste() when navigator.clipboard.readText is undefined calls onPasteError', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()
  const original = window.navigator.clipboard

  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: (): Promise<void> => Promise.resolve() },
    configurable: true,
    writable: true,
  })

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).toHaveBeenCalledOnce()
    expect(onPasteError.mock.calls[0][0]).toBeInstanceOf(Error)
  } finally {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: original,
      configurable: true,
      writable: true,
    })
  }
})

test('paste() when readText() rejects calls onPasteError with the rejection', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')
  const onPasteError = vi.fn()

  const clipboard = installClipboardMock({
    readText: () => Promise.reject(new Error('readText denied')),
  })

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        onPasteError,
      })
    )

    await result.current.paste()

    expect(pasteSpy).not.toHaveBeenCalled()
    expect(onPasteError).toHaveBeenCalledOnce()
    const errorArg = onPasteError.mock.calls[0][0] as Error
    expect(errorArg.message).toBe('readText denied')
  } finally {
    clipboard.restore()
  }
})

test('right-click on terminal.element sets isOpen=true, openAt={x,y}, and calls preventDefault', () => {
  const mock = createMockTerminal()

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 200,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

  act(() => {
    mock.element.dispatchEvent(event)
  })

  expect(result.current.isOpen).toBe(true)
  expect(result.current.openAt).toEqual({ x: 100, y: 200 })
  expect(preventDefaultSpy).toHaveBeenCalledOnce()
})

test('close() resets isOpen and openAt and is idempotent', () => {
  const mock = createMockTerminal()

  const { result } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  act(() => {
    mock.element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 75,
      })
    )
  })
  expect(result.current.isOpen).toBe(true)

  act(() => {
    result.current.close()
  })
  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()

  act(() => {
    result.current.close()
  })
  expect(result.current.isOpen).toBe(false)
})

test('drag -> mouseup with selection auto-copies via writeText', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))

    mock.element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 })
    )

    act(() => {
      mock.fireSelectionChange(true)
    })

    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    await flushMicrotasks()

    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('selectAll() then mouseup without mousedown does not auto-copy', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    const { result } = renderHook(() =>
      useTerminalClipboard({ terminal: mock.terminal })
    )

    act(() => {
      result.current.selectAll()
      mock.fireSelectionChange(true)
    })

    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    await flushMicrotasks()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('mousedown with right button does not start a drag', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))

    mock.element.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 2 })
    )

    act(() => {
      mock.fireSelectionChange(true)
    })

    mock.element.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    await flushMicrotasks()

    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('keyup events pass through', () => {
  const mock = createMockTerminal()
  renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))
  const handler = captureKeyHandler(mock)

  expect(
    handler(
      keyboardEvent({
        type: 'keyup',
        code: 'KeyC',
        ctrlKey: true,
        shiftKey: true,
      })
    )
  ).toBe(true)
})

test('preferModifier="ctrl" + Ctrl+Shift+C with selection suppresses and copies', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )

    act(() => {
      mock.fireSelectionChange(true)
    })
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyC', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(clipboard.writeTextMock).toHaveBeenCalledWith('EVERYTHING')
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="ctrl" + Ctrl+Shift+C without selection suppresses with no copy', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyC', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(clipboard.writeTextMock).not.toHaveBeenCalled()
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="ctrl" + Ctrl+C with selection passes through', () => {
  const mock = createMockTerminal()
  renderHook(() =>
    useTerminalClipboard({
      terminal: mock.terminal,
      preferModifier: 'ctrl',
    })
  )

  act(() => {
    mock.fireSelectionChange(true)
  })
  const handler = captureKeyHandler(mock)

  expect(handler(keyboardEvent({ code: 'KeyC', ctrlKey: true }))).toBe(true)
})

test('preferModifier="meta" + Cmd+C with selection suppresses and copies', async () => {
  const mock = createMockTerminal()
  const clipboard = installClipboardMock()

  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'meta',
      })
    )

    act(() => {
      mock.fireSelectionChange(true)
    })
    const handler = captureKeyHandler(mock)

    const result = handler(keyboardEvent({ code: 'KeyC', metaKey: true }))
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(clipboard.writeTextMock).toHaveBeenCalledOnce()
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="meta" + Cmd+C without selection passes through', () => {
  const mock = createMockTerminal()
  renderHook(() =>
    useTerminalClipboard({
      terminal: mock.terminal,
      preferModifier: 'meta',
    })
  )
  const handler = captureKeyHandler(mock)

  expect(handler(keyboardEvent({ code: 'KeyC', metaKey: true }))).toBe(true)
})

test('preferModifier="ctrl" + Ctrl+Shift+V suppresses and pastes', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')

  const clipboard = installClipboardMock({
    readText: () => Promise.resolve('pasted'),
  })

  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'ctrl',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyV', ctrlKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(pasteSpy).toHaveBeenCalledWith('pasted')
  } finally {
    clipboard.restore()
  }
})

test('preferModifier="meta" + Cmd+Shift+V suppresses and pastes', async () => {
  const mock = createMockTerminal()
  const pasteSpy = vi.spyOn(mock.terminal, 'paste')

  const clipboard = installClipboardMock({
    readText: () => Promise.resolve('pasted'),
  })

  try {
    renderHook(() =>
      useTerminalClipboard({
        terminal: mock.terminal,
        preferModifier: 'meta',
      })
    )
    const handler = captureKeyHandler(mock)

    const result = handler(
      keyboardEvent({ code: 'KeyV', metaKey: true, shiftKey: true })
    )
    await flushMicrotasks()

    expect(result).toBe(false)
    expect(pasteSpy).toHaveBeenCalledWith('pasted')
  } finally {
    clipboard.restore()
  }
})

test('unrelated key passes through unchanged', () => {
  const mock = createMockTerminal()
  renderHook(() => useTerminalClipboard({ terminal: mock.terminal }))
  const handler = captureKeyHandler(mock)

  expect(handler(keyboardEvent({ code: 'KeyA', ctrlKey: true }))).toBe(true)
  expect(handler(keyboardEvent({ code: 'KeyA' }))).toBe(true)
})

test('re-render with new onCopyError reference does not re-attach handlers', () => {
  const mock = createMockTerminal()

  const attachSpy = mock.terminal
    .attachKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { rerender } = renderHook(
    ({ onCopyError }: { onCopyError: () => void }) =>
      useTerminalClipboard({ terminal: mock.terminal, onCopyError }),
    { initialProps: { onCopyError: (): void => undefined } }
  )
  const callsBefore = attachSpy.mock.calls.length

  rerender({ onCopyError: (): void => undefined })

  expect(attachSpy.mock.calls.length).toBe(callsBefore)
})

test('unmount disposes onSelectionChange, restores default key handler, and removes DOM listeners', () => {
  const mock = createMockTerminal()

  const attachSpy = mock.terminal
    .attachKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { result, unmount } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )

  expect(attachSpy).toHaveBeenCalledTimes(1)

  unmount()

  expect(attachSpy).toHaveBeenCalledTimes(2)
  const restoreHandler = attachSpy.mock.calls[1][0] as AttachedHandler
  expect(restoreHandler(new KeyboardEvent('keydown', { code: 'KeyC' }))).toBe(
    true
  )

  mock.element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 1,
      clientY: 1,
    })
  )
  expect(result.current.isOpen).toBe(false)
})

test('unmount tolerates a terminal whose key event handler registration throws', () => {
  const mock = createMockTerminal()

  const attachSpy = mock.terminal
    .attachKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { unmount } = renderHook(() =>
    useTerminalClipboard({ terminal: mock.terminal })
  )
  attachSpy.mockImplementationOnce(() => {
    throw new Error('terminal disposed')
  })

  expect(() => {
    unmount()
  }).not.toThrow()
})

test('changing terminal identity cleans up old terminal and attaches to new one', () => {
  const first = createMockTerminal()
  const second = createMockTerminal()

  const firstAttach = first.terminal
    .attachKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const secondAttach = second.terminal
    .attachKeyEventHandler as unknown as ReturnType<typeof vi.fn>

  const { rerender } = renderHook(
    ({ terminal }: { terminal: TerminalSurface }) =>
      useTerminalClipboard({ terminal }),
    { initialProps: { terminal: first.terminal } }
  )

  expect(firstAttach).toHaveBeenCalledTimes(1)
  expect(secondAttach).toHaveBeenCalledTimes(0)

  rerender({ terminal: second.terminal })

  expect(firstAttach).toHaveBeenCalledTimes(2)
  expect(secondAttach).toHaveBeenCalledTimes(1)
})

test('terminal === null after non-null resets isOpen/openAt/hasSelection', () => {
  const mock = createMockTerminal()

  const { result, rerender } = renderHook(
    ({ terminal }: { terminal: TerminalSurface | null }) =>
      useTerminalClipboard({ terminal }),
    { initialProps: { terminal: mock.terminal as TerminalSurface | null } }
  )

  act(() => {
    mock.element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      })
    )
    mock.fireSelectionChange(true)
  })
  expect(result.current.isOpen).toBe(true)
  expect(result.current.hasSelection).toBe(true)

  rerender({ terminal: null })

  expect(result.current.isOpen).toBe(false)
  expect(result.current.openAt).toBeNull()
  expect(result.current.hasSelection).toBe(false)
})
