// cspell:ignore ghostty
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TerminalTextSurface,
  type TerminalTextSurfaceOutput,
} from './terminalTextSurface'

// jsdom has no layout engine: scrollTop/scrollHeight/clientHeight are 0 and the
// scroll geometry must be stubbed. These helpers give the surface root a
// controllable, writable scrollTop plus fixed viewport/content heights so the
// pin-to-bottom render positioning is observable.
const stubScrollGeometry = (
  root: HTMLElement,
  { clientHeight, scrollHeight }: { clientHeight: number; scrollHeight: number }
): void => {
  let scrollTop = 0
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
  })

  Object.defineProperty(root, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })

  Object.defineProperty(root, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
}

// Wheel event variant that carries pointer coordinates and a spy-able
// preventDefault, so the wheel-forwarding path (mouse-event encoding +
// preventDefault) and the engine-scroll path (scroll sender + preventDefault)
// can be asserted.
const dispatchWheelAt = (
  root: HTMLElement,
  {
    deltaY,
    deltaMode = WheelEvent.DOM_DELTA_PIXEL,
    clientX = 0,
    clientY = 0,
  }: { deltaY: number; deltaMode?: number; clientX?: number; clientY?: number }
): { preventDefault: ReturnType<typeof vi.fn> } => {
  const event = new Event('wheel')
  Object.defineProperty(event, 'deltaY', { value: deltaY })
  Object.defineProperty(event, 'deltaMode', { value: deltaMode })
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'clientY', { value: clientY })
  const preventDefault = vi.fn()
  Object.defineProperty(event, 'preventDefault', { value: preventDefault })
  root.dispatchEvent(event)

  return { preventDefault }
}

const surfaces: TerminalTextSurface[] = []
const animationFrameCallbacks = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 0

const mountSurface = (
  geometry = { clientHeight: 100, scrollHeight: 1000 }
): {
  surface: TerminalTextSurface
  root: HTMLElement
  input: HTMLTextAreaElement
} => {
  const surface = new TerminalTextSurface({
    rendererId: 'test',
    transformOutput: (data): TerminalTextSurfaceOutput => ({
      visibleText: data,
    }),
  })
  surfaces.push(surface)
  const container = document.createElement('div')
  document.body.append(container)
  surface.open(container)
  const root = surface.element!
  stubScrollGeometry(root, geometry)
  const input = root.querySelector('textarea')!

  return { surface, root, input }
}

afterEach(() => {
  surfaces.splice(0).forEach((surface) => surface.dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

beforeEach(() => {
  animationFrameCallbacks.clear()
  nextAnimationFrameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextAnimationFrameId += 1
    animationFrameCallbacks.set(nextAnimationFrameId, callback)

    return nextAnimationFrameId
  })

  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    animationFrameCallbacks.delete(id)
  })
})

const flushAnimationFrames = (): void => {
  const callbacks = Array.from(animationFrameCallbacks.entries())
  animationFrameCallbacks.clear()
  callbacks.forEach(([, callback]) => callback(0))
}

