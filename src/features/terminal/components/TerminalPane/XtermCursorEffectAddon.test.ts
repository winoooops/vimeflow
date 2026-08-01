import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { obsidianLens } from '../../../../theme'
import { XtermCursorEffectAddon } from './XtermCursorEffectAddon'

const CURSOR_COLOR = obsidianLens.terminal.cursor

interface MutableCursorBuffer {
  baseY: number
  cursorX: number
  cursorY: number
  viewportY: number
}

describe('XtermCursorEffectAddon', () => {
  let cursorBuffer: MutableCursorBuffer
  let cursorMove: (() => void) | undefined
  let resize: (() => void) | undefined
  let scroll: (() => void) | undefined
  let frame: FrameRequestCallback | undefined
  let terminal: Terminal
  let screen: HTMLDivElement
  let context: Pick<
    CanvasRenderingContext2D,
    | 'arc'
    | 'beginPath'
    | 'clearRect'
    | 'fill'
    | 'lineTo'
    | 'moveTo'
    | 'restore'
    | 'save'
    | 'setTransform'
    | 'stroke'
  >

  beforeEach(() => {
    cursorBuffer = {
      baseY: 0,
      cursorX: 1,
      cursorY: 1,
      viewportY: 0,
    }
    screen = document.createElement('div')
    screen.className = 'xterm-screen'
    Object.defineProperties(screen, {
      clientHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 800 },
    })

    const element = document.createElement('div')
    element.append(screen)

    context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    }

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as CanvasRenderingContext2D
    )

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback

      return 1
    })

    const disposable = { dispose: vi.fn() }
    terminal = {
      buffer: { active: cursorBuffer },
      cols: 80,
      element,
      onCursorMove: vi.fn((listener: () => void) => {
        cursorMove = listener

        return disposable
      }),
      onResize: vi.fn((listener: () => void) => {
        resize = listener

        return disposable
      }),
      onScroll: vi.fn((listener: () => void) => {
        scroll = listener

        return disposable
      }),
      rows: 24,
    } as unknown as Terminal
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('draws a tail over the xterm screen when the cursor moves', () => {
    const addon = new XtermCursorEffectAddon('tail', CURSOR_COLOR)
    addon.activate(terminal)

    cursorBuffer.cursorX = 4
    cursorMove?.()
    frame?.(performance.now() + 100)

    expect(screen.querySelector('[data-xterm-cursor-effect]')).not.toBeNull()
    expect(context.moveTo).toHaveBeenCalled()
    expect(context.lineTo).toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalled()
  })

  test('uses ring and burst drawing for the radial effects', () => {
    const addon = new XtermCursorEffectAddon('ripple', CURSOR_COLOR)
    addon.activate(terminal)

    cursorBuffer.cursorY = 3
    cursorMove?.()
    frame?.(performance.now() + 100)

    expect(context.arc).toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalled()

    addon.setEffect('sonic-boom', CURSOR_COLOR)
    cursorBuffer.cursorY = 5
    cursorMove?.()
    frame?.(performance.now() + 100)

    expect(context.fill).toHaveBeenCalled()
  })

  test('keeps off inert and removes the overlay on dispose', () => {
    const addon = new XtermCursorEffectAddon('off', CURSOR_COLOR)
    addon.activate(terminal)

    cursorBuffer.cursorX = 4
    cursorMove?.()

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()

    resize?.()
    scroll?.()
    addon.dispose()

    expect(screen.querySelector('[data-xterm-cursor-effect]')).toBeNull()
  })
})
