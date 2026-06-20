// cspell:ignore xhigh
import { afterEach, describe, expect, test, vi } from 'vitest'
import { themeService } from '../../../../theme'
import {
  createPlainTextTerminal,
  PLAIN_TEXT_TERMINAL_RENDERER_ID,
  plainTextTerminalRenderer,
} from './plainTextInstance'

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

const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')

const createdTerminals = new Set<ReturnType<typeof createPlainTextTerminal>>()

const createTrackedPlainTextTerminal = (): ReturnType<
  typeof createPlainTextTerminal
> => {
  const created = createPlainTextTerminal()
  createdTerminals.add(created)

  return created
}

afterEach(() => {
  createdTerminals.forEach((created) => {
    created.terminal.dispose()
  })
  createdTerminals.clear()
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
  themeService.apply('obsidian-lens')
  vi.clearAllMocks()
})

describe('plainTextInstance', () => {
  test('exposes the opt-in plain-text renderer adapter', () => {
    expect(plainTextTerminalRenderer.id).toBe(PLAIN_TEXT_TERMINAL_RENDERER_ID)
    expect(plainTextTerminalRenderer.capabilities).toEqual({
      preferredOutputInputMode: 'text',
      acceptsText: true,
      acceptsBytes: false,
    })

    expect(plainTextTerminalRenderer.createInstance).toBe(
      createPlainTextTerminal
    )
  })

  test('opens in a container and reports fitted dimensions', () => {
    const created = createTrackedPlainTextTerminal()
    const resizeHandler = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.onResize(resizeHandler)
    created.terminal.open(container)

    expect(container.firstElementChild).toBe(created.terminal.element)
    expect(created.terminal.cols).toBe(78)
    expect(created.terminal.rows).toBe(19)
    expect(resizeHandler).toHaveBeenCalledWith({ cols: 78, rows: 19 })

    setElementSize(container, 400, 180)
    created.fitController.fit()

    expect(created.terminal.cols).toBe(48)
    expect(created.terminal.rows).toBe(9)
    expect(resizeHandler).toHaveBeenLastCalledWith({ cols: 48, rows: 9 })
  })

  test('clamps renderer output to the pane width', () => {
    const created = createTrackedPlainTextTerminal()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)

    const root = created.terminal.element
    const output = root?.querySelector('pre')

    expect(root?.style.overflowX).toBe('hidden')
    expect(root?.style.overflowY).toBe('auto')
    expect(root?.style.maxWidth).toBe('100%')
    expect(root?.style.width).toBe('100%')
    expect(output?.style.boxSizing).toBe('border-box')
    expect(output?.style.maxWidth).toBe('100%')
    expect(output?.style.overflowX).toBe('hidden')
    expect(output?.style.whiteSpace).toBe('normal')
    expect(output?.style.width).toBe('100%')
    expect(output?.style.wordBreak).toBe('normal')

    const row = output?.querySelector('[data-terminal-row="true"]')

    expect(row).toBeInstanceOf(HTMLElement)
    expect((row as HTMLElement | null)?.style.maxWidth).toBe('100%')
    expect((row as HTMLElement | null)?.style.overflowX).toBe('hidden')
    expect((row as HTMLElement | null)?.style.whiteSpace).toBe('pre')
    expect((row as HTMLElement | null)?.style.width).toBe('100%')
  })

  test('writes output chunks into the viewport reader', () => {
    const created = createTrackedPlainTextTerminal()
    const callback = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.output.writeOutput(
      {
        text: 'hello\r\nworld\n',
        offsetStart: 0,
        byteLen: 13,
        phase: 'live',
      },
      callback
    )

    expect(created.viewportReader.readVisibleText()).toBe('hello\nworld')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('renders a visual cursor without adding transcript text', () => {
    const created = createTrackedPlainTextTerminal()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)

    const output = created.terminal.element?.querySelector('pre')
    const cursor = output?.querySelector('[data-terminal-cursor="true"]')

    expect(cursor).not.toBeNull()
    expect(output?.textContent).toBe('')
    expect(created.viewportReader.readVisibleText()).toBe('')
  })

  test('renders the visual cursor as a blinking block marker', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('abc')

    const output = created.terminal.element?.querySelector('pre')

    const cursor = output?.querySelector(
      '[data-terminal-cursor="true"]'
    ) as HTMLElement | null

    const marker = cursor?.querySelector(
      '[data-terminal-cursor-marker="true"]'
    ) as HTMLElement | null

    expect(output?.textContent).toBe('abc')
    expect(cursor?.style.position).toBe('relative')
    expect(cursor?.style.width).toBe('0px')
    expect(marker?.style.backgroundColor).toBe('var(--terminal-cursor-color)')
    expect(marker?.style.borderLeft).toBe('')
    expect(marker?.style.animationName).toBe('vfTerminalCursorBlink')
    expect(marker?.style.position).toBe('absolute')
    expect(marker?.style.width).toBe('0.62em')
    expect(created.viewportReader.readVisibleText()).toBe('abc')
  })

  test('places the visual cursor at the renderer buffer offset', () => {
    const created = createTrackedPlainTextTerminal()

    // cspell:disable-next-line
    created.terminal.write('abc\x1b[2D')

    const output = created.terminal.element?.querySelector('pre')
    const cursor = output?.querySelector('[data-terminal-cursor="true"]')

    expect(output?.textContent).toBe('abc')
    expect(created.viewportReader.readVisibleText()).toBe('abc')
    expect(cursor?.previousSibling?.textContent).toBe('a')
    expect(cursor?.nextSibling?.textContent).toBe('bc')
  })

  test('renders SGR true-color styles without adding transcript text', () => {
    const created = createTrackedPlainTextTerminal()

    // cspell:disable-next-line
    created.terminal.write('prompt \x1b[38;2;243;139;168mbranch\x1b[0m done')

    const output = created.terminal.element?.querySelector('pre')
    const styleRun = output?.querySelector('[data-terminal-style-run="true"]')

    expect(output?.textContent).toBe('prompt branch done')
    expect(created.viewportReader.readVisibleText()).toBe('prompt branch done')
    expect(styleRun?.textContent).toBe('branch')
    expect((styleRun as HTMLElement | null)?.style.color).toBe(TRUE_COLOR_PINK)
  })

  test('renders ANSI styles from theme variables', () => {
    const created = createTrackedPlainTextTerminal()

    // cspell:disable-next-line
    created.terminal.write('\x1b[1;4;31mred\x1b[0m')

    const output = created.terminal.element?.querySelector('pre')
    const styleRun = output?.querySelector('[data-terminal-style-run="true"]')

    expect(output?.textContent).toBe('red')
    expect(created.viewportReader.readVisibleText()).toBe('red')
    expect(styleRun?.textContent).toBe('red')
    expect((styleRun as HTMLElement | null)?.style.color).toBe(
      'var(--terminal-ansi-red)'
    )
    expect((styleRun as HTMLElement | null)?.style.fontWeight).toBe('700')
    expect((styleRun as HTMLElement | null)?.style.textDecoration).toBe(
      'underline'
    )
  })

  test('keeps a styled run as a single span when the cursor is inside it', () => {
    const created = createTrackedPlainTextTerminal()

    // cspell:disable-next-line
    created.terminal.write('\x1b[38;2;243;139;168mabc\x1b[2D')

    const output = created.terminal.element?.querySelector('pre')

    const styleRuns = output?.querySelectorAll(
      '[data-terminal-style-run="true"]'
    )
    const cursor = output?.querySelector('[data-terminal-cursor="true"]')

    expect(output?.textContent).toBe('abc')
    expect(created.viewportReader.readVisibleText()).toBe('abc')
    expect(styleRuns?.length).toBe(1)
    expect(styleRuns?.[0]?.contains(cursor ?? null)).toBe(true)
    expect(cursor?.previousSibling?.textContent).toBe('a')
    expect(cursor?.nextSibling?.textContent).toBe('bc')
  })

  test('rewrites the current line when carriage return output arrives', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('progress 10%')
    created.terminal.write('\rprogress 20%')

    expect(created.viewportReader.readVisibleText()).toBe('progress 20%')
  })

  test('treats carriage-return/newline pairs split across writes as a single newline', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('progress 10%')
    created.terminal.write('\r')
    created.terminal.write('\nprogress 20%')

    expect(created.viewportReader.readVisibleText()).toBe(
      'progress 10%\nprogress 20%'
    )
  })

  test('moves the cursor to the line end before inserting a same-chunk CRLF', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('hello world')
    created.terminal.write('\b\b\b\b\b')
    created.terminal.write('\r\nmore')

    expect(created.viewportReader.readVisibleText()).toBe('hello world\nmore')
  })

  test('clears the current line when an erase-line CSI event is emitted', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('building 100%')
    // cspell:disable-next-line
    created.terminal.write('\r\x1b[Kdone')

    expect(created.viewportReader.readVisibleText()).toBe('done')
  })

  test('applies erase-line before later text in the same chunk', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('old')
    // cspell:disable-next-line
    created.terminal.write('\x1b[2K\rdone')

    expect(created.viewportReader.readVisibleText()).toBe('done')
  })

  test('applies clear-screen CSI output to the visible buffer', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('old prompt\nold output')
    // cspell:disable-next-line
    created.terminal.write('\x1b[H\x1b[2Jnew prompt')

    expect(created.viewportReader.readVisibleText()).toBe('new prompt')
  })

  test('rewrites progress output that uses CSI cursor-left movement', () => {
    const created = createTrackedPlainTextTerminal()

    // cspell:disable-next-line
    created.terminal.write('S\x1b[1DSt\x1b[2DSta\x1b[3DStart')

    expect(created.viewportReader.readVisibleText()).toBe('Start')
  })

  test('keeps previous soft-wrapped input rows when the wrapped tail redraws', () => {
    const created = createTrackedPlainTextTerminal()
    const container = document.createElement('div')

    setElementSize(container, 56, 180)
    created.terminal.open(container)
    created.terminal.write('abcdef')
    created.terminal.write('\r\x1b[Kgh')

    expect(created.terminal.cols).toBe(5)
    expect(created.viewportReader.readVisibleText()).toBe('abcde\ngh')

    const rows = created.terminal.element?.querySelectorAll(
      '[data-terminal-row="true"]'
    )

    expect(rows).toHaveLength(2)
    expect(rows?.[0]?.textContent).toBe('abcde\n')
    expect(rows?.[1]?.textContent).toBe('gh')
  })

  test('rewrites Codex MCP progress output that redraws previous rows', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write(
      'Starting MCP servers (1/3): codex_apps\nlinear pending'
    )

    // cspell:disable-next-line
    created.terminal.write(
      '\x1b[1A\r\x1b[2K' +
        'Starting MCP servers (2/3): codex_apps, linear\n' +
        '\x1b[2K' +
        'linear ready'
    )

    expect(created.viewportReader.readVisibleText()).toBe(
      'Starting MCP servers (2/3): codex_apps, linear\nlinear ready'
    )
    expect(created.viewportReader.readVisibleText()).not.toContain('(1/3)')
    expect(created.viewportReader.readVisibleText()).not.toContain('pending')
  })

  test('rewrites Codex startup TUI output positioned by absolute cursor controls', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write(
      '\x1b[2J\x1b[1;1H>_ OpenAI Codex' +
        '\x1b[1;42H' +
        'model: loading' +
        '\x1b[2;1H~/projects/aws' +
        '\x1b[3;1HStarting MCP servers (1/3): codex_apps'
    )

    created.terminal.write(
      '\x1b[1;42H\x1b[K' +
        'model: gpt-5.5 default' +
        '\x1b[3;1H\x1b[2KStarting MCP servers (2/3): codex_apps, linear'
    )

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

  test('erases stale rows below the cursor during TUI redraws', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write(
      '› Summarize recent commits\n' +
        '› gpt-5.5 xhigh · ~/projects/aws\n' +
        '  gpt-5.5 xhigh · ~/projects/aws'
    )

    created.terminal.write('\x1b[2;1H\x1b[J› gpt-5.5 xhigh · ~/projects/aws')

    const visibleText = created.viewportReader.readVisibleText()

    expect(visibleText).toBe(
      '› Summarize recent commits\n› gpt-5.5 xhigh · ~/projects/aws'
    )
    expect(visibleText.match(/gpt-5.5 xhigh/g)).toHaveLength(1)
  })

  test('erases from line start to cursor inclusive in erase-line mode 1', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('abc')
    created.terminal.write('\ra')
    // cspell:disable-next-line
    created.terminal.write('\x1b[1K')

    expect(created.viewportReader.readVisibleText()).toBe('c')
  })

  test('does not erase visible glyphs at legacy Private Use Area codepoints', () => {
    const created = createTrackedPlainTextTerminal()

    // Old erase-line sentinels used U+E000..U+E002; those must now render as
    // visible glyphs so icon-font prompts are not silently erased.
    // cspell:disable-next-line
    created.terminal.write('prompt \uE000 icon')

    expect(created.viewportReader.readVisibleText()).toBe('prompt \uE000 icon')
  })

  test('moves the output cursor backward for backspace rewrites', () => {
    const created = createTrackedPlainTextTerminal()

    created.terminal.write('ab\bcd')

    expect(created.viewportReader.readVisibleText()).toBe('acd')
  })

  test('uses text output chunks even when byte payloads are present', () => {
    const created = createTrackedPlainTextTerminal()

    created.output.writeOutput({
      text: 'text wins',
      bytesBase64: encodeText('bytes lose'),
      offsetStart: 0,
      byteLen: 10,
      phase: 'live',
    })

    expect(created.viewportReader.readVisibleText()).toBe('text wins')
  })

  test('ignores writes after dispose while preserving the callback', () => {
    const created = createTrackedPlainTextTerminal()
    const callback = vi.fn()

    created.terminal.write('before')
    created.terminal.dispose()
    created.terminal.write('after', callback)

    expect(created.viewportReader.readVisibleText()).toBe('before')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('ignores output chunks after dispose without parser side effects', () => {
    const created = createTrackedPlainTextTerminal()
    const callback = vi.fn()
    const parserEventHandler = vi.fn()
    const text = '\x1b]7;file://localhost/tmp/disposed\x07'

    created.parser.onEvent(parserEventHandler)
    created.terminal.dispose()
    created.output.writeOutput(
      {
        text,
        offsetStart: 0,
        byteLen: new TextEncoder().encode(text).length,
        phase: 'live',
      },
      callback
    )

    expect(parserEventHandler).not.toHaveBeenCalled()
    expect(created.viewportReader.readVisibleText()).toBe('')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('retains recent output when scrollback exceeds the line limit', () => {
    const created = createTrackedPlainTextTerminal()

    const scrollbackText = Array.from(
      { length: 10_005 },
      (_, index) => `line-${index}`
    ).join('\n')

    created.terminal.write(scrollbackText)

    const lines = created.viewportReader.readVisibleText().split('\n')

    expect(lines).toHaveLength(10_000)
    expect(lines[0]).toBe('line-5')
    expect(lines[lines.length - 1]).toBe('line-10004')
  })

  test('emits parser events without rendering consumed OSC sequences', () => {
    const created = createTrackedPlainTextTerminal()
    const parserEventHandler = vi.fn()
    const container = document.createElement('div')

    const text =
      'before \x1b]7;file://localhost/tmp/plain-text-project\x07after'

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.parser.onEvent(parserEventHandler)
    created.output.writeOutput({
      text,
      offsetStart: 12,
      byteLen: new TextEncoder().encode(text).length,
      phase: 'live',
    })

    expect(parserEventHandler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/plain-text-project',
      output: {
        offsetStart: 12,
        byteLen: new TextEncoder().encode(text).length,
        phase: 'live',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before after')
  })

  test('reassembles split OSC sequences before emitting parser events', () => {
    const created = createTrackedPlainTextTerminal()
    const parserEventHandler = vi.fn()

    created.parser.onEvent(parserEventHandler)
    created.output.writeOutput({
      text: 'before \x1b]7;file://local',
      offsetStart: 0,
      byteLen: 24,
      phase: 'restore',
    })

    created.output.writeOutput({
      text: 'host/tmp/plain-text\x07 after',
      offsetStart: 24,
      byteLen: 27,
      phase: 'restore',
    })

    expect(parserEventHandler).toHaveBeenCalledWith({
      type: 'cwd',
      source: 'osc7',
      uri: 'file://localhost/tmp/plain-text',
      output: {
        offsetStart: 24,
        byteLen: 27,
        phase: 'restore',
      },
    })
    expect(created.viewportReader.readVisibleText()).toBe('before  after')
  })

  test('notifies parser event subscribers in registration order', () => {
    const created = createTrackedPlainTextTerminal()
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    created.parser.onEvent(firstHandler)
    created.parser.onEvent(secondHandler)
    created.terminal.write(
      'before \x1b]7;file://localhost/tmp/plain-text-project\x07after'
    )

    expect(firstHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://localhost/tmp/plain-text-project',
      })
    )

    expect(secondHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cwd',
        source: 'osc7',
        uri: 'file://localhost/tmp/plain-text-project',
      })
    )

    expect(firstHandler.mock.invocationCallOrder[0]).toBeLessThan(
      secondHandler.mock.invocationCallOrder[0]
    )
    expect(created.viewportReader.readVisibleText()).toBe('before after')
  })

  test('strips OSC sequences because the plain-text renderer consumes them internally', () => {
    const created = createTrackedPlainTextTerminal()
    const sequence = '\x1b]7;file://localhost/tmp/plain-text-project\x07'

    created.terminal.write(`before ${sequence}after`)

    expect(created.viewportReader.readVisibleText()).toBe('before after')
  })

  test('stops invoking disposed parser event handlers while keeping internal rendering', () => {
    const created = createTrackedPlainTextTerminal()
    const parserEventHandler = vi.fn()
    const sequence = '\x1b]7;file://localhost/tmp/plain-text-project\x07'
    const disposable = created.parser.onEvent(parserEventHandler)

    disposable.dispose()
    created.terminal.write(sequence)

    expect(parserEventHandler).not.toHaveBeenCalled()
    expect(created.viewportReader.readVisibleText()).toBe('')
  })

  test('emits pasted text and keyboard input through onData', () => {
    const created = createTrackedPlainTextTerminal()
    const dataHandler = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.terminal.onData(dataHandler)
    created.terminal.paste('echo hi')

    const input = created.terminal.element?.querySelector('textarea')
    input?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )

    expect(dataHandler).toHaveBeenCalledWith('echo hi')
    expect(dataHandler).toHaveBeenCalledWith('\r')
  })

  test('emits ctrl-letter keyboard input as control sequences', () => {
    const created = createTrackedPlainTextTerminal()
    const dataHandler = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.terminal.onData(dataHandler)

    const input = created.terminal.element?.querySelector('textarea')

    const interrupt = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    const eof = new KeyboardEvent('keydown', {
      key: 'd',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    input?.dispatchEvent(interrupt)
    input?.dispatchEvent(eof)

    expect(dataHandler).toHaveBeenCalledWith('\x03')
    expect(dataHandler).toHaveBeenCalledWith('\x04')
    expect(interrupt.defaultPrevented).toBe(true)
    expect(eof.defaultPrevented).toBe(true)
  })

  test('ignores selections that leave the renderer root', () => {
    const created = createTrackedPlainTextTerminal()
    const container = document.createElement('div')
    const sibling = document.createElement('div')

    setElementSize(container, 640, 360)
    document.body.append(container, sibling)
    created.terminal.open(container)
    created.terminal.write('inside terminal')
    sibling.textContent = 'outside pane'

    const outputText = created.terminal.element?.querySelector(
      '[data-terminal-row="true"]'
    )?.firstChild
    const siblingText = sibling.firstChild

    if (!outputText || !siblingText) {
      throw new Error('selection test requires terminal and sibling text nodes')
    }

    const range = document.createRange()
    range.setStart(outputText, 0)
    range.setEnd(siblingText, 'outside pane'.length)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(created.terminal.hasSelection()).toBe(false)
    expect(created.terminal.getSelection()).toBe('')
  })

  test('notifies selection listeners for native renderer selections', () => {
    const created = createTrackedPlainTextTerminal()
    const listener = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    document.body.append(container)
    created.terminal.open(container)
    created.terminal.write('inside terminal')
    created.terminal.onSelectionChange(listener)

    const outputText = created.terminal.element?.querySelector(
      '[data-terminal-row="true"]'
    )?.firstChild

    if (!outputText) {
      throw new Error('selection test requires terminal text node')
    }

    const range = document.createRange()
    range.setStart(outputText, 0)
    range.setEnd(outputText, 'inside'.length)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))

    expect(listener).toHaveBeenCalledOnce()

    range.setEnd(outputText, 'inside terminal'.length)
    document.dispatchEvent(new Event('selectionchange'))

    expect(listener).toHaveBeenCalledTimes(2)

    selection?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))

    expect(listener).toHaveBeenCalledTimes(3)

    selection?.removeAllRanges()
    selection?.addRange(range)
    created.terminal.dispose()
    document.dispatchEvent(new Event('selectionchange'))

    expect(listener).toHaveBeenCalledTimes(3)
  })

  test('honors renderer key handlers before emitting input', () => {
    const created = createTrackedPlainTextTerminal()
    const dataHandler = vi.fn()
    const keyHandler = vi.fn((): boolean => false)
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.terminal.onData(dataHandler)
    created.terminal.attachKeyEventHandler(keyHandler)

    const input = created.terminal.element?.querySelector('textarea')
    input?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
    )

    expect(keyHandler).toHaveBeenCalledOnce()
    expect(dataHandler).not.toHaveBeenCalled()
  })

  test('applies terminal theme colors', () => {
    const created = createTrackedPlainTextTerminal()
    const theme = themeService.current().terminal

    const terminalTheme = {
      ...theme,
      background: theme.brightBlack,
      foreground: theme.brightWhite,
    }

    created.terminal.applyTheme(terminalTheme)

    expect(created.terminal.element?.style.background).not.toBe('')
    expect(created.terminal.element?.style.color).not.toBe('')
    expect(
      created.terminal.element?.style.getPropertyValue(
        '--terminal-cursor-color'
      )
    ).toBe(terminalTheme.cursor)
  })
})
