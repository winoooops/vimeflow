import { describe, expect, test } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  DIFF_RANGE_BAR_ATTR,
  paintRangeBars,
  rangeBarSpansForAnnotations,
  rangeBarSpansKey,
  type RangeBarSpan,
} from './diffRangeBars'
import type { ReviewComment } from '../hooks/useFeedbackBatch'

// A mock pierre shadow tree with gutter cells for the given line numbers. Split
// columns wrap them in [data-additions]/[data-deletions]; unified marks the cell
// with data-line-type.
const makeHost = (
  layout: 'split-additions' | 'split-deletions' | 'unified',
  lines: number[]
): HTMLElement => {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const code = document.createElement('div')
  if (layout === 'split-additions') {
    code.setAttribute('data-additions', '')
  }
  if (layout === 'split-deletions') {
    code.setAttribute('data-deletions', '')
  }

  const gutter = document.createElement('div')
  gutter.setAttribute('data-gutter', '')
  for (const line of lines) {
    const cell = document.createElement('div')
    cell.setAttribute('data-column-number', String(line))
    if (layout === 'unified') {
      cell.setAttribute('data-line-type', 'added')
    }
    gutter.appendChild(cell)
  }
  code.appendChild(gutter)
  root.appendChild(code)

  return host
}

const barAt = (host: HTMLElement, line: number): string | null => {
  const cell = host.shadowRoot?.querySelector(`[data-column-number="${line}"]`)

  return cell?.getAttribute(DIFF_RANGE_BAR_ATTR) ?? null
}

const annotation = (
  target?: ReviewComment['target']
): DiffLineAnnotation<ReviewComment> => ({
  side: 'additions',
  lineNumber: 4,
  metadata: { id: 'c', text: 't', author: 'self', createdAt: 1, target },
})

describe('rangeBarSpansForAnnotations', () => {
  test('extracts only range-scoped comments', () => {
    const spans = rangeBarSpansForAnnotations([
      annotation(),
      annotation({ scope: 'file' }),
      annotation({
        scope: 'range',
        side: 'additions',
        startLine: 4,
        endLine: 6,
      }),
    ])

    expect(spans).toEqual([{ side: 'additions', startLine: 4, endLine: 6 }])
  })
})

describe('rangeBarSpansKey', () => {
  test('is order-independent', () => {
    const a: RangeBarSpan[] = [
      { side: 'additions', startLine: 4, endLine: 6 },
      { side: 'deletions', startLine: 1, endLine: 2 },
    ]

    expect(rangeBarSpansKey(a)).toBe(rangeBarSpansKey([a[1], a[0]]))
  })
})

describe('paintRangeBars', () => {
  test('tags gutter cells within the range with edge roles', () => {
    const host = makeHost('split-additions', [3, 4, 5, 6, 7])

    paintRangeBars(host, [{ side: 'additions', startLine: 4, endLine: 6 }])

    expect(barAt(host, 3)).toBeNull()
    expect(barAt(host, 4)).toBe('first')
    expect(barAt(host, 5)).toBe('mid')
    expect(barAt(host, 6)).toBe('last')
    expect(barAt(host, 7)).toBeNull()
  })

  test('a single-line range uses the single role', () => {
    const host = makeHost('split-additions', [4, 5, 6])

    paintRangeBars(host, [{ side: 'additions', startLine: 5, endLine: 5 }])

    expect(barAt(host, 5)).toBe('single')
  })

  test('does not tag the wrong side', () => {
    const host = makeHost('split-deletions', [4, 5, 6])

    paintRangeBars(host, [{ side: 'additions', startLine: 4, endLine: 6 }])

    expect(barAt(host, 5)).toBeNull()
  })

  test('unified deletion rows resolve to the deletions side', () => {
    const host = makeHost('unified', [5])
    const cell = host.shadowRoot?.querySelector('[data-column-number="5"]')
    cell?.setAttribute('data-line-type', 'change-deletion')

    paintRangeBars(host, [{ side: 'deletions', startLine: 5, endLine: 5 }])

    expect(barAt(host, 5)).toBe('single')
  })

  test('clears prior tags on repaint', () => {
    const host = makeHost('split-additions', [4, 5, 6])

    paintRangeBars(host, [{ side: 'additions', startLine: 4, endLine: 6 }])
    expect(barAt(host, 5)).toBe('mid')

    paintRangeBars(host, [])
    expect(barAt(host, 5)).toBeNull()
  })

  test('degrades silently with no shadow root', () => {
    expect(() =>
      paintRangeBars(document.createElement('div'), [
        { side: 'additions', startLine: 1, endLine: 2 },
      ])
    ).not.toThrow()
    expect(() => paintRangeBars(null, [])).not.toThrow()
  })
})
