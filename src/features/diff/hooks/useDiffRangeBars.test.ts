import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DiffLineAnnotation } from '@pierre/diffs'
import { useDiffRangeBars } from './useDiffRangeBars'
import { DIFF_RANGE_BAR_ATTR } from '../rangeBar/diffRangeBars'
import type { ReviewComment } from './useFeedbackBatch'

let rafCallbacks: FrameRequestCallback[] = []
beforeEach(() => {
  rafCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafCallbacks.push(cb)

    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const flushRaf = (): void =>
  act(() => {
    const pending = rafCallbacks
    rafCallbacks = []
    pending.forEach((cb) => cb(0))
  })

const makeHost = (lines: number[]): HTMLElement => {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const code = document.createElement('div')
  code.setAttribute('data-additions', '')
  const gutter = document.createElement('div')
  gutter.setAttribute('data-gutter', '')
  for (const line of lines) {
    const cell = document.createElement('div')
    cell.setAttribute('data-column-number', String(line))
    gutter.appendChild(cell)
  }
  code.appendChild(gutter)
  root.appendChild(code)

  return host
}

const barAt = (host: HTMLElement, line: number): string | null =>
  host.shadowRoot
    ?.querySelector(`[data-column-number="${line}"]`)
    ?.getAttribute(DIFF_RANGE_BAR_ATTR) ?? null

const rangeAnn = (
  startLine: number,
  endLine: number
): DiffLineAnnotation<ReviewComment> => ({
  side: 'additions',
  lineNumber: startLine,
  metadata: {
    id: `c${startLine}`,
    text: 't',
    author: 'self',
    createdAt: 1,
    target: { scope: 'range', side: 'additions', startLine, endLine },
  },
})

describe('useDiffRangeBars', () => {
  test('paints the range bar on the post-render frame', () => {
    const host = makeHost([3, 4, 5, 6])

    const { result } = renderHook(() =>
      useDiffRangeBars({
        annotations: [rangeAnn(4, 6)],
        fileKey: 'a.ts:unstaged',
      })
    )

    act(() => result.current.handlePostRender(host))
    expect(barAt(host, 5)).toBeNull() // not painted until the frame runs

    flushRaf()
    expect(barAt(host, 4)).toBe('first')
    expect(barAt(host, 6)).toBe('last')
  })

  test('re-tags when the ranges change without a new post-render', () => {
    const host = makeHost([3, 4, 5, 6])

    const { result, rerender } = renderHook(
      ({ ann }) =>
        useDiffRangeBars({ annotations: ann, fileKey: 'a.ts:unstaged' }),
      { initialProps: { ann: [rangeAnn(4, 6)] } }
    )

    act(() => result.current.handlePostRender(host))
    flushRaf()
    expect(barAt(host, 5)).toBe('mid')

    rerender({ ann: [] })
    expect(barAt(host, 5)).toBeNull()
  })

  test('drops a frame that resolves after a file switch', () => {
    const host = makeHost([3, 4, 5, 6])

    const { result, rerender } = renderHook(
      ({ fk }) =>
        useDiffRangeBars({ annotations: [rangeAnn(4, 6)], fileKey: fk }),
      { initialProps: { fk: 'a.ts:unstaged' } }
    )

    act(() => result.current.handlePostRender(host))
    rerender({ fk: 'b.ts:unstaged' }) // switch before the frame runs
    flushRaf()

    expect(barAt(host, 5)).toBeNull()
  })
})
