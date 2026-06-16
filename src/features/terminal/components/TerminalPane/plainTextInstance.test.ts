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

afterEach(() => {
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
    const created = createPlainTextTerminal()
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
    const created = createPlainTextTerminal()
    const callback = vi.fn()
    const container = document.createElement('div')

    setElementSize(container, 640, 360)
    created.terminal.open(container)
    created.terminal.write('hello\r\nworld\n', callback)

    expect(created.viewportReader.readVisibleText()).toBe('hello\nworld')
    expect(callback).toHaveBeenCalledOnce()
  })

  test('consumes registered OSC handlers without rendering control sequences', () => {
    const created = createPlainTextTerminal()
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

  test('stops invoking disposed OSC handlers', () => {
    const created = createPlainTextTerminal()
    const oscHandler = vi.fn((): boolean => true)
    const disposable = created.parser.registerOscHandler(7, oscHandler)

    disposable.dispose()
    created.terminal.write('\x1b]7;file://localhost/tmp/ignored\x07')

    expect(oscHandler).not.toHaveBeenCalled()
  })

  test('emits pasted text and keyboard input through onData', () => {
    const created = createPlainTextTerminal()
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

  test('honors renderer key handlers before emitting input', () => {
    const created = createPlainTextTerminal()
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
    const created = createPlainTextTerminal()
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
