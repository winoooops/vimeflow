import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import * as chordRegistry from '../features/command-palette/chordRegistry'
import * as paneHeaderRefs from '../features/terminal/paneHeaderRefs'

// jsdom populates navigator.userAgent/platform, but tests that stub globals
// can leave it in a state where third-party listeners (e.g. floating-ui's
// focus-visible detection) crash. Provide a stable fallback.
Object.defineProperty(globalThis.navigator, 'userAgent', {
  configurable: true,
  enumerable: true,
  value: globalThis.navigator.userAgent || 'vitest-jsdom',
})

Object.defineProperty(globalThis.navigator, 'platform', {
  configurable: true,
  enumerable: true,
  value: globalThis.navigator.platform || 'Linux x86_64',
})

const ensureLocalStorageClear = (): void => {
  if (typeof window.localStorage.clear === 'function') {
    return
  }

  const values = new Map<string, string>()

  const storage: Storage = {
    get length(): number {
      return values.size
    },
    clear: (): void => {
      values.clear()
    },
    getItem: (key: string): string | null => values.get(key) ?? null,
    key: (index: number): string | null =>
      Array.from(values.keys())[index] ?? null,
    removeItem: (key: string): void => {
      values.delete(key)
    },
    setItem: (key: string, value: string): void => {
      values.set(key, value)
    },
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

ensureLocalStorageClear()

afterEach(() => {
  chordRegistry._resetForTest()
  paneHeaderRefs._resetForTest()
})

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>()

  return {
    get length(): number {
      return store.size
    },
    clear: (): void => {
      store.clear()
    },
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null =>
      Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key)
    },
    setItem: (key: string, value: string): void => {
      store.set(key, value)
    },
  }
}

if (typeof window.localStorage.clear !== 'function') {
  const storage = createMemoryStorage()

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

// Mock xterm.js WebGL addon to prevent WebGL errors in jsdom
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn(),
  })),
}))

// Mock scrollIntoView for all tests (not available in jsdom)
Element.prototype.scrollIntoView = (): void => {
  // No-op mock implementation
}

// Mock ResizeObserver for all tests (not available in jsdom)
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock matchMedia for xterm.js (used for DPI detection and color scheme)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: (): void => {
      // No-op
    },
    removeListener: (): void => {
      // No-op
    },
    addEventListener: (): void => {
      // No-op
    },
    removeEventListener: (): void => {
      // No-op
    },
    dispatchEvent: (): boolean => false,
  }),
})

// Mock canvas.getContext for xterm.js rendering
;(
  HTMLCanvasElement.prototype as unknown as {
    getContext: (contextId: string) => unknown
  }
).getContext = function (contextId: string): unknown {
  // Return a minimal mock context for testing
  if (contextId === '2d') {
    return {
      canvas: this,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      fillRect: (): void => {
        // No-op
      },
      clearRect: (): void => {
        // No-op
      },
      getImageData: (): ImageData =>
        ({
          data: new Uint8ClampedArray(),
          width: 0,
          height: 0,
        }) as ImageData,
      putImageData: (): void => {
        // No-op
      },
      createImageData: (): ImageData =>
        ({
          data: new Uint8ClampedArray(),
          width: 0,
          height: 0,
        }) as ImageData,
      setTransform: (): void => {
        // No-op
      },
      drawImage: (): void => {
        // No-op
      },
      save: (): void => {
        // No-op
      },
      restore: (): void => {
        // No-op
      },
      scale: (): void => {
        // No-op
      },
      rotate: (): void => {
        // No-op
      },
      translate: (): void => {
        // No-op
      },
      transform: (): void => {
        // No-op
      },
      beginPath: (): void => {
        // No-op
      },
      closePath: (): void => {
        // No-op
      },
      moveTo: (): void => {
        // No-op
      },
      lineTo: (): void => {
        // No-op
      },
      bezierCurveTo: (): void => {
        // No-op
      },
      quadraticCurveTo: (): void => {
        // No-op
      },
      arc: (): void => {
        // No-op
      },
      arcTo: (): void => {
        // No-op
      },
      ellipse: (): void => {
        // No-op
      },
      rect: (): void => {
        // No-op
      },
      fill: (): void => {
        // No-op
      },
      stroke: (): void => {
        // No-op
      },
      clip: (): void => {
        // No-op
      },
      isPointInPath: (): boolean => false,
      isPointInStroke: (): boolean => false,
      measureText: (): TextMetrics =>
        ({
          width: 0,
        }) as TextMetrics,
      fillText: (): void => {
        // No-op
      },
      strokeText: (): void => {
        // No-op
      },
    } as unknown as CanvasRenderingContext2D
  }

  return null
}