describe('TerminalTextSurface render positioning', () => {
  test('follows live output to the bottom by default', () => {
    const { surface, root } = mountSurface()

    surface.write('live output\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('pins to the bottom on a pinToBottom render even when the cursor row is deep', () => {
    const { surface, root } = mountSurface()

    // 40 rows taller than the 100px pane; the cursor is at the very end. Without
    // pinToBottom the replace heuristic would jump to the top (deep cursor row);
    // pinToBottom must follow the bottom (the live input line).
    const tallText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join(
      '\n'
    )

    surface.writeParsedOutput({
      visibleText: tallText,
      displayDelta: {
        pinToBottom: true,
        operations: [
          { type: 'replace', text: tallText, cursorOffset: tallText.length },
        ],
      },
    })

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('clicking focuses the input without scrolling it into view (no jump to top)', () => {
    const { root, input } = mountSurface()
    const focusSpy = vi.spyOn(input, 'focus')

    root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('TerminalTextSurface wheel forwarding', () => {
  const feedWheelMode = (
    surface: TerminalTextSurface,
    mode: {
      mouseTracking: boolean
      sgrMouse: boolean
    }
  ): void => {
    surface.writeParsedOutput({ visibleText: '', wheelForwardMode: mode })
  }

  test('tier 1: encodes an SGR mouse wheel event and suppresses local scroll', () => {
    const { surface, root } = mountSurface()
    const onData = vi.fn()
    surface.onData(onData)
    feedWheelMode(surface, {
      mouseTracking: true,
      sgrMouse: true,
    })

    const scrollTopBefore = root.scrollTop

    const { preventDefault } = dispatchWheelAt(root, {
      deltaY: -50,
      clientX: 5,
      clientY: 5,
    })

    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData.mock.calls[0][0]).toMatch(/^\x1b\[<64;\d+;\d+M$/)
    expect(preventDefault).toHaveBeenCalled()
    expect(root.scrollTop).toBe(scrollTopBefore) // local view did not move
  })

  test('tier 1: encodes wheel-down as SGR button 65', () => {
    const { surface, root } = mountSurface()
    const onData = vi.fn()
    surface.onData(onData)
    feedWheelMode(surface, {
      mouseTracking: true,
      sgrMouse: true,
    })

    dispatchWheelAt(root, { deltaY: 50, clientX: 5, clientY: 5 })

    expect(onData.mock.calls[0][0]).toMatch(/^\x1b\[<65;\d+;\d+M$/)
  })

  test('tier 1: falls back to X10 mouse encoding when SGR is off', () => {
    const { surface, root } = mountSurface()
    const onData = vi.fn()
    surface.onData(onData)
    feedWheelMode(surface, {
      mouseTracking: true,
      sgrMouse: false,
    })

    const { preventDefault } = dispatchWheelAt(root, {
      deltaY: -50,
      clientX: 5,
      clientY: 5,
    })

    const data = onData.mock.calls[0][0] as string
    expect(data.startsWith('\x1b[M')).toBe(true)
    expect(data.length).toBe('\x1b[M'.length + 3)
    // wheel-up button 64 → 32 + 64 = 96.
    expect(data.charCodeAt('\x1b[M'.length)).toBe(96)
    expect(preventDefault).toHaveBeenCalled()
  })

  test('tier 1: ignores horizontal-only wheel events in mouse tracking mode', () => {
    const { surface, root } = mountSurface()
    const onData = vi.fn()
    surface.onData(onData)
    feedWheelMode(surface, {
      mouseTracking: true,
      sgrMouse: true,
    })

    const { preventDefault } = dispatchWheelAt(root, { deltaY: 0 })

    expect(onData).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalled()
  })
})

describe('TerminalTextSurface engine-driven scroll', () => {
  test('forwards a wheel-up as a negative row delta to the scroll sender', () => {
    const { surface, root } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)
    // Not mouse-tracking: the wheel drives an engine scroll, not mouse bytes.
    surface.writeParsedOutput({
      visibleText: '',
      wheelForwardMode: { mouseTracking: false, sgrMouse: false },
    })

    const { preventDefault } = dispatchWheelAt(root, { deltaY: -50 })
    flushAnimationFrames()

    expect(scrollSender).toHaveBeenCalledTimes(1)
    expect(scrollSender.mock.calls[0][0]).toBeLessThan(0) // up → negative
    expect(preventDefault).toHaveBeenCalled()
  })

  test('forwards a wheel-down as a positive row delta to the scroll sender', () => {
    const { surface, root } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)

    const { preventDefault } = dispatchWheelAt(root, { deltaY: 50 })
    flushAnimationFrames()

    expect(scrollSender).toHaveBeenCalledTimes(1)
    expect(scrollSender.mock.calls[0][0]).toBeGreaterThan(0) // down → positive
    expect(preventDefault).toHaveBeenCalled()
  })

  test('leaves native wheel scrolling alone when no scroll sender is registered', () => {
    const { root } = mountSurface()

    const { preventDefault } = dispatchWheelAt(root, { deltaY: 50 })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  test('maps DOM page wheel events to one viewport of rows', () => {
    const { surface, root } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)

    dispatchWheelAt(root, {
      deltaY: 1,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
    })
    flushAnimationFrames()

    expect(scrollSender).toHaveBeenCalledWith(24)
  })

  test('coalesces wheel deltas into one engine scroll per frame', () => {
    const { surface, root } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)

    dispatchWheelAt(root, { deltaY: 50 })
    dispatchWheelAt(root, { deltaY: 50 })

    expect(scrollSender).not.toHaveBeenCalled()

    flushAnimationFrames()

    expect(scrollSender).toHaveBeenCalledTimes(1)
    expect(scrollSender.mock.calls[0][0]).toBeGreaterThan(1)
  })

  test('snaps the viewport to the bottom on a keystroke after scrolling up', () => {
    const { surface, root, input } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)
    surface.writeParsedOutput({
      visibleText: '',
      wheelForwardMode: { mouseTracking: false, sgrMouse: false },
    })

    dispatchWheelAt(root, { deltaY: -50 }) // scroll up into history
    flushAnimationFrames()
    scrollSender.mockClear()

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(scrollSender).toHaveBeenCalledTimes(1)
    // A large positive delta clamps the engine viewport to the live tail.
    expect(scrollSender.mock.calls[0][0]).toBeGreaterThanOrEqual(1_000_000)
  })

  test('keeps snap armed after a partial wheel-down from history', () => {
    const { surface, root, input } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)
    surface.writeParsedOutput({
      visibleText: '',
      wheelForwardMode: { mouseTracking: false, sgrMouse: false },
    })

    dispatchWheelAt(root, { deltaY: -50 })
    flushAnimationFrames()
    dispatchWheelAt(root, { deltaY: 50 })
    flushAnimationFrames()
    scrollSender.mockClear()

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(scrollSender).toHaveBeenCalledTimes(1)
    expect(scrollSender.mock.calls[0][0]).toBeGreaterThanOrEqual(1_000_000)
  })

  test('snaps the viewport to the bottom before programmatic paste', () => {
    const { surface, root } = mountSurface()
    const scrollSender = vi.fn()
    const onData = vi.fn()
    surface.setScrollSender(scrollSender)
    surface.onData(onData)
    surface.writeParsedOutput({
      visibleText: '',
      wheelForwardMode: { mouseTracking: false, sgrMouse: false },
    })

    dispatchWheelAt(root, { deltaY: -50 })
    flushAnimationFrames()
    scrollSender.mockClear()

    surface.paste('echo hi')

    expect(scrollSender.mock.calls[0][0]).toBeGreaterThanOrEqual(1_000_000)
    expect(onData).toHaveBeenCalledWith('echo hi')
  })

  test('does not scroll on a keystroke when already at the bottom', () => {
    const { surface, input } = mountSurface()
    const scrollSender = vi.fn()
    surface.setScrollSender(scrollSender)

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(scrollSender).not.toHaveBeenCalled()
  })
})
