// cspell:ignore ghostty
import { afterEach, describe, expect, test } from 'vitest'
import {
  TerminalTextSurface,
  type TerminalTextSurfaceOutput,
} from './terminalTextSurface'

// jsdom has no layout engine: scrollTop/scrollHeight/clientHeight are 0 and the
// scroll geometry must be stubbed. These helpers give the surface root a
// controllable, writable scrollTop plus fixed viewport/content heights so the
// sticky-bottom scroll machine is observable.
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

// deltaY isn't settable on a plain Event and jsdom may lack WheelEvent, so build
// a 'wheel' event with a defined deltaY the handler can read.
const dispatchWheel = (root: HTMLElement, deltaY: number): void => {
  const event = new Event('wheel')
  Object.defineProperty(event, 'deltaY', { value: deltaY })
  root.dispatchEvent(event)
}

const surfaces: TerminalTextSurface[] = []

const mountSurface = (
  geometry = { clientHeight: 100, scrollHeight: 1000 }
): { surface: TerminalTextSurface; root: HTMLElement; input: HTMLTextAreaElement } => {
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
})

describe('TerminalTextSurface sticky-bottom scrolling', () => {
  test('follows live output to the bottom by default', () => {
    const { surface, root } = mountSurface()

    surface.write('live output\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('freezes auto-scroll after the user wheels up', () => {
    const { surface, root } = mountSurface()
    root.scrollTop = root.scrollHeight // start stuck to the bottom

    dispatchWheel(root, -50)
    root.scrollTop = 400 // user reads history

    surface.write('new live output arrives\n')

    expect(root.scrollTop).toBe(400) // not yanked back to the bottom
  })

  test('resumes live scroll once the user returns to the bottom', () => {
    const { surface, root } = mountSurface()
    dispatchWheel(root, -50) // freeze

    root.scrollTop = root.scrollHeight - root.clientHeight // back at the bottom
    root.dispatchEvent(new Event('scroll'))

    surface.write('more output\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('resumes live scroll when the user types', () => {
    const { surface, root, input } = mountSurface()
    dispatchWheel(root, -50) // freeze
    root.scrollTop = 400

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    surface.write('echoed input\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('anchors the reading position as content grows while frozen', () => {
    const { surface, root } = mountSurface()
    dispatchWheel(root, -50) // freeze
    root.scrollTop = 400

    // content grows by 200px across the next render (scrollback prepended / live
    // output appended): the reading position must shift by the same delta.
    const heights = [1000, 1200]
    let read = 0
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => heights[Math.min(read++, heights.length - 1)],
    })

    surface.write('appended\n')

    expect(root.scrollTop).toBe(600) // 400 + (1200 - 1000)
  })

  test('does not scroll on a wheel-down (stays following the bottom)', () => {
    const { surface, root } = mountSurface()

    dispatchWheel(root, 50) // wheel down — no freeze
    surface.write('live\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('pins to the bottom on a scrollback render even when the cursor row is deep', () => {
    const { surface, root } = mountSurface()
    // 40 rows (scrollback + viewport) taller than the 100px pane; the cursor is
    // at the very end. Without pinToBottom the replace heuristic would jump to
    // the top (deep cursor row); pinToBottom must follow the bottom (the input).
    const tallText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')

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

  test('a scrollback render does not override the user scrolled-up freeze', () => {
    const { surface, root } = mountSurface()
    dispatchWheel(root, -50) // user reads history
    root.scrollTop = 400

    surface.writeParsedOutput({
      visibleText: 'x\ny',
      displayDelta: {
        pinToBottom: true,
        operations: [{ type: 'replace', text: 'x\ny', cursorOffset: 0 }],
      },
    })

    expect(root.scrollTop).toBe(400) // frozen, not pinned to the bottom
  })
})
