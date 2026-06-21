// cspell:ignore ghostty xhigh
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  TerminalDisposable,
  TerminalOutputChunk,
  TerminalParser,
} from '../../types'
import type {
  TerminalParserEngine,
  TerminalParserEngineInput,
  TerminalParserEngineOutput,
} from './terminalParserEngine'
import {
  GHOSTTY_TERMINAL_RENDERER_ID,
  createGhosttyTerminalRenderer,
  createGhosttyTerminal,
  ghosttyTerminalRenderer,
  type GhosttyTerminalOptions,
} from './ghosttyInstance'
import type { GhosttyVtRenderStateDriver } from './ghosttyVtRenderStateDriver'
import { createGhosttyVtRenderSnapshotOutput } from './ghosttyVtRenderSnapshot'
import { GHOSTTY_TERMINAL_CAPABILITIES } from './terminalRendererCapabilities'

const setElementSize = (
  element: HTMLElement,
  width: number,
  height: number
): void => {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    value: width,
  })

  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    value: height,
  })
}

const setScrollMetrics = (
  element: HTMLElement,
  clientHeight: number,
  scrollHeight: number
): void => {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  })

  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  })
}

const createRect = (top: number, bottom: number): DOMRect =>
  ({
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    toJSON: (): Record<string, number> => ({}),
    top,
    width: 0,
    x: 0,
    y: top,
  }) as DOMRect

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return globalThis.btoa(binary)
}

const encodeText = (text: string): string =>
  encodeBase64(new TextEncoder().encode(text))

const ESC = '\x1b'
const SGR_FINAL = 'm'
const TRUE_COLOR_PINK_HEX = ['#', 'f38ba8'].join('')
const TRUE_COLOR_BASE_HEX = ['#', '181825'].join('')
const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')
const TRUE_COLOR_BASE = ['rgb', '(24, 24, 37)'].join('')
const NERD_FONT_TERMINAL_ICON = '\uf120'

const createdTerminals = new Set<ReturnType<typeof createGhosttyTerminal>>()

const createTrackedGhosttyTerminal = (
  options: GhosttyTerminalOptions = {}
): ReturnType<typeof createGhosttyTerminal> => {
  const created = createGhosttyTerminal(options)
  createdTerminals.add(created)

  return created
}

