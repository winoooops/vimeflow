import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

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
HTMLCanvasElement.prototype.getContext = function (
  contextId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
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
