import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// cspell:ignore IDAT IEND IHDR paeth screencapture

interface Pixel {
  r: number
  g: number
  b: number
  a: number
}

interface DecodedPng {
  width: number
  height: number
  data: Buffer
}

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

interface PixelMapping {
  scaleX: number
  scaleY: number
  offsetX?: number
  offsetY?: number
}

type ElectronModule = typeof import('electron')

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

const pixelAt = (image: DecodedPng, x: number, y: number): Pixel => {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)))
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)))
  const offset = (clampedY * image.width + clampedX) * 4

  return {
    r: image.data[offset] ?? 0,
    g: image.data[offset + 1] ?? 0,
    b: image.data[offset + 2] ?? 0,
    a: image.data[offset + 3] ?? 0,
  }
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)

  if (pa <= pb && pa <= pc) {
    return a
  }

  return pb <= pc ? b : c
}

const decodePng = (png: Buffer): DecodedPng => {
  if (!png.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('screenshot is not a PNG')
  }

  let offset = pngSignature.length
  let width = 0
  let height = 0
  let colorType = 0
  const idatChunks: Buffer[] = []

  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const chunk = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      const bitDepth = chunk[8]
      colorType = chunk[9] ?? 0
      const interlace = chunk[12]
      if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
        throw new Error('unsupported screenshot PNG format')
      }
    } else if (type === 'IDAT') {
      idatChunks.push(chunk)
    } else if (type === 'IEND') {
      break
    }
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3
  const source = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * bytesPerPixel
  const rgba = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  let previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const filter = source[sourceOffset]
    sourceOffset += 1
    const row = Buffer.from(
      source.subarray(sourceOffset, sourceOffset + stride)
    )
    sourceOffset += stride

    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] ?? 0) : 0
      const up = previous[i] ?? 0
      const upLeft = i >= bytesPerPixel ? (previous[i - bytesPerPixel] ?? 0) : 0
      const raw = row[i] ?? 0
      row[i] =
        filter === 0
          ? raw
          : filter === 1
            ? (raw + left) & 0xff
            : filter === 2
              ? (raw + up) & 0xff
              : filter === 3
                ? (raw + Math.floor((left + up) / 2)) & 0xff
                : (raw + paeth(left, up, upLeft)) & 0xff
    }

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * bytesPerPixel
      const targetIndex = (y * width + x) * 4
      rgba[targetIndex] = row[sourceIndex] ?? 0
      rgba[targetIndex + 1] = row[sourceIndex + 1] ?? 0
      rgba[targetIndex + 2] = row[sourceIndex + 2] ?? 0
      rgba[targetIndex + 3] =
        colorType === 6 ? (row[sourceIndex + 3] ?? 0) : 255
    }

    previous = row
  }

  return { width, height, data: rgba }
}

const captureScreen = (): DecodedPng => {
  const file = path.join(
    os.tmpdir(),
    `vimeflow-native-overlay-screen-${Date.now().toString()}.png`
  )

  try {
    execFileSync('screencapture', ['-x', file])

    return decodePng(fs.readFileSync(file))
  } finally {
    fs.rmSync(file, { force: true })
  }
}

const clickEnabledCheckedOverlayCheckbox = async (): Promise<string | null> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    const overlay = electron.webContents
      .getAllWebContents()
      .find((contents) => {
        const mode = new URL(contents.getURL()).searchParams.get(
          'nativeOverlay'
        )

        return mode === '1' || mode === 'menu'
      })

    if (!overlay) {
      return null
    }

    return overlay.executeJavaScript(`
      (() => {
        const item = Array.from(
          document.querySelectorAll('[role="menuitemcheckbox"]')
        ).find((element) =>
          element.getAttribute('aria-checked') === 'true' &&
          element.getAttribute('aria-disabled') !== 'true' &&
          element instanceof HTMLElement
        )

        if (!(item instanceof HTMLElement)) {
          return null
        }

        const label = item.getAttribute('aria-label')
        if (!label) {
          return null
        }

        item.click()
        return label
      })()
    `) as Promise<string | null>
  })

const getOverlayMenuRect = async (): Promise<CssRect | null> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    const overlay = electron.webContents
      .getAllWebContents()
      .find((contents) => {
        const mode = new URL(contents.getURL()).searchParams.get(
          'nativeOverlay'
        )

        return mode === '1' || mode === 'menu'
      })

    if (!overlay) {
      return null
    }

    return overlay.executeJavaScript(`
      (() => {
        const rect = document
          .querySelector('[role="menu"]')
          ?.getBoundingClientRect()
        return rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null
      })()
    `) as Promise<CssRect | null>
  })

const mapViewportToScreenPixels = async (): Promise<PixelMapping> =>
  browser.electron.execute((electron: ElectronModule) => {
    const parent =
      electron.BrowserWindow.getAllWindows().find(
        (window) => {
          const mode = new URL(window.webContents.getURL()).searchParams.get(
            'nativeOverlay'
          )

          return mode !== '1' && mode !== 'menu' && mode !== 'tooltip'
        }
      ) ?? electron.BrowserWindow.getAllWindows()[0]

    if (!parent) {
      throw new Error('Electron parent window unavailable')
    }

    const bounds = parent.getContentBounds()
    const display = electron.screen.getDisplayMatching(bounds)
    const scale = display.scaleFactor

    return {
      offsetX: bounds.x * scale,
      offsetY: bounds.y * scale,
      scaleX: scale,
      scaleY: scale,
    }
  })

