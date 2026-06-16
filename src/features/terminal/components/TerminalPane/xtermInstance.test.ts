import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { obsidianLens } from '../../../../theme'
import { TERMINAL_FONT_FAMILY } from './terminalFont'
import { createXtermTerminal, xtermTerminalRenderer } from './xtermInstance'

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(),
}))

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: vi.fn(),
}))

interface RawTerminalMock {
  cols: number
  rows: number
  element: HTMLElement
  options: { theme?: Record<string, string> }
  buffer: {
    active: {
      viewportY: number
      getLine: (index: number) => RawBufferLine | undefined
    }
  }
  loadAddon: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  onResize: ReturnType<typeof vi.fn>
  parser: {
    registerOscHandler: ReturnType<typeof vi.fn>
  }
  hasSelection: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  paste: ReturnType<typeof vi.fn>
  selectAll: ReturnType<typeof vi.fn>
  onSelectionChange: ReturnType<typeof vi.fn>
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
}

interface RawBufferLine {
  translateToString: (trimRight: boolean) => string
}

const createRawTerminal = (): RawTerminalMock => {
  const element = document.createElement('div')

  const bufferRows = new Map([
    [1, 'visible one  '],
    [2, 'visible two'],
    [3, 'outside viewport'],
  ])

  return {
    cols: 80,
    rows: 2,
    element,
    options: {},
    buffer: {
      active: {
        viewportY: 1,
        getLine: (index: number): RawBufferLine | undefined => {
          const text = bufferRows.get(index)
          if (text === undefined) {
            return undefined
          }

          return {
            translateToString: (trimRight: boolean): string =>
              trimRight ? text.replace(/\s+$/, '') : text,
          }
        },
      },
    },
    loadAddon: vi.fn(),
    open: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    refresh: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    parser: {
      registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
    },
    hasSelection: vi.fn(() => true),
    getSelection: vi.fn(() => 'selected'),
    paste: vi.fn(),
    selectAll: vi.fn(),
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
    attachCustomKeyEventHandler: vi.fn(),
  }
}

describe('xtermInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('exports the default xterm renderer adapter', () => {
    expect(xtermTerminalRenderer.id).toBe('xterm')
    expect(xtermTerminalRenderer.createInstance).toBe(createXtermTerminal)
  })

  test('creates a themed terminal surface with a loaded fit addon', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }
    const container = document.createElement('div')

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)

    const created = createXtermTerminal()

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 14,
        scrollback: 10000,
        theme: expect.objectContaining({
          background: obsidianLens.terminal.background,
          cursor: obsidianLens.terminal.cursor,
          foreground: obsidianLens.terminal.foreground,
        }),
      })
    )
    expect(FitAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenCalledWith(fitAddon)
    expect(created.fitController).toBe(fitAddon)
    expect(created.terminal.cols).toBe(80)
    expect(created.terminal.rows).toBe(2)
    expect(created.terminal.element).toBe(terminal.element)
    expect(created.viewportReader.readVisibleText()).toBe(
      'visible one\nvisible two'
    )

    created.parser.registerOscHandler(7, () => true)

    created.terminal.open(container)
    created.terminal.applyTheme(obsidianLens.terminal)

    expect(terminal.parser.registerOscHandler).toHaveBeenCalledWith(
      7,
      expect.any(Function)
    )
    expect(terminal.open).toHaveBeenCalledWith(container)
    expect(terminal.options.theme).toEqual(
      expect.objectContaining({
        background: obsidianLens.terminal.background,
        foreground: obsidianLens.terminal.foreground,
      })
    )
  })

  test('uses WebGL renderer when it is available', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }

    const webglAddon = {
      dispose: vi.fn(),
      onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
    }

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => webglAddon as never)

    const renderer = createXtermTerminal().attachRenderer()

    expect(WebglAddon).toHaveBeenCalledTimes(1)
    expect(CanvasAddon).not.toHaveBeenCalled()
    expect(terminal.loadAddon).toHaveBeenCalledWith(webglAddon)

    renderer.dispose()

    expect(webglAddon.dispose).toHaveBeenCalledTimes(1)
  })

  test('falls back to Canvas renderer when WebGL construction fails', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }
    const canvasAddon = { dispose: vi.fn() }

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => {
      throw new Error('no webgl')
    })
    vi.mocked(CanvasAddon).mockImplementation(() => canvasAddon as never)

    const renderer = createXtermTerminal().attachRenderer()

    expect(WebglAddon).toHaveBeenCalledTimes(1)
    expect(CanvasAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenCalledWith(canvasAddon)

    renderer.dispose()

    expect(canvasAddon.dispose).toHaveBeenCalledTimes(1)
  })

  test('keeps DOM renderer when WebGL and Canvas construction fail', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => {
      throw new Error('no webgl')
    })

    vi.mocked(CanvasAddon).mockImplementation(() => {
      throw new Error('no canvas')
    })

    const renderer = createXtermTerminal().attachRenderer()

    expect(WebglAddon).toHaveBeenCalledTimes(1)
    expect(CanvasAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenCalledWith(fitAddon)

    expect(() => renderer.dispose()).not.toThrow()
  })

  test('falls back to Canvas renderer on WebGL context loss', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }
    const contextLossDisposable = { dispose: vi.fn() }
    let onContextLoss = (): void => {
      throw new Error('context loss handler was not registered')
    }

    const webglAddon = {
      dispose: vi.fn(),
      onContextLoss: vi.fn((callback: () => void) => {
        onContextLoss = callback

        return contextLossDisposable
      }),
    }
    const canvasAddon = { dispose: vi.fn() }

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => webglAddon as never)
    vi.mocked(CanvasAddon).mockImplementation(() => canvasAddon as never)

    const renderer = createXtermTerminal().attachRenderer()

    onContextLoss()

    expect(webglAddon.dispose).toHaveBeenCalledTimes(1)
    expect(CanvasAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenLastCalledWith(canvasAddon)

    renderer.dispose()

    expect(contextLossDisposable.dispose).not.toHaveBeenCalled()
    expect(canvasAddon.dispose).toHaveBeenCalledTimes(1)
  })

  test('keeps DOM renderer when Canvas fails after WebGL context loss', () => {
    const terminal = createRawTerminal()
    const fitAddon = { fit: vi.fn() }
    let onContextLoss = (): void => {
      throw new Error('context loss handler was not registered')
    }

    const webglAddon = {
      dispose: vi.fn(),
      onContextLoss: vi.fn((callback: () => void) => {
        onContextLoss = callback

        return { dispose: vi.fn() }
      }),
    }

    vi.mocked(Terminal).mockImplementation(() => terminal as never)
    vi.mocked(FitAddon).mockImplementation(() => fitAddon as never)
    vi.mocked(WebglAddon).mockImplementation(() => webglAddon as never)
    vi.mocked(CanvasAddon).mockImplementation(() => {
      throw new Error('no canvas')
    })

    createXtermTerminal().attachRenderer()

    expect(() => onContextLoss()).not.toThrow()
    expect(webglAddon.dispose).toHaveBeenCalledTimes(1)
    expect(CanvasAddon).toHaveBeenCalledTimes(1)
    expect(terminal.loadAddon).toHaveBeenCalledTimes(2)
    expect(terminal.loadAddon).toHaveBeenNthCalledWith(1, fitAddon)
    expect(terminal.loadAddon).toHaveBeenNthCalledWith(2, webglAddon)
  })
})
