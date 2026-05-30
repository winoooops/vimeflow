import { vi } from 'vitest'

export type ROCallback = (entries: { contentRect: DOMRectReadOnly }[]) => void

/**
 * jsdom-friendly ResizeObserver mock with a `trigger(rect)` handle so
 * tests can fire synthetic resize events inside act(). Each instance is
 * pushed onto the static `instances` array — `beforeEach` should clear
 * it AND reinstall the constructor on globalThis.ResizeObserver.
 */
export class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  cb: ROCallback

  constructor(cb: ROCallback) {
    this.cb = cb
    MockResizeObserver.instances.push(this)
  }

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  trigger(rect: { width: number; height: number }): void {
    this.cb([
      {
        contentRect: {
          ...rect,
          top: 0,
          left: 0,
          right: rect.width,
          bottom: rect.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRectReadOnly,
      },
    ])
  }
}

/**
 * Install the mock on globalThis.ResizeObserver. Call from a `beforeEach`.
 */
export const installMockResizeObserver = (): void => {
  MockResizeObserver.instances = []
  const g = globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
  g.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
}