afterEach(() => {
  createdTerminals.forEach((created) => {
    created.terminal.dispose()
  })
  createdTerminals.clear()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('ghosttyInstance', () => {
  test('exposes the opt-in ghostty renderer adapter', () => {
    expect(ghosttyTerminalRenderer.id).toBe(GHOSTTY_TERMINAL_RENDERER_ID)
    expect(ghosttyTerminalRenderer.capabilities).toEqual({
      preferredOutputInputMode: 'bytes',
      acceptsText: true,
      acceptsBytes: true,
    })

    expect(ghosttyTerminalRenderer.capabilities).toBe(
      GHOSTTY_TERMINAL_CAPABILITIES
    )
    expect(ghosttyTerminalRenderer.createInstance).toBe(createGhosttyTerminal)
  })

  test('creates configured renderer instances with a VT render-state driver option', () => {
    const writeBytes = vi.fn()

    const renderer = createGhosttyTerminalRenderer({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot: () => ({
          rows: ['factory vt screen'],
          cursor: {
            rowIndex: 0,
            columnOffset: 7,
          },
        }),
      }),
    })

    const created = renderer.createInstance()
    createdTerminals.add(created)

    const bytes = new Uint8Array([0x76, 0x74])

    created.output.writeOutput({
      text: 'lossy fallback',
      bytesBase64: encodeBase64(bytes),
      offsetStart: 11,
      byteLen: bytes.length,
      phase: 'live',
    })

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(renderer.id).toBe(GHOSTTY_TERMINAL_RENDERER_ID)
    expect(renderer.capabilities).toBe(GHOSTTY_TERMINAL_CAPABILITIES)
    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(created.viewportReader.readVisibleText()).toBe('factory vt screen')
    expect(cursor?.previousSibling?.textContent).toBe('factory')
  })

  test('delegates output parsing through an injected parser engine', () => {
    const parser: TerminalParser = {
      onEvent: (handler): TerminalDisposable => {
        void handler

        return { dispose: vi.fn() }
      },
    }

    const parseOutput = vi.fn(
      (chunk: TerminalOutputChunk): TerminalParserEngineOutput => ({
        visibleText: `parsed:${chunk.text}`,
      })
    )

    const createParserEngine = vi.fn(() => ({
      inputMode: 'bytes' as const,
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text: string): TerminalParserEngineOutput => ({
        visibleText: `parsed:${text}`,
      }),
      parseInput: (
        input: TerminalParserEngineInput
      ): TerminalParserEngineOutput => ({
        visibleText: `parsed:${input.text}`,
      }),
      parseOutput,
    }))

    const created = createTrackedGhosttyTerminal({
      createParserEngine,
    })

    const chunk = {
      text: 'from-engine',
      offsetStart: 3,
      byteLen: 11,
      phase: 'live' as const,
    }

    created.output.writeOutput(chunk)

    expect(created.parser).toBe(parser)
    expect(createParserEngine).toHaveBeenCalledOnce()
    expect(parseOutput).toHaveBeenCalledWith(chunk)
    expect(created.viewportReader.readVisibleText()).toBe('parsed:from-engine')
  })

  test('wires a VT render-state driver option through the Ghostty byte parser path', () => {
    const writeBytes = vi.fn()

    const readSnapshot = vi.fn(() => ({
      rows: ['vt prompt', 'rendered output'],
      cursor: {
        rowIndex: 1,
        columnOffset: 8,
      },
    }))

    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes,
        readSnapshot,
      }),
    })

    const bytes = new Uint8Array([0xff, 0xfe])

    created.output.writeOutput({
      text: 'lossy fallback',
      bytesBase64: encodeBase64(bytes),
      offsetStart: 17,
      byteLen: bytes.length,
      phase: 'live',
    })

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(created.viewportReader.readVisibleText()).toBe(
      'vt prompt\nrendered output'
    )
    expect(cursor?.parentElement?.textContent).toBe('rendered output')
    expect(cursor?.previousSibling?.textContent).toBe('rendered')
  })

  test('syncs terminal size and clear resets into the VT render-state driver', () => {
    const reset = vi.fn()
    const resize = vi.fn()
    const container = document.createElement('div')

    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: [],
        }),
        reset,
        resize,
      }),
    })

    expect(resize).toHaveBeenCalledWith({ cols: 80, rows: 24 })

    setElementSize(container, 256, 180)
    created.terminal.open(container)

    expect(resize).toHaveBeenLastCalledWith({ cols: 30, rows: 9 })
    expect(resize).toHaveBeenCalledTimes(2)

    created.fitController.fit()

    expect(resize).toHaveBeenCalledTimes(2)

    setElementSize(container, 336, 216)
    created.fitController.fit()

    expect(resize).toHaveBeenLastCalledWith({ cols: 40, rows: 11 })
    expect(resize).toHaveBeenCalledTimes(3)

    created.terminal.clear()

    expect(reset).toHaveBeenCalledOnce()
    expect(resize).toHaveBeenLastCalledWith({ cols: 40, rows: 11 })
    expect(resize).toHaveBeenCalledTimes(4)
  })

  test('syncs fitted PTY rows into the rendered viewport geometry', () => {
    const container = document.createElement('div')
    const created = createTrackedGhosttyTerminal()

    setElementSize(container, 256, 180)
    created.terminal.open(container)

    const element = created.terminal.element
    const output = element?.querySelector<HTMLElement>('pre')

    expect(created.terminal.cols).toBe(30)
    expect(created.terminal.rows).toBe(9)
    expect(element?.dataset.terminalCols).toBe('30')
    expect(element?.dataset.terminalRows).toBe('9')
    expect(
      element?.style.getPropertyValue('--terminal-pty-viewport-height')
    ).toBe('178px')

    expect(output?.style.minHeight).toBe(
      'max(100%, var(--terminal-pty-viewport-height))'
    )
  })

  test('keeps VT render-state driver cwd effects on the terminal parser event path', () => {
    const bytes = new Uint8Array([0x1b, 0x5d, 0x37])
    const writeBytes = vi.fn()
    const handler = vi.fn()

    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (effects): GhosttyVtRenderStateDriver => ({
        writeBytes: (incomingBytes): void => {
          writeBytes(incomingBytes)
          effects.onCwdChange('file://localhost/tmp/vt-option-cwd')
        },
        readSnapshot: () => ({
          rows: ['cwd-aware vt screen'],
        }),
      }),
    })

    created.parser.onEvent(handler)
    created.output.writeOutput({
      text: 'lossy fallback',
      bytesBase64: encodeBase64(bytes),
      offsetStart: 29,
      byteLen: bytes.length,
      phase: 'restore',
    })

    expect(writeBytes).toHaveBeenCalledWith(bytes)
    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/vt-option-cwd',
      output: {
        offsetStart: 29,
        byteLen: bytes.length,
        phase: 'restore',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('cwd-aware vt screen')
  })

  test('renders direct terminal status writes when the VT render-state driver is byte-only', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({ rows: ['vt prompt'] }),
      }),
    })

    created.terminal.write('process exited with code 0')

    expect(created.viewportReader.readVisibleText()).toBe(
      'process exited with code 0'
    )
  })

  test('prefers an injected parser engine over a VT render-state driver option', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const createVtRenderStateDriver = vi.fn(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({ rows: ['from-vt'] }),
      })
    )

    const createParserEngine = vi.fn(
      (): TerminalParserEngine => ({
        inputMode: 'bytes',
        capabilities: ghosttyTerminalRenderer.capabilities,
        parser,
        parseText: (text): TerminalParserEngineOutput => ({
          visibleText: text,
        }),
        parseInput: (input): TerminalParserEngineOutput => ({
          visibleText: input.text,
        }),
        parseOutput: (): TerminalParserEngineOutput => ({
          visibleText: 'from-parser-engine',
        }),
      })
    )

    const created = createTrackedGhosttyTerminal({
      createParserEngine,
      createVtRenderStateDriver,
    })

    created.output.writeOutput({
      text: 'input',
      offsetStart: 0,
      byteLen: 5,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('from-parser-engine')
    expect(createParserEngine).toHaveBeenCalledOnce()
    expect(createVtRenderStateDriver).not.toHaveBeenCalled()
  })

  test('applies parser display replace deltas without appending snapshots', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parseOutput = vi
      .fn<(chunk: TerminalOutputChunk) => TerminalParserEngineOutput>()
      .mockReturnValueOnce({
        visibleText: 'screen snapshot one',
        displayDelta: {
          operations: [
            {
              type: 'replace',
              text: 'screen snapshot one',
            },
          ],
        },
      })
      .mockReturnValueOnce({
        visibleText: 'screen snapshot two',
        displayDelta: {
          operations: [
            {
              type: 'replace',
              text: 'screen snapshot two',
            },
          ],
        },
      })

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput,
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    created.output.writeOutput({
      text: 'first',
      offsetStart: 0,
      byteLen: 5,
      phase: 'live',
    })

    created.output.writeOutput({
      text: 'second',
      offsetStart: 5,
      byteLen: 6,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('screen snapshot two')
  })

  test('keeps parser display replace snapshots pinned to the viewport top', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['prompt', 'output', '', '', '', ''],
          cursor: {
            rowIndex: 0,
            columnOffset: 6,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    const element = created.terminal.element

    if (!element) {
      throw new Error('Expected terminal element')
    }

    setScrollMetrics(element, 54, 640)
    element.scrollTop = 128

    created.output.writeOutput({
      text: 'snapshot',
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    expect(element.scrollTop).toBe(0)
  })

  test('keeps parser display replace snapshots pinned when the cursor is below the pane', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['prompt', '', '', '', '', '', 'ready'],
          cursor: {
            rowIndex: 6,
            columnOffset: 5,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    const element = created.terminal.element

    if (!element) {
      throw new Error('Expected terminal element')
    }

    setScrollMetrics(element, 54, 640)
    element.scrollTop = 0

    created.output.writeOutput({
      text: 'snapshot',
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    expect(element.scrollTop).toBe(0)
  })

  test('keeps visible shell snapshot cursors in view', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['line 1', 'line 2', '$ ready', '', '', ''],
          cursor: {
            rowIndex: 2,
            columnOffset: 7,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    const element = created.terminal.element

    if (!element) {
      throw new Error('Expected terminal element')
    }

    setScrollMetrics(element, 54, 640)
    element.scrollTop = 0

    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.dataset.terminalCursorMarker === 'true') {
          return createRect(90, 108)
        }

        if (this.dataset.terminalRenderer === GHOSTTY_TERMINAL_RENDERER_ID) {
          return createRect(0, 54)
        }

        return createRect(0, 0)
      })

    try {
      created.output.writeOutput({
        text: 'snapshot',
        offsetStart: 0,
        byteLen: 8,
        phase: 'live',
      })
    } finally {
      getBoundingClientRectSpy.mockRestore()
    }

    expect(element.scrollTop).toBeGreaterThan(0)
  })

  test('does not outer-scroll agent TUI snapshots by rendered cursor bounds', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['prompt', '', '', '', 'ready'],
          cursor: {
            rowIndex: 4,
            columnOffset: 5,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    const element = created.terminal.element

    if (!element) {
      throw new Error('Expected terminal element')
    }

    setScrollMetrics(element, 54, 640)
    element.scrollTop = 0

    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.dataset.terminalCursorMarker === 'true') {
          return createRect(90, 108)
        }

        if (this.dataset.terminalRenderer === GHOSTTY_TERMINAL_RENDERER_ID) {
          return createRect(0, 54)
        }

        return createRect(0, 0)
      })

    try {
      created.output.writeOutput({
        text: 'snapshot',
        offsetStart: 0,
        byteLen: 8,
        phase: 'live',
      })
    } finally {
      getBoundingClientRectSpy.mockRestore()
    }

    expect(element.scrollTop).toBe(0)
  })

  test('renders the cursor from parser display snapshot coordinates', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['prompt', 'output'],
          cursor: {
            rowIndex: 1,
            columnOffset: 2,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    created.output.writeOutput({
      text: 'snapshot',
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(created.viewportReader.readVisibleText()).toBe('prompt\noutput')
    expect(cursor?.parentElement?.textContent).toBe('output')
    expect(cursor?.previousSibling?.textContent).toBe('ou')
    expect(cursor?.nextSibling?.textContent).toBe('tput')
  })

  test('hides the visual cursor when parser snapshots mark it hidden', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['Manual', '> Auto'],
          cursor: {
            rowIndex: 1,
            columnOffset: 0,
            visible: false,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    created.output.writeOutput({
      text: 'snapshot',
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(created.viewportReader.readVisibleText()).toBe('Manual\n> Auto')
    expect(cursor).toBeNull()
  })

  test('copies interpreted text for full replace snapshot selections', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (): TerminalParserEngineOutput =>
        createGhosttyVtRenderSnapshotOutput({
          rows: ['prompt', '', ''],
          cursor: {
            rowIndex: 0,
            columnOffset: 6,
          },
        }),
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })
    const container = document.createElement('div')

    document.body.append(container)
    created.terminal.open(container)
    created.output.writeOutput({
      text: 'snapshot',
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    created.terminal.selectAll()

    expect(created.viewportReader.readVisibleText()).toBe('prompt')
    expect(created.terminal.hasSelection()).toBe(true)
    expect(created.terminal.getSelection()).toBe('prompt')
  })

  test('disposes the parser engine once through terminal disposal', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const dispose = vi.fn()

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (chunk): TerminalParserEngineOutput => ({
        visibleText: chunk.text,
      }),
      dispose,
    }

    const created = createGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    created.terminal.dispose()
    created.terminal.dispose()

    expect(dispose).toHaveBeenCalledOnce()
  })

  test('does not dispose the parser engine when the renderer handle is disposed', () => {
    const parser: TerminalParser = {
      onEvent: (): TerminalDisposable => ({ dispose: vi.fn() }),
    }

    const dispose = vi.fn()

    const parserEngine: TerminalParserEngine = {
      inputMode: 'bytes',
      capabilities: ghosttyTerminalRenderer.capabilities,
      parser,
      parseText: (text): TerminalParserEngineOutput => ({
        visibleText: text,
      }),
      parseInput: (input): TerminalParserEngineOutput => ({
        visibleText: input.text,
      }),
      parseOutput: (chunk): TerminalParserEngineOutput => ({
        visibleText: chunk.text,
      }),
      dispose,
    }

    const created = createTrackedGhosttyTerminal({
      createParserEngine: () => parserEngine,
    })

    const rendererHandle = created.attachRenderer()

    rendererHandle.dispose()

    expect(dispose).not.toHaveBeenCalled()
  })

  test('routes direct terminal writes through the Ghostty parser', () => {
    const created = createTrackedGhosttyTerminal()
    const handler = vi.fn()

    created.parser.onEvent(handler)
    created.terminal.write(
      'before \x1b]7;file://localhost/tmp/ghostty-direct\x07 after'
    )

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://localhost/tmp/ghostty-direct',
      })
    )
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('prefers byte payloads over lossy text fallback', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('bytes win'),
      offsetStart: 0,
      byteLen: 9,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('bytes win')
  })

  test('strips zsh title and color controls without app parser subscribers', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      `${ESC}]2;user@host:~/project\x07` +
      `${ESC}[38;2;243;139;168${SGR_FINAL}` +
      `feat/ghostty-spike${ESC}[0${SGR_FINAL} % ${ESC}=`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe(
      'feat/ghostty-spike % '
    )
  })

  test('continues stripping controls after renderer handle disposal', () => {
    const created = createTrackedGhosttyTerminal()
    const rendererHandle = created.attachRenderer()

    rendererHandle.dispose()
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(`before ${ESC}[0${SGR_FINAL}after`),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(`before ${ESC}[0${SGR_FINAL}after`)
        .length,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('before after')
  })

  test('applies clear-screen and cursor movement controls from byte payloads', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      `old prompt\nold output` +
      `${ESC}[H${ESC}[2J` +
      `S${ESC}[1DSt${ESC}[2DSta${ESC}[3DStart`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('Start')
  })

  test('rewrites Codex MCP progress output from byte payload row redraws', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      'Starting MCP servers (1/3): codex_apps\nlinear pending' +
      `${ESC}[1A\r${ESC}[2K` +
      'Starting MCP servers (2/3): codex_apps, linear\n' +
      `${ESC}[2K` +
      'linear ready'

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe(
      'Starting MCP servers (2/3): codex_apps, linear\nlinear ready'
    )
    expect(created.viewportReader.readVisibleText()).not.toContain('(1/3)')
    expect(created.viewportReader.readVisibleText()).not.toContain('pending')
  })

  test('keeps previous soft-wrapped input rows when the wrapped byte tail redraws', () => {
    const created = createTrackedGhosttyTerminal()
    const container = document.createElement('div')
    const output = `abcdef\r${ESC}[Kgh`

    setElementSize(container, 56, 180)
    created.terminal.open(container)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    expect(created.terminal.cols).toBe(5)
    expect(created.viewportReader.readVisibleText()).toBe('abcde\ngh')
  })

  test('erases stale rows below the cursor during TUI byte redraws', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      '› Summarize recent commits\n' +
      '› gpt-5.5 xhigh · ~/projects/aws\n' +
      '  gpt-5.5 xhigh · ~/projects/aws' +
      `${ESC}[2;1H${ESC}[J› gpt-5.5 xhigh · ~/projects/aws`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const visibleText = created.viewportReader.readVisibleText()

    expect(visibleText).toBe(
      '› Summarize recent commits\n› gpt-5.5 xhigh · ~/projects/aws'
    )
    expect(visibleText.match(/gpt-5.5 xhigh/g)).toHaveLength(1)
  })

  test('rewrites Codex startup TUI byte output positioned by absolute cursor controls', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      `${ESC}[2J${ESC}[1;1H>_ OpenAI Codex` +
      `${ESC}[1;42H` +
      'model: loading' +
      `${ESC}[2;1H~/projects/aws` +
      `${ESC}[3;1HStarting MCP servers (1/3): codex_apps` +
      `${ESC}[1;42H${ESC}[K` +
      'model: gpt-5.5 default' +
      `${ESC}[3;1H${ESC}[2KStarting MCP servers (2/3): codex_apps, linear`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const visibleText = created.viewportReader.readVisibleText()

    expect(visibleText).toContain('>_ OpenAI Codex')
    expect(visibleText).toContain('model: gpt-5.5 default')
    expect(visibleText).toContain(
      'Starting MCP servers (2/3): codex_apps, linear'
    )
    expect(visibleText).not.toContain('loading')
    expect(visibleText).not.toContain('(1/3)')
    expect(visibleText.match(/Starting MCP servers/g)).toHaveLength(1)
  })

  test('restores the editable cursor after byte-path right-prompt controls', () => {
    const created = createTrackedGhosttyTerminal()
    const output = `❯ ${ESC}7${ESC}[1;12H03:52${ESC}8a\b \b`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const row = created.terminal.element?.querySelector(
      '[data-terminal-row="true"]'
    )
    const cursor = row?.querySelector('[data-terminal-cursor="true"]')

    expect(created.viewportReader.readVisibleText()).toContain('03:52')
    expect(row?.textContent?.startsWith('❯  ')).toBe(true)
    expect(cursor?.previousSibling?.textContent).toBe('❯ ')
  })

  test('keeps the prompt cursor stable after narrow wrapped input deletes', () => {
    const created = createTrackedGhosttyTerminal()
    const dataHandler = vi.fn()
    const container = document.createElement('div')
    const prompt = '04:42 ❯ '
    const typedText = 'hello world '.repeat(2)
    const deleteEcho = '\b \b'.repeat(typedText.length)
    const output = `${prompt}${typedText}${deleteEcho}`

    setElementSize(container, 112, 180)
    created.terminal.open(container)
    created.terminal.onData(dataHandler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )
    const cursorRow = cursor?.parentElement

    const visibleTextBeforeExtraDelete =
      created.viewportReader.readVisibleText()

    expect(created.terminal.cols).toBe(12)
    expect(visibleTextBeforeExtraDelete.split('\n')).toHaveLength(3)
    expect(visibleTextBeforeExtraDelete).not.toContain('hello')
    expect(visibleTextBeforeExtraDelete).not.toContain('world')
    expect(cursorRow?.dataset.terminalRow).toBe('true')
    expect(cursor?.previousSibling?.textContent).toBe(prompt)

    const input = created.terminal.element?.querySelector('textarea')

    input?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(dataHandler).toHaveBeenCalledWith('\x7f')
    expect(created.viewportReader.readVisibleText()).toBe(
      visibleTextBeforeExtraDelete
    )
  })

  test('keeps the prompt cursor stable when the prompt also wraps', () => {
    const created = createTrackedGhosttyTerminal()
    const dataHandler = vi.fn()
    const container = document.createElement('div')
    const prompt = 'prompt row one $ ❯ '
    const typedText = 'wrapped input '.repeat(2)
    const deleteEcho = '\b \b'.repeat(typedText.length)
    const output = `${prompt}${typedText}${deleteEcho}`

    setElementSize(container, 112, 180)
    created.terminal.open(container)
    created.terminal.onData(dataHandler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const rows = Array.from(
      created.terminal.element?.querySelectorAll(
        '[data-terminal-row="true"]'
      ) ?? []
    )

    const cursor = created.terminal.element?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    const visibleTextBeforeExtraDelete =
      created.viewportReader.readVisibleText()

    expect(created.terminal.cols).toBe(12)
    expect(rows[0]?.textContent).toBe(`${prompt.slice(0, 12)}\n`)
    expect(cursor?.parentElement).toBe(rows[1])
    expect(cursor?.previousSibling?.textContent).toBe(prompt.slice(12))
    expect(visibleTextBeforeExtraDelete).not.toContain(typedText)

    const input = created.terminal.element?.querySelector('textarea')

    input?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(dataHandler).toHaveBeenCalledWith('\x7f')
    expect(created.viewportReader.readVisibleText()).toBe(
      visibleTextBeforeExtraDelete
    )
    expect(cursor?.parentElement).toBe(rows[1])
    expect(cursor?.previousSibling?.textContent).toBe(prompt.slice(12))
  })

  test('renders a visual cursor from the Ghostty byte parser state', () => {
    const created = createTrackedGhosttyTerminal()
    const output = `abc${ESC}[2D`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const cursor = terminalOutput?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(terminalOutput?.textContent).toBe('abc')
    expect(created.viewportReader.readVisibleText()).toBe('abc')
    expect(cursor?.previousSibling?.textContent).toBe('a')
    expect(cursor?.nextSibling?.textContent).toBe('bc')
  })

  test('renders SGR true-color styles from Ghostty byte payloads', () => {
    const created = createTrackedGhosttyTerminal()

    const output =
      `prompt ${ESC}[38;2;243;139;168${SGR_FINAL}` +
      `branch${ESC}[0${SGR_FINAL} done`

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(output),
      offsetStart: 0,
      byteLen: new TextEncoder().encode(output).length,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const styleRun = terminalOutput?.querySelector(
      '[data-terminal-style-run="true"]'
    )

    expect(terminalOutput?.textContent).toBe('prompt branch done')
    expect(created.viewportReader.readVisibleText()).toBe('prompt branch done')
    expect(styleRun?.textContent).toBe('branch')
    expect((styleRun as HTMLElement | null)?.style.color).toBe(TRUE_COLOR_PINK)
  })

  test('renders native styled empty cells as visible background spans', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['A B'],
          cursor: {
            rowIndex: 0,
            columnOffset: 3,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: 'A',
              width: 1,
            },
            {
              row: 0,
              col: 1,
              text: '',
              width: 1,
              background: TRUE_COLOR_BASE_HEX,
            },
            {
              row: 0,
              col: 2,
              text: 'B',
              width: 1,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const styleRuns = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-style-run="true"]'
      ) ?? []
    )
    const blankRun = styleRuns.find((run) => run.textContent === ' ')

    expect(terminalOutput?.textContent).toBe('A B')
    expect(created.viewportReader.readVisibleText()).toBe('A B')
    expect(blankRun?.style.backgroundColor).toBe(TRUE_COLOR_BASE)
    expect(blankRun?.style.display).toBe('inline-block')
    expect(blankRun?.style.height).toBe('var(--terminal-line-height)')
    expect(blankRun?.style.minWidth).toBe(
      'calc(var(--terminal-cell-width) * 1)'
    )
    expect(blankRun?.style.overflow).toBe('visible')
  })

  test('paints background-only agent input boxes by terminal cell width', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['> Explain this codebase   '],
          cursor: {
            rowIndex: 0,
            columnOffset: 2,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '>',
              width: 1,
            },
            {
              row: 0,
              col: 1,
              text: ' Explain this codebase   ',
              width: 25,
              background: TRUE_COLOR_BASE_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const inputRuns = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-style-run="true"]'
      ) ?? []
    )

    const backgroundRuns = inputRuns.filter(
      (run) => run.style.backgroundColor === TRUE_COLOR_BASE
    )

    expect(terminalOutput?.textContent).toBe('> Explain this codebase   ')
    expect(created.viewportReader.readVisibleText()).toBe(
      '> Explain this codebase   '
    )

    expect(backgroundRuns.map((run) => run.style.minWidth)).toEqual([
      'calc(var(--terminal-cell-width) * 1)',
      'calc(var(--terminal-cell-width) * 24)',
    ])
  })

  test('paints reverse-video agent input boxes by terminal cell width', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['> Explain this codebase   '],
          cursor: {
            rowIndex: 0,
            columnOffset: 2,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '>',
              width: 1,
            },
            {
              row: 0,
              col: 1,
              text: ' Explain this codebase   ',
              width: 25,
              reverse: true,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const inputRuns = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-style-run="true"]'
      ) ?? []
    )

    const reverseRuns = inputRuns.filter(
      (run) =>
        run.style.backgroundColor === 'var(--terminal-foreground)' &&
        run.style.color === 'var(--terminal-background)'
    )

    expect(terminalOutput?.textContent).toBe('> Explain this codebase   ')
    expect(created.viewportReader.readVisibleText()).toBe(
      '> Explain this codebase   '
    )

    expect(reverseRuns.map((run) => run.style.minWidth)).toEqual([
      'calc(var(--terminal-cell-width) * 1)',
      'calc(var(--terminal-cell-width) * 24)',
    ])
  })

  test('hides native dead cursor parked above an agent prompt row', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['', '>'],
          cursor: {
            rowIndex: 0,
            columnOffset: 0,
          },
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const cursor = terminalOutput?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(terminalOutput?.textContent).toBe('\n>')
    expect(created.viewportReader.readVisibleText()).toBe('\n>')
    expect(cursor).toBeNull()
  })

  test('paints block glyphs as terminal-cell rectangles', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['██'],
          cursor: {
            rowIndex: 0,
            columnOffset: 2,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '██',
              width: 2,
              foreground: TRUE_COLOR_PINK_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyphs = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-custom-glyph="block"]'
      ) ?? []
    )

    expect(terminalOutput?.textContent).toBe('██')
    expect(created.viewportReader.readVisibleText()).toBe('██')
    expect(glyphs).toHaveLength(2)
    expect(glyphs[0]?.style.backgroundColor).toBe('transparent')
    expect(glyphs[0]?.style.color).toBe('transparent')
    expect(glyphs[0]?.style.fontSize).toBe('0px')
    expect(glyphs[0]?.style.width).toBe('var(--terminal-cell-width)')
    expect(glyphs[0]?.style.minWidth).toBe('var(--terminal-cell-width)')

    const firstRect = glyphs[0]?.querySelector<HTMLElement>(
      '[data-terminal-custom-glyph-rect="true"]'
    )

    expect(firstRect?.style.backgroundColor).toBe(TRUE_COLOR_PINK)
    expect(firstRect?.style.height).toBe('100%')
    expect(firstRect?.style.left).toBe('0%')
    expect(firstRect?.style.top).toBe('0%')
    expect(firstRect?.style.width).toBe('100%')
  })

  test('paints unstyled block glyphs with the terminal foreground', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['█'],
          cursor: {
            rowIndex: 0,
            columnOffset: 1,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '█',
              width: 1,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyph = terminalOutput?.querySelector<HTMLElement>(
      '[data-terminal-custom-glyph="block"]'
    )

    const rect = glyph?.querySelector<HTMLElement>(
      '[data-terminal-custom-glyph-rect="true"]'
    )

    expect(terminalOutput?.textContent).toBe('█')
    expect(glyph?.style.backgroundColor).toBe('transparent')
    expect(glyph?.style.color).toBe('transparent')
    expect(rect?.style.backgroundColor).toBe('var(--terminal-foreground)')
  })

  test('paints reverse-video block glyph fills with swapped terminal colors', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['█'],
          cursor: {
            rowIndex: 0,
            columnOffset: 1,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '█',
              width: 1,
              reverse: true,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyph = terminalOutput?.querySelector<HTMLElement>(
      '[data-terminal-custom-glyph="block"]'
    )

    const rect = glyph?.querySelector<HTMLElement>(
      '[data-terminal-custom-glyph-rect="true"]'
    )

    expect(terminalOutput?.textContent).toBe('█')
    expect(glyph?.style.backgroundColor).toBe('var(--terminal-foreground)')
    expect(glyph?.style.color).toBe('transparent')
    expect(rect?.style.backgroundColor).toBe('var(--terminal-background)')
  })

  test('paints partial and quadrant block glyphs by exact cell rectangles', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['▉▐▖▝'],
          cursor: {
            rowIndex: 0,
            columnOffset: 4,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '▉▐▖▝',
              width: 4,
              foreground: TRUE_COLOR_PINK_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyphs = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-custom-glyph="block"]'
      ) ?? []
    )

    const rects = glyphs.map((glyph) =>
      glyph.querySelector<HTMLElement>(
        '[data-terminal-custom-glyph-rect="true"]'
      )
    )

    expect(terminalOutput?.textContent).toBe('▉▐▖▝')
    expect(created.viewportReader.readVisibleText()).toBe('▉▐▖▝')
    expect(glyphs).toHaveLength(4)
    expect(rects[0]?.style.width).toBe('87.5%')
    expect(rects[0]?.style.left).toBe('0%')
    expect(rects[0]?.style.top).toBe('0%')
    expect(rects[0]?.style.height).toBe('100%')
    expect(rects[1]?.style.width).toBe('50%')
    expect(rects[1]?.style.left).toBe('50%')
    expect(rects[1]?.style.top).toBe('0%')
    expect(rects[1]?.style.height).toBe('100%')
    expect(rects[2]?.style.width).toBe('50%')
    expect(rects[2]?.style.left).toBe('0%')
    expect(rects[2]?.style.top).toBe('50%')
    expect(rects[2]?.style.height).toBe('50%')
    expect(rects[3]?.style.width).toBe('50%')
    expect(rects[3]?.style.left).toBe('50%')
    expect(rects[3]?.style.top).toBe('0%')
    expect(rects[3]?.style.height).toBe('50%')
  })

  test('renders shade glyphs through the standard text path', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['░▒▓'],
          cursor: {
            rowIndex: 0,
            columnOffset: 3,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '░▒▓',
              width: 3,
              foreground: TRUE_COLOR_PINK_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyphs = terminalOutput?.querySelectorAll(
      '[data-terminal-custom-glyph="block"]'
    )

    expect(terminalOutput?.textContent).toBe('░▒▓')
    expect(created.viewportReader.readVisibleText()).toBe('░▒▓')
    expect(glyphs).toHaveLength(0)
  })

  test('paints left partial block glyph widths without overfilling', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['▉▏'],
          cursor: {
            rowIndex: 0,
            columnOffset: 2,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '▉▏',
              width: 2,
              foreground: TRUE_COLOR_PINK_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyphs = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-custom-glyph="block"]'
      ) ?? []
    )

    expect(terminalOutput?.textContent).toBe('▉▏')
    expect(created.viewportReader.readVisibleText()).toBe('▉▏')
    expect(glyphs).toHaveLength(2)

    const rects = glyphs.map((glyph) =>
      glyph.querySelector<HTMLElement>(
        '[data-terminal-custom-glyph-rect="true"]'
      )
    )

    expect(rects[0]?.style.backgroundColor).toBe(TRUE_COLOR_PINK)
    expect(rects[0]?.style.width).toBe('87.5%')
    expect(rects[0]?.style.left).toBe('0%')
    expect(rects[1]?.style.backgroundColor).toBe(TRUE_COLOR_PINK)
    expect(rects[1]?.style.width).toBe('12.5%')
    expect(rects[1]?.style.left).toBe('0%')
  })

  test('paints styled block glyphs when the cursor splits the run', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: ['██'],
          cursor: {
            rowIndex: 0,
            columnOffset: 1,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: '██',
              width: 2,
              foreground: TRUE_COLOR_PINK_HEX,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const glyphs = Array.from(
      terminalOutput?.querySelectorAll<HTMLElement>(
        '[data-terminal-custom-glyph="block"]'
      ) ?? []
    )

    const cursor = terminalOutput?.querySelector(
      '[data-terminal-cursor="true"]'
    )

    expect(terminalOutput?.textContent).toBe('██')
    expect(created.viewportReader.readVisibleText()).toBe('██')
    expect(glyphs).toHaveLength(2)
    expect(cursor?.previousSibling).toBe(glyphs[0])
    expect(cursor?.nextSibling).toBe(glyphs[1])

    const rects = glyphs.map((glyph) =>
      glyph.querySelector<HTMLElement>(
        '[data-terminal-custom-glyph-rect="true"]'
      )
    )

    expect(rects[0]?.style.backgroundColor).toBe(TRUE_COLOR_PINK)
    expect(rects[0]?.style.width).toBe('100%')
    expect(rects[1]?.style.backgroundColor).toBe(TRUE_COLOR_PINK)
    expect(rects[1]?.style.width).toBe('100%')
  })

  test('does not render overlapping native wide-glyph continuation cells', () => {
    const created = createTrackedGhosttyTerminal({
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({
          rows: [`${NERD_FONT_TERMINAL_ICON}x`],
          cursor: {
            rowIndex: 0,
            columnOffset: 3,
          },
          cells: [
            {
              row: 0,
              col: 0,
              text: NERD_FONT_TERMINAL_ICON,
              width: 2,
              foreground: TRUE_COLOR_PINK_HEX,
            },
            {
              row: 0,
              col: 1,
              text: '',
              width: 1,
            },
            {
              row: 0,
              col: 2,
              text: 'x',
              width: 1,
            },
          ],
        }),
      }),
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('snapshot'),
      offsetStart: 0,
      byteLen: 8,
      phase: 'live',
    })

    const terminalOutput = created.terminal.element?.querySelector('pre')

    const row = terminalOutput?.querySelector<HTMLElement>(
      '[data-terminal-row="true"]'
    )

    expect(terminalOutput?.textContent).toBe(`${NERD_FONT_TERMINAL_ICON}x`)
    expect(created.viewportReader.readVisibleText()).toBe(
      `${NERD_FONT_TERMINAL_ICON}x`
    )

    expect(row?.style.overflow).toBe('visible')
  })

  test('renders invalid byte payloads through the byte path', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: '//4=',
      offsetStart: 0,
      byteLen: 2,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('\uFFFD\uFFFD')
  })

  test('falls back to text when byte payloads are unavailable', () => {
    const created = createTrackedGhosttyTerminal()

    created.output.writeOutput({
      text: 'text fallback',
      offsetStart: 0,
      byteLen: 13,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('text fallback')
  })

  test('ignores output chunks after dispose without parser side effects', () => {
    const created = createTrackedGhosttyTerminal()
    const callback = vi.fn()
    const parserEventHandler = vi.fn()

    created.parser.onEvent(parserEventHandler)
    created.terminal.dispose()
    created.output.writeOutput(
      {
        text: 'wrong',
        bytesBase64: encodeText(
          '\x1b]7;file://localhost/tmp/ghostty-disposed\x07'
        ),
        offsetStart: 0,
        byteLen: 45,
        phase: 'live',
      },
      callback
    )

    expect(parserEventHandler).not.toHaveBeenCalled()
    expect(created.viewportReader.readVisibleText()).toBe('')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('streams split UTF-8 byte payloads before rendering text', () => {
    const created = createTrackedGhosttyTerminal()
    const character = String.fromCodePoint(0x4f60)
    const bytes = new TextEncoder().encode(character)

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeBase64(bytes.slice(0, 2)),
      offsetStart: 0,
      byteLen: 2,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('')

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeBase64(bytes.slice(2)),
      offsetStart: 2,
      byteLen: 1,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe(character)
  })

  test('emits OSC 7 cwd events parsed from byte payloads', () => {
    const created = createTrackedGhosttyTerminal()
    const handler = vi.fn()

    created.parser.onEvent(handler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText(
        'before \x1b]7;file://localhost/tmp/ghostty-project\x07 after'
      ),
      offsetStart: 40,
      byteLen: 58,
      phase: 'live',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty-project',
      output: {
        offsetStart: 40,
        byteLen: 58,
        phase: 'live',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('reassembles split OSC 7 byte payloads with completion context', () => {
    const created = createTrackedGhosttyTerminal()
    const handler = vi.fn()

    created.parser.onEvent(handler)
    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('before \x1b]7;file://local'),
      offsetStart: 0,
      byteLen: 24,
      phase: 'restore',
    })

    created.output.writeOutput({
      text: 'wrong',
      bytesBase64: encodeText('host/tmp/ghostty\x07 after'),
      offsetStart: 24,
      byteLen: 23,
      phase: 'restore',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/ghostty',
      output: {
        offsetStart: 24,
        byteLen: 23,
        phase: 'restore',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('marks the composed terminal surface as the ghostty spike renderer', () => {
    const created = createTrackedGhosttyTerminal()

    expect(created.terminal.element?.dataset.terminalRenderer).toBe(
      GHOSTTY_TERMINAL_RENDERER_ID
    )
  })
})
