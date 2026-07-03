import { afterEach, describe, test, expect, vi } from 'vitest'
import { matchDiffLines } from './matchDiffLines'
import {
  clearPaint,
  collectLines,
  paintMatches,
  rangeForMatch,
  scrollToMatch,
  supportsHighlightApi,
  DIFF_SEARCH_ACTIVE_HIGHLIGHT,
  DIFF_SEARCH_BULK_PAINT_CAP,
  DIFF_SEARCH_HIGHLIGHT,
} from './diffSearchDom'

const buildLine = (
  rawIndex: string,
  type: string,
  text: string
): HTMLElement => {
  const el = document.createElement('div')
  el.setAttribute('data-line', '')
  el.setAttribute('data-line-index', rawIndex)
  el.setAttribute('data-line-type', type)
  el.textContent = text

  return el
}

const buildColumn = (
  kind: 'unified' | 'deletions' | 'additions'
): {
  code: HTMLElement
  content: HTMLElement
} => {
  const code = document.createElement('code')
  code.setAttribute(`data-${kind}`, '')
  const content = document.createElement('div')
  content.setAttribute('data-content', '')
  code.appendChild(content)

  return { code, content }
}

const buildContainer = (...codes: HTMLElement[]): HTMLElement => {
  const container = document.createElement('div')
  const shadow = container.attachShadow({ mode: 'open' })
  const pre = document.createElement('pre')
  codes.forEach((c) => pre.appendChild(c))
  shadow.appendChild(pre)

  return container
}

describe('collectLines', () => {
  test('collects unified pair lines with order from the first component', () => {
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine('0,0', 'context', 'alpha'))
    content.appendChild(buildLine('3,1', 'change-deletion', 'removed'))
    content.appendChild(buildLine('4,2', 'change-addition', 'added'))

    const { lines } = collectLines(buildContainer(code))

    expect(lines).toEqual([
      {
        key: 'additions:0,0',
        side: 'additions',
        order: 0,
        text: 'alpha',
      },
      {
        key: 'deletions:3,1',
        side: 'deletions',
        order: 3,
        text: 'removed',
      },
      {
        key: 'additions:4,2',
        side: 'additions',
        order: 4,
        text: 'added',
      },
    ])
  })

  test('collects split pair lines with order from the second component', () => {
    const del = buildColumn('deletions')
    del.content.appendChild(buildLine('1,1', 'change-deletion', 'old'))
    const add = buildColumn('additions')
    add.content.appendChild(buildLine('3,1', 'change-addition', 'new'))

    const { lines, elements } = collectLines(buildContainer(del.code, add.code))

    expect(lines).toEqual([
      {
        key: 'deletions:1,1',
        side: 'deletions',
        order: 1,
        text: 'old',
      },
      {
        key: 'additions:3,1',
        side: 'additions',
        order: 1,
        text: 'new',
      },
    ])
    expect(elements.get('deletions:1,1')?.textContent).toBe('old')
  })

  test('uses a single-number line index as the order in either mode', () => {
    const unified = buildColumn('unified')
    unified.content.appendChild(buildLine('7', 'context', 'plain'))
    const add = buildColumn('additions')
    add.content.appendChild(buildLine('8', 'change-addition', 'split plain'))

    const { lines } = collectLines(buildContainer(unified.code, add.code))

    expect(lines).toEqual([
      {
        key: 'additions:7',
        side: 'additions',
        order: 7,
        text: 'plain',
      },
      {
        key: 'additions:8',
        side: 'additions',
        order: 8,
        text: 'split plain',
      },
    ])
  })

  test('returns empty when the container has no shadow root', () => {
    expect(collectLines(document.createElement('div'))).toEqual({
      lines: [],
      elements: new Map(),
    })
  })

  test('returns empty for null container', () => {
    expect(collectLines(null).lines).toEqual([])
  })
})

describe('supportsHighlightApi', () => {
  test('is false in jsdom', () => {
    expect(supportsHighlightApi()).toBe(false)
  })
})

describe('rangeForMatch', () => {
  test('spans a match across multiple token spans', () => {
    const el = document.createElement('div')
    // "const search" tokenized as <span>const </span><span>search</span>
    const a = document.createElement('span')
    a.textContent = 'const '
    const b = document.createElement('span')
    b.textContent = 'search'
    el.append(a, b)

    // match "t sea" = offsets 4..9, crossing the span boundary
    const range = rangeForMatch(el, 4, 9)

    expect(range?.startContainer).toBe(a.firstChild)
    expect(range?.startOffset).toBe(4)
    expect(range?.endContainer).toBe(b.firstChild)
    expect(range?.endOffset).toBe(3)
  })

  test('returns null when offsets exceed the text', () => {
    const el = document.createElement('div')
    el.textContent = 'ab'
    expect(rangeForMatch(el, 1, 9)).toBeNull()
  })
})

describe('paintMatches / clearPaint (stubbed registry)', () => {
  const registry = new Map<string, unknown>()

  const HighlightStub = vi.fn(function (
    this: { ranges: unknown[] },
    ...ranges: unknown[]
  ) {
    this.ranges = ranges
  })

  afterEach(() => {
    registry.clear()
    vi.unstubAllGlobals()
  })

  const stubHighlights = (): void => {
    vi.stubGlobal('Highlight', HighlightStub)
    vi.stubGlobal('CSS', { highlights: registry })
  }

  const collectedFixture = (): ReturnType<typeof collectLines> => {
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine('0,0', 'context', 'search me, search you'))
    const container = buildContainer(code)
    document.body.appendChild(container)

    return collectLines(container)
  }

  test('registers bulk and active highlights', () => {
    stubHighlights()
    const collected = collectedFixture()
    const matches = matchDiffLines(collected.lines, 'search')

    paintMatches(collected, matches, 1)

    expect(registry.has(DIFF_SEARCH_HIGHLIGHT)).toBe(true)
    expect(registry.has(DIFF_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true)
  })

  test('no-ops without the Highlight API', () => {
    const collected = collectedFixture()
    expect(() =>
      paintMatches(collected, matchDiffLines(collected.lines, 'search'), 0)
    ).not.toThrow()
  })

  test('caps bulk ranges but always paints the active match', () => {
    stubHighlights()
    const longText = 'x '.repeat(DIFF_SEARCH_BULK_PAINT_CAP + 50)
    const { code, content } = buildColumn('unified')
    content.appendChild(buildLine('0,0', 'context', longText))
    const container = buildContainer(code)
    document.body.appendChild(container)
    const collected = collectLines(container)
    const matches = matchDiffLines(collected.lines, 'x')

    paintMatches(collected, matches, matches.length - 1)

    const bulk = HighlightStub.mock.calls[HighlightStub.mock.calls.length - 2]
    expect(bulk).toHaveLength(DIFF_SEARCH_BULK_PAINT_CAP)
    expect(registry.has(DIFF_SEARCH_ACTIVE_HIGHLIGHT)).toBe(true)
  })

  test('clearPaint deletes both registry entries', () => {
    stubHighlights()
    registry.set(DIFF_SEARCH_HIGHLIGHT, {})
    registry.set(DIFF_SEARCH_ACTIVE_HIGHLIGHT, {})

    clearPaint()

    expect(registry.size).toBe(0)
  })
})

describe('scrollToMatch', () => {
  test('scrolls the matched line element into view', () => {
    const el = document.createElement('div')
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    const elements = new Map([['additions:0,0', el]])

    scrollToMatch(
      {
        key: 'additions:0,0',
        side: 'additions',
        order: 0,
        start: 0,
        end: 1,
      },
      elements
    )

    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
