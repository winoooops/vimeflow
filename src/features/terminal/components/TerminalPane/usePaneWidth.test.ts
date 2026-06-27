import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { usePaneWidth } from './usePaneWidth'

// Capture the ResizeObserver callback so the test can drive measurements
// synchronously. The global stub in test setup never invokes the callback.
let resizeCallback: ResizeObserverCallback | null = null

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }
  observe(): void {
    // No-op — the test fires the callback directly.
  }
  unobserve(): void {
    // No-op.
  }
  disconnect(): void {
    // No-op.
  }
}

beforeEach(() => {
  resizeCallback = null
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  resizeCallback = null
})

const fireWidth = (width: number): void => {
  act(() => {
    resizeCallback?.(
      [{ contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver
    )
  })
}

test('returns null until the first positive measurement', () => {
  const { result } = renderHook(() =>
    usePaneWidth(useRef<HTMLDivElement | null>(document.createElement('div')))
  )

  expect(result.current).toBeNull()
})

test('reports the observed content width', () => {
  const { result } = renderHook(() =>
    usePaneWidth(useRef<HTMLDivElement | null>(document.createElement('div')))
  )

  fireWidth(240)

  expect(result.current).toBe(240)
})

test('uses clientWidth for the initial content-box snapshot', () => {
  const element = document.createElement('div')
  Object.defineProperty(element, 'clientWidth', { value: 218 })

  const { result } = renderHook(() =>
    usePaneWidth(useRef<HTMLDivElement | null>(element))
  )

  expect(result.current).toBe(218)
})

test('ignores zero-width (unmeasured / hidden) readings', () => {
  const { result } = renderHook(() =>
    usePaneWidth(useRef<HTMLDivElement | null>(document.createElement('div')))
  )

  fireWidth(0)

  expect(result.current).toBeNull()
})
