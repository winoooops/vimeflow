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
    expect(created.terminal.cols).toBe(80)
    expect(created.terminal.rows).toBe(20)
    expect(resizeHandler).toHaveBeenCalledWith({ cols: 80, rows: 20 })

    setElementSize(container, 400, 180)
    created.fitController.fit()

    expect(created.terminal.cols).toBe(50)
    expect(created.terminal.rows).toBe(10)
    expect(resizeHandler).toHaveBeenLastCalledWith({ cols: 50, rows: 10 })
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

  test('renders OSC sequences when no parser event subscribers exist', () => {
    const created = createTrackedPlainTextTerminal()
    const sequence = '\x1b]7;file://localhost/tmp/plain-text-project\x07'

    created.terminal.write(`before ${sequence}after`)

    expect(created.viewportReader.readVisibleText()).toBe(
      `before ${sequence}after`
    )
  })

  test('stops invoking disposed parser event handlers', () => {
    const created = createTrackedPlainTextTerminal()
    const parserEventHandler = vi.fn()
    const sequence = '\x1b]7;file://localhost/tmp/plain-text-project\x07'
    const disposable = created.parser.onEvent(parserEventHandler)

    disposable.dispose()
    created.terminal.write(sequence)

    expect(parserEventHandler).not.toHaveBeenCalled()
    expect(created.viewportReader.readVisibleText()).toBe(sequence)
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

    const outputText =
      created.terminal.element?.querySelector('pre')?.firstChild
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

    const outputText =
      created.terminal.element?.querySelector('pre')?.firstChild

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
  })
})
