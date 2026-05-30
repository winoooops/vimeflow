import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useElasticContainer } from './useElasticContainer'

let observerCallback: ResizeObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()
const mockUnobserve = vi.fn()

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observerCallback = callback
  }

  observe = mockObserve
  disconnect = mockDisconnect
  unobserve = mockUnobserve
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

const CONTAINER_WIDTH = 1200
const CONTAINER_HEIGHT = 800

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
    top: 0,
    left: 0,
    right: CONTAINER_WIDTH,
    bottom: CONTAINER_HEIGHT,
    x: 0,
    y: 0,
    toJSON: (): undefined => undefined,
  } as DOMRect)
  observerCallback = null
  mockObserve.mockClear()
  mockDisconnect.mockClear()
  mockUnobserve.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface RenderElasticOverrides {
  axis?: 'horizontal' | 'vertical'
  minPercent?: number
  maxPercent?: number
  initialPercent?: number
  reservedPx?: number
}

const renderElastic = (
  overrides: RenderElasticOverrides = {}
): ReturnType<
  typeof renderHook<ReturnType<typeof useElasticContainer>, unknown>
> => {
  const containerElement = document.createElement('div')

  return renderHook(() => {
    const containerRef = useRef<HTMLDivElement>(containerElement)

    return useElasticContainer({
      containerRef,
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: 0.3,
      ...overrides,
    })
  })
}

describe('useElasticContainer', () => {
  test('initializes size from initialPercent times container dimension', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      initialPercent: 0.3,
    })

    expect(result.current.size).toBe(360)
  })

  test('initializes pixelMin and pixelMax from percent config', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
    })

    expect(result.current.pixelMin).toBe(60)
    expect(result.current.pixelMax).toBe(960)
  })

  test('uses vertical dimension when axis is vertical', () => {
    const { result } = renderElastic({
      axis: 'vertical',
      initialPercent: 0.3,
    })

    expect(result.current.size).toBe(240)
  })

  test('defaults initialPercent to midpoint when not provided', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: undefined,
    })

    expect(result.current.size).toBe(510)
  })

  test('throws when containerRef.current is null', () => {
    expect(() => {
      renderHook(() => {
        const containerRef = useRef<HTMLDivElement>(null)

        return useElasticContainer({
          containerRef,
          axis: 'horizontal',
          minPercent: 0.05,
          maxPercent: 0.8,
        })
      })
    }).toThrow()
  })

  test('throws when minPercent >= maxPercent in dev', () => {
    expect(() => {
      renderElastic({ minPercent: 0.8, maxPercent: 0.05 })
    }).toThrow()
  })

  test('ResizeObserver re-clamp updates pixelMin and pixelMax on container resize', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
    })

    act(() => {
      observerCallback?.(
        [
          {
            contentRect: { width: 800, height: CONTAINER_HEIGHT },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    })

    expect(result.current.pixelMin).toBe(40)
    expect(result.current.pixelMax).toBe(640)
  })

  test('ResizeObserver clamps size when container shrinks below current size', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.05,
      maxPercent: 0.8,
      initialPercent: 0.7,
    })

    act(() => {
      observerCallback?.(
        [
          {
            contentRect: { width: 400, height: CONTAINER_HEIGHT },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    })

    expect(result.current.size).toBeLessThanOrEqual(320)
  })

  test('minPercent 0.15 computes pixelMin as ceil(1200 * 0.15) = 180', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.15,
      maxPercent: 0.8,
    })

    expect(result.current.pixelMin).toBe(Math.ceil(CONTAINER_WIDTH * 0.15))
  })

  test('disconnects ResizeObserver on unmount', () => {
    const { unmount } = renderElastic()

    unmount()

    expect(mockDisconnect).toHaveBeenCalled()
  })

  test('returns handleMouseDown, adjustBy, isDragging, sizeRef', () => {
    const { result } = renderElastic()

    expect(typeof result.current.handleMouseDown).toBe('function')
    expect(typeof result.current.adjustBy).toBe('function')
    expect(typeof result.current.isDragging).toBe('boolean')
    expect(typeof result.current.sizeRef.current).toBe('number')
  })

  test('reservedPx subtracts from the dimension before applying percentages', () => {
    // dim 1200, reserved 8 → effective 1192; initial 0.5 → round(596)
    const { result } = renderElastic({
      axis: 'horizontal',
      minPercent: 0.15,
      maxPercent: 0.85,
      initialPercent: 0.5,
      reservedPx: 8,
    })
    expect(result.current.size).toBe(596)
    expect(result.current.pixelMin).toBe(Math.ceil(1192 * 0.15)) // 179
    expect(result.current.pixelMax).toBe(Math.floor(1192 * 0.85)) // 1013
    expect(result.current.effectiveDimension).toBe(1192)
  })

  test('reservedPx defaults to 0 (dock behavior unchanged)', () => {
    const { result } = renderElastic({
      axis: 'horizontal',
      initialPercent: 0.3,
    })
    expect(result.current.size).toBe(360)
    expect(result.current.effectiveDimension).toBe(1200)
  })
})