const mapCssRect = (rect: CssRect, mapping: PixelMapping): Bounds => ({
  left: Math.round((mapping.offsetX ?? 0) + rect.x * mapping.scaleX),
  top: Math.round((mapping.offsetY ?? 0) + rect.y * mapping.scaleY),
  right: Math.round(
    (mapping.offsetX ?? 0) + (rect.x + rect.width) * mapping.scaleX
  ),
  bottom: Math.round(
    (mapping.offsetY ?? 0) + (rect.y + rect.height) * mapping.scaleY
  ),
})

const intersectCssRect = (a: CssRect, b: CssRect): CssRect | null => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  if (right <= x || bottom <= y) {
    return null
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

const changedPixelCount = (
  before: DecodedPng,
  after: DecodedPng,
  bounds: Bounds
): number => {
  let changed = 0
  const left = Math.max(0, bounds.left)
  const top = Math.max(0, bounds.top)
  const right = Math.min(before.width - 1, bounds.right)
  const bottom = Math.min(before.height - 1, bounds.bottom)

  for (let y = top; y <= bottom; y += 2) {
    for (let x = left; x <= right; x += 2) {
      const a = pixelAt(before, x, y)
      const b = pixelAt(after, x, y)
      const delta =
        Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)
      if (delta > 24) {
        changed += 1
      }
    }
  }

  return changed
}

const waitForRealNativeGhosttyPane = async (): Promise<CssRect> => {
  await browser.waitUntil(
    async () => {
      const runtime = await browser.execute(() => ({
        nativePaneCount: document.querySelectorAll(
          '[data-testid="native-ghostty-pane"]'
        ).length,
        xtermCount: document.querySelectorAll('.xterm').length,
      }))

      return runtime.nativePaneCount > 0 && runtime.xtermCount === 0
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'real Ghostty native pane did not replace xterm',
    }
  )

  const nativePane = await $('[data-testid="native-ghostty-pane"]')
  await nativePane.waitForDisplayed({ timeout: 20_000 })

  const runtime = await browser.execute(() => {
    const pane = document.querySelector<HTMLElement>(
      '[data-testid="native-ghostty-pane"]'
    )
    const rect = pane?.getBoundingClientRect()

    if (!pane || !rect) {
      return null
    }

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

  if (runtime === null) {
    throw new Error('real Ghostty pane rect unavailable')
  }

  return runtime
}

const waitForLayoutDisplayAnchor = async (): Promise<CssRect> => {
  const trigger = await $('button[aria-label="Configure displayed layouts"]')
  await trigger.waitForDisplayed({ timeout: 20_000 })

  const runtime = await browser.execute(() => {
    const button = document.querySelector<HTMLElement>(
      'button[aria-label="Configure displayed layouts"]'
    )
    const rect = button?.getBoundingClientRect()

    if (!button || !rect) {
      return null
    }

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

  if (runtime === null) {
    throw new Error('layout display trigger rect unavailable')
  }

  return runtime
}

const waitForOverlayPaint = async (
  before: DecodedPng,
  mapping: PixelMapping,
  targetRect: CssRect
): Promise<void> => {
  await browser.waitUntil(
    async () => {
      const menuRect = await getOverlayMenuRect()
      if (menuRect === null) {
        return false
      }

      const overlapRect = intersectCssRect(menuRect, targetRect)
      if (overlapRect === null) {
        return false
      }

      const after = captureScreen()
      return (
        changedPixelCount(before, after, mapCssRect(overlapRect, mapping)) > 50
      )
    },
    {
      timeout: 5_000,
      interval: 150,
      timeoutMsg:
        'NativeOverlay menu did not visibly paint above the real Ghostty NSView',
    }
  )
}

const waitForOverlayMenu = async (): Promise<void> => {
  await browser.waitUntil(async () => (await getOverlayMenuRect()) !== null, {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: 'NativeOverlay menu did not render in the overlay window',
  })
}

describe('NativeOverlay BrowserWindow layering', () => {
  afterEach(async () => {
    await browser.electron.execute(async (electron: ElectronModule) => {
      const overlay = electron.webContents
        .getAllWebContents()
        .find((contents) => {
          const mode = new URL(contents.getURL()).searchParams.get(
            'nativeOverlay'
          )

          return mode === '1' || mode === 'menu'
        })

      await overlay?.executeJavaScript(`
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        )
      `)
    })
  })

  it('renders a layout-pill-style web NativeOverlay menu above the real Ghostty NSView', async function () {
    if (process.platform !== 'darwin') {
      this.skip()
    }

    await browser.waitUntil(
      async () =>
        browser.execute(() => typeof window.__VIMEFLOW_E2E__ !== 'undefined'),
      {
        timeout: 20_000,
        interval: 100,
        timeoutMsg: 'window.__VIMEFLOW_E2E__ missing',
      }
    )

    const hasNativeBridge = await browser.execute(() =>
      Boolean(window.vimeflow?.ghosttyNative)
    )
    if (!hasNativeBridge) {
      this.skip()
    }

    const paneRect = await waitForRealNativeGhosttyPane()
    const trigger = await $('button[aria-label="Configure displayed layouts"]')
    await waitForLayoutDisplayAnchor()
    const before = captureScreen()
    const mapping = await mapViewportToScreenPixels()

    await trigger.click()
    await waitForOverlayMenu()

    await waitForOverlayPaint(before, mapping, paneRect)

    const hiddenLayoutLabel = await clickEnabledCheckedOverlayCheckbox()
    if (hiddenLayoutLabel === null) {
      throw new Error('NativeOverlay menu had no enabled checked layout row')
    }

    await browser.waitUntil(
      async () =>
        browser.execute(
          (label) =>
            document
              .querySelector('[data-testid="layout-switcher"]')
              ?.querySelector(`button[aria-label="${CSS.escape(label)}"]`) ===
            null,
          hiddenLayoutLabel
        ),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'NativeOverlay layout checkbox action did not reach React',
      }
    )
  }).timeout(90_000)
})
