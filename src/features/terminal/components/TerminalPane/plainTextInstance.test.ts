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

  test('writes frontend string chunks into the viewport reader', () => {
    const created = createTrackedPlainTextTerminal()
    const callback = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.terminal.write('hello\r\nworld\n', callback)

    expect(created.viewportReader.readVisibleText()).toBe('hello\nworld')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('consumes registered OSC handlers without rendering control sequences', () => {
    const created = createTrackedPlainTextTerminal()
    const oscHandler = vi.fn((): boolean => true)
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.parser.registerOscHandler(7, oscHandler)
    created.terminal.write(
      'before \x1b]7;file://localhost/tmp/plain-text-project\x07after'
    )

    expect(oscHandler).toHaveBeenCalledWith(
      'file://localhost/tmp/plain-text-project'
    )
    expect(created.viewportReader.readVisibleText()).toBe('before after')
  })

  test('renders OSC sequences when registered handlers decline them', () => {
    const created = createTrackedPlainTextTerminal()
    const oscHandler = vi.fn((): boolean => false)
    const sequence = '\x1b]7;file://localhost/tmp/plain-text-project\x07'

    created.parser.registerOscHandler(7, oscHandler)
    created.terminal.write(`before ${sequence}after`)

    expect(oscHandler).toHaveBeenCalledWith(
      'file://localhost/tmp/plain-text-project'
    )

    expect(created.viewportReader.readVisibleText()).toBe(
      `before ${sequence}after`
    )
  })

  test('stops invoking disposed OSC handlers', () => {
    const created = createTrackedPlainTextTerminal()
    const oscHandler = vi.fn((): boolean => true)
    const sequence = '\x1b]7;file://localhost/tmp/ignored\x07'
    const disposable = created.parser.registerOscHandler(7, oscHandler)

    disposable.dispose()
    created.terminal.write(sequence)

    expect(oscHandler).not.toHaveBeenCalled()
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
