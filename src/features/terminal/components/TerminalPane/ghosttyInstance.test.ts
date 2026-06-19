// cspell:ignore ghostty xhigh
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  TerminalDisposable,
  TerminalOutputChunk,
  TerminalParser,
} from '../../types'
import type {
  TerminalParserEngineInput,
  TerminalParserEngineOutput,
} from './terminalParserEngine'
import {
  GHOSTTY_TERMINAL_RENDERER_ID,
  createGhosttyTerminal,
  ghosttyTerminalRenderer,
  type GhosttyTerminalOptions,
} from './ghosttyInstance'
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
const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')

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
