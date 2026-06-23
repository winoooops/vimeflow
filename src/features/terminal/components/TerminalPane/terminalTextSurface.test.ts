// cspell:ignore ghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
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

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    )
    surface.write('echoed input\n')

    expect(root.scrollTop).toBe(root.scrollHeight)
  })

  test('holds the reading position as content grows below the frozen reader', () => {
    const { surface, root } = mountSurface()
    dispatchWheel(root, -50) // freeze
    root.scrollTop = 400

    // Content grows by 200px across the next render. Terminal history grows at
    // the bottom (below the reader), so the reading position must NOT move — the
    // rows above scrollTop are unchanged. A height-delta anchor here was the
    // regression that crept the reader to the bottom and snapped live.
    const heights = [1000, 1200]
    let read = 0
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => heights[Math.min(read++, heights.length - 1)],
    })

    surface.write('appended\n')

    expect(root.scrollTop).toBe(400) // held, not anchored to 600
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

  test('clicking focuses the input without scrolling it into view (no jump to top)', () => {
    const { root, input } = mountSurface()
    const focusSpy = vi.spyOn(input, 'focus')

    root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('TerminalTextSurface static scrollback region', () => {
  const readRegions = (
    root: HTMLElement
  ): { scrollback: HTMLElement; viewport: HTMLElement } => ({
    scrollback: root.querySelector<HTMLElement>('[data-terminal-scrollback]')!,
    viewport: root.querySelector<HTMLElement>('pre')!,
  })

  const writeWithScrollback = (
    surface: TerminalTextSurface,
    scrollback: { displayText: string; visibleText: string } | null | undefined,
    viewportText = 'prompt>'
  ): void => {
    surface.writeParsedOutput({
      visibleText: viewportText,
      ...(scrollback === undefined ? {} : { scrollback }),
      displayDelta: {
        pinToBottom: true,
        operations: [
          {
            type: 'replace',
            text: viewportText,
            cursorOffset: viewportText.length,
          },
        ],
      },
    })
  }

  test('renders history into the static region, separate from the viewport', () => {
    const { surface, root } = mountSurface()

    writeWithScrollback(surface, {
      displayText: 'history one\nhistory two',
      visibleText: 'history one\nhistory two',
    })

    const { scrollback, viewport } = readRegions(root)
    expect(scrollback.style.display).toBe('block')
    expect(scrollback.textContent).toContain('history one')
    expect(scrollback.textContent).toContain('history two')
    // The viewport pre holds only the live line, never the history.
    expect(viewport.textContent).toContain('prompt>')
    expect(viewport.textContent).not.toContain('history one')
  })

  test('does not rebuild history when the payload is absent (viewport-only frame)', () => {
    const { surface, root } = mountSurface()
    writeWithScrollback(surface, {
      displayText: 'kept history',
      visibleText: 'kept history',
    })
    const { scrollback } = readRegions(root)
    const firstRow = scrollback.firstChild

    // A frame with no scrollback field must leave the history DOM untouched.
    writeWithScrollback(surface, undefined, 'prompt> typing')

    expect(scrollback.textContent).toContain('kept history')
    expect(scrollback.firstChild).toBe(firstRow) // same node, not rebuilt
  })

  test('clears the static region on a null payload (alt screen / no history)', () => {
    const { surface, root } = mountSurface()
    writeWithScrollback(surface, {
      displayText: 'history',
      visibleText: 'history',
    })
    const { scrollback } = readRegions(root)
    expect(scrollback.style.display).toBe('block')

    writeWithScrollback(surface, null)

    expect(scrollback.style.display).toBe('none')
    expect(scrollback.textContent).toBe('')
  })

  test('select-all spans the history region and the viewport', () => {
    const { surface } = mountSurface()
    writeWithScrollback(
      surface,
      { displayText: 'history line', visibleText: 'history line' },
      'live prompt'
    )

    surface.selectAll()

    // jsdom has no real selection geometry, so getSelection falls back to the
    // combined visible text — which must include BOTH regions.
    expect(surface.getSelection()).toBe('history line\nlive prompt')
  })
})
