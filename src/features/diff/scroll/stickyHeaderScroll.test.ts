import { describe, expect, test, vi } from 'vitest'
import {
  isLineRangeFullyVisible,
  lineRangeFitsBelowHeader,
  scrollElementIntoViewBelowHeader,
  stickyHeaderOffsetForDiffRoot,
} from './stickyHeaderScroll'

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

const withRect = (
  element: HTMLElement,
  top: number,
  bottom: number
): HTMLElement => {
  element.getBoundingClientRect = (): DOMRect => rect(top, bottom)

  return element
}

const lineWithRect = (top: number, bottom: number): HTMLElement =>
  withRect(document.createElement('div'), top, bottom)

const containerWithViewport = (top: number, bottom: number): HTMLElement => {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientHeight', {
    value: bottom - top,
    configurable: true,
  })

  return withRect(element, top, bottom)
}

// Appends a sticky file header of the given height so the container reports a
// non-zero offset (jsdom has no layout, so rects are mocked).
const attachStickyHeader = (container: HTMLElement, height: number): void => {
  const header = document.createElement('div')
  header.setAttribute('data-diffs-header', 'split')
  header.setAttribute('data-sticky', '')
  withRect(header, 0, height)
  container.appendChild(header)
}

describe('stickyHeaderOffsetForDiffRoot', () => {
  test('returns 0 when no sticky header is present', () => {
    expect(stickyHeaderOffsetForDiffRoot(document.createElement('div'))).toBe(0)
  })

  test('returns the header height plus a breathing gap', () => {
    const container = containerWithViewport(0, 500)
    attachStickyHeader(container, 40)

    expect(stickyHeaderOffsetForDiffRoot(container)).toBe(44)
  })
})

describe('isLineRangeFullyVisible', () => {
  test('true when the whole range sits below the header inside the viewport', () => {
    const container = containerWithViewport(0, 500)

    expect(
      isLineRangeFullyVisible(
        container,
        lineWithRect(100, 120),
        lineWithRect(300, 320)
      )
    ).toBe(true)
  })

  test('false when the range extends below the viewport', () => {
    const container = containerWithViewport(0, 500)

    expect(
      isLineRangeFullyVisible(
        container,
        lineWithRect(400, 420),
        lineWithRect(560, 580)
      )
    ).toBe(false)
  })

  test('false when the range is hidden under the sticky header', () => {
    const container = containerWithViewport(0, 500)
    attachStickyHeader(container, 40)

    // Top row at y=20 is inside the container but under the 44px header band.
    expect(
      isLineRangeFullyVisible(
        container,
        lineWithRect(20, 40),
        lineWithRect(200, 220)
      )
    ).toBe(false)
  })

  test('false when the container has no measured height', () => {
    const container = containerWithViewport(0, 0)

    expect(
      isLineRangeFullyVisible(
        container,
        lineWithRect(10, 20),
        lineWithRect(30, 40)
      )
    ).toBe(false)
  })
})

describe('lineRangeFitsBelowHeader', () => {
  test('true when the range fits within the header-adjusted height', () => {
    const container = containerWithViewport(0, 500)
    attachStickyHeader(container, 40)

    // 400px range vs 500 - 44 = 456px available.
    expect(
      lineRangeFitsBelowHeader(
        container,
        lineWithRect(0, 200),
        lineWithRect(200, 400)
      )
    ).toBe(true)
  })

  test('false when the header eats enough height that the range no longer fits', () => {
    const container = containerWithViewport(0, 500)
    attachStickyHeader(container, 100)

    // 460px range vs 500 - 104 = 396px available.
    expect(
      lineRangeFitsBelowHeader(
        container,
        lineWithRect(0, 230),
        lineWithRect(230, 460)
      )
    ).toBe(false)
  })
})

describe('scrollElementIntoViewBelowHeader', () => {
  test('scrolls the element into view, defaulting block to nearest', () => {
    const container = containerWithViewport(0, 500)
    const element = lineWithRect(100, 120)
    const scrollSpy = vi.fn()
    element.scrollIntoView = scrollSpy

    scrollElementIntoViewBelowHeader(container, element)

    expect(scrollSpy).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    })
  })

  test('nudges the scroll position when the element lands under the header', () => {
    const container = containerWithViewport(0, 500)
    container.scrollTop = 100
    attachStickyHeader(container, 40)
    const element = lineWithRect(10, 30)
    element.scrollIntoView = vi.fn()

    scrollElementIntoViewBelowHeader(container, element, { block: 'start' })

    // overlap = containerTop(0) + offset(44) - lineTop(10) = 34 → scrollTop -= 34.
    expect(container.scrollTop).toBe(66)
  })

  test('leaves the scroll position alone when there is no sticky header', () => {
    const container = containerWithViewport(0, 500)
    container.scrollTop = 100
    const element = lineWithRect(10, 30)
    element.scrollIntoView = vi.fn()

    scrollElementIntoViewBelowHeader(container, element, { block: 'start' })

    expect(container.scrollTop).toBe(100)
  })
})
