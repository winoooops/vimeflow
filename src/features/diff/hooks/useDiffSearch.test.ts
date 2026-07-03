import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as dom from '../search/diffSearchDom'
import { useDiffSearch, type UseDiffSearchResult } from './useDiffSearch'

const lines = [
  {
    key: 'additions:0,0',
    side: 'additions' as const,
    order: 0,
    text: 'search alpha',
  },
  {
    key: 'additions:0,1',
    side: 'additions' as const,
    order: 1,
    text: 'search beta',
  },
]

const collected = { lines, elements: new Map<string, HTMLElement>() }

interface RenderProps {
  key: string | null
  paint: boolean
}

interface DiffSearchHookRender {
  result: { current: UseDiffSearchResult }
  rerender: (props: RenderProps) => void
  unmount: () => void
  focusPanel: () => void
}

beforeEach(() => {
  vi.spyOn(dom, 'collectLines').mockReturnValue(collected)
  vi.spyOn(dom, 'paintMatches').mockImplementation(() => undefined)
  vi.spyOn(dom, 'clearPaint').mockImplementation(() => undefined)
  vi.spyOn(dom, 'scrollToMatch').mockImplementation(() => undefined)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    cb(0)

    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const render = (
  fileKey: string | null = 'a.ts:unstaged',
  paintEnabled = true
): DiffSearchHookRender => {
  const focusPanel = vi.fn()

  const hook = renderHook(
    ({ key, paint }) =>
      useDiffSearch({ fileKey: key, paintEnabled: paint, focusPanel }),
    { initialProps: { key: fileKey, paint: paintEnabled } }
  )
  // Simulate pierre's first onPostRender so lines are collected.
  act(() => hook.result.current.handlePostRender(document.createElement('div')))

  return {
    result: hook.result,
    rerender: hook.rerender,
    unmount: hook.unmount,
    focusPanel,
  }
}

describe('useDiffSearch', () => {
  test('open/setQuery computes matches and activates the first without scrolling', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    expect(result.current.isOpen).toBe(true)
    expect(result.current.matchCount).toBe(2)
    expect(result.current.activeOrdinal).toBe(1)
    expect(dom.scrollToMatch).not.toHaveBeenCalled()
  })

  test('first commit scrolls without stepping; second commit steps', () => {
    const { result, focusPanel } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    act(() => result.current.commit(1))
    expect(result.current.activeOrdinal).toBe(1)
    expect(dom.scrollToMatch).toHaveBeenCalledTimes(1)
    expect(focusPanel).toHaveBeenCalled()

    act(() => result.current.commit(1))
    expect(result.current.activeOrdinal).toBe(2)
  })

  test('step wraps both directions', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    act(() => result.current.step(-1))
    expect(result.current.activeOrdinal).toBe(2)
    act(() => result.current.step(1))
    expect(result.current.activeOrdinal).toBe(1)
  })

  test('zero matches: counter is 0 and step is a no-op', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('nomatch'))

    expect(result.current.matchCount).toBe(0)
    act(() => result.current.step(1))
    expect(dom.scrollToMatch).not.toHaveBeenCalled()
  })

  test('file-key change resets the active match; null key closes and clears', () => {
    const { result, rerender } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    act(() => result.current.step(1))
    expect(result.current.activeOrdinal).toBe(2)

    rerender({ key: 'b.ts:unstaged', paint: true })
    act(() => result.current.handlePostRender(document.createElement('div')))
    expect(result.current.activeOrdinal).toBe(1)
    expect(result.current.isOpen).toBe(true)

    rerender({ key: null, paint: true })
    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(dom.clearPaint).toHaveBeenCalled()
  })

  test('file-key null does not focus the panel when search was never open', () => {
    const { rerender, focusPanel } = render()

    rerender({ key: null, paint: true })

    expect(focusPanel).not.toHaveBeenCalled()
  })

  test('file-key null focuses the panel when closing an open search', () => {
    const { result, rerender, focusPanel } = render()

    act(() => result.current.open())
    rerender({ key: null, paint: true })

    expect(focusPanel).toHaveBeenCalledOnce()
  })

  test('close clears query, paint, and reverts state', () => {
    const { result, focusPanel } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    act(() => result.current.close())

    expect(result.current.isOpen).toBe(false)
    expect(result.current.query).toBe('')
    expect(dom.clearPaint).toHaveBeenCalled()
    expect(focusPanel).toHaveBeenCalledOnce()
  })

  test('unmount clears paint', () => {
    const { result, unmount } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    unmount()
    expect(dom.clearPaint).toHaveBeenCalled()
  })

  test('open is a no-op while fileKey is null (narrow/empty per spec 2)', () => {
    const { result } = render(null)
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(false)
  })

  test('paintEnabled turning false clears paint (authority loss per spec 5)', () => {
    const { result, rerender } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))

    rerender({ key: 'a.ts:unstaged', paint: false })

    expect(dom.clearPaint).toHaveBeenCalled()
  })

  test('same-file repaint preserves then clamps the active index (spec 2)', () => {
    const { result } = render()
    act(() => result.current.open())
    act(() => result.current.setQuery('search'))
    act(() => result.current.step(1))
    expect(result.current.activeOrdinal).toBe(2)

    vi.mocked(dom.collectLines).mockReturnValue({
      lines: [lines[0]],
      elements: new Map(),
    })
    act(() => result.current.handlePostRender(document.createElement('div')))

    expect(result.current.activeOrdinal).toBe(1)
    expect(result.current.matchCount).toBe(1)
  })
})
