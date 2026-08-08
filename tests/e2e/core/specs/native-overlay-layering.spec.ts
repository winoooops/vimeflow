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

interface LocalDialogState {
  nativeOverlayActive: boolean
  opacity: string
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

interface OverlayCheckboxClickResult {
  label: string
  mode: LayoutValidationMode
  wasChecked: boolean
}

type LayoutValidationMode = 'compact-selection' | 'display-toggle'

const layoutDisplayTriggerSelector =
  '[data-testid="layout-switcher"] button[aria-label="Configure displayed layouts"]'

const clickEnabledOverlayCheckbox = async (
  validationMode: LayoutValidationMode
): Promise<OverlayCheckboxClickResult | null> => {
  const result = await browser.electron.execute(
    async (electron: ElectronModule) => {
      for (const overlay of electron.webContents.getAllWebContents()) {
        const mode = new URL(overlay.getURL()).searchParams.get('nativeOverlay')

        if (mode !== '1' && mode !== 'menu') {
          continue
        }

        const result = (await overlay.executeJavaScript(`
          (() => {
            const item = Array.from(
              document.querySelectorAll(
                '[role="menu"][aria-label="Displayed layouts"] [role="menuitemcheckbox"]'
              )
            ).find((element) =>
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

            const wasChecked = item.getAttribute('aria-checked') === 'true'
            item.click()
            return {
              label,
              wasChecked,
            }
          })()
        `)) as Omit<OverlayCheckboxClickResult, 'mode'> | null

        if (result !== null) {
          return result
        }
      }

      return null
    }
  )

  return result === null ? null : { ...result, mode: validationMode }
}

const getOverlayMenuRect = async (): Promise<CssRect | null> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    for (const overlay of electron.webContents.getAllWebContents()) {
      const mode = new URL(overlay.getURL()).searchParams.get('nativeOverlay')

      if (mode !== '1' && mode !== 'menu') {
        continue
      }

      const rect = (await overlay.executeJavaScript(`
        (() => {
          const rect = document
            .querySelector('[role="menu"][aria-label="Displayed layouts"]')
            ?.getBoundingClientRect()
          return rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null
        })()
      `)) as CssRect | null

      if (rect !== null) {
        return rect
      }
    }

    return null
  })

const getOverlayDialogRect = async (): Promise<CssRect | null> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    let fallbackRect: CssRect | null = null

    for (const overlay of electron.webContents.getAllWebContents()) {
      const mode = new URL(overlay.getURL()).searchParams.get('nativeOverlay')

      if (mode !== '1' && mode !== 'menu') {
        continue
      }

      const rect = (await overlay.executeJavaScript(`
        (() => {
          const content = document.querySelector(
            '[data-workspace-overlay-id="layout-creator"]'
          )
          const dialog = content?.closest('[role="dialog"]') ?? content
          const rect = dialog?.getBoundingClientRect()
          return rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : null
        })()
      `)) as CssRect | null

      if (rect !== null) {
        const overlayWindow = electron.BrowserWindow.getAllWindows().find(
          (window) => window.webContents.id === overlay.id
        )

        if (
          overlayWindow?.isVisible() === true &&
          overlayWindow.isAlwaysOnTop()
        ) {
          return rect
        }

        fallbackRect ??= rect
      }
    }

    return fallbackRect
  })

const getLayoutCreatorOverlayDraftGrid = async (): Promise<{
  cols: number
  rows: number
} | null> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    for (const contents of electron.webContents.getAllWebContents()) {
      const mode = new URL(contents.getURL()).searchParams.get('nativeOverlay')

      if (mode !== '1' && mode !== 'menu') {
        continue
      }

      const grid = (await contents.executeJavaScript(`
          window.__VIMEFLOW_E2E__?.getLayoutCreatorDraftGrid() ?? null
        `)) as { cols: number; rows: number } | null

      if (grid !== null) {
        return grid
      }
    }

    return null
  })

const getParentLocalLayoutDialogState =
  async (): Promise<LocalDialogState | null> =>
    browser.electron.execute(async (electron: ElectronModule) => {
      let fallbackState: LocalDialogState | null = null

      for (const window of electron.BrowserWindow.getAllWindows()) {
        const mode = new URL(window.webContents.getURL()).searchParams.get(
          'nativeOverlay'
        )

        if (mode === '1' || mode === 'menu' || mode === 'tooltip') {
          continue
        }

        const state = (await window.webContents.executeJavaScript(`
          (() => {
            const content = document.querySelector(
              '[data-workspace-overlay-id="layout-creator"]'
            )
            const dialog = content?.closest('[role="dialog"]')

            return dialog instanceof HTMLElement
              ? {
                  nativeOverlayActive:
                    dialog.dataset.nativeOverlayActive === 'true',
                  opacity: getComputedStyle(dialog).opacity,
                }
              : null
          })()
        `)) as LocalDialogState | null

        if (state?.nativeOverlayActive === true) {
          return state
        }
        fallbackState ??= state
      }

      return fallbackState
    })

const parentLocalLayoutDialogIsHidden = (
  state: LocalDialogState | null
): boolean =>
  state === null ||
  (state.nativeOverlayActive === true && state.opacity === '0')

const closeOverlayMenuIfPresent = async (): Promise<void> => {
  if ((await getOverlayMenuRect()) === null) {
    return
  }

  await browser.electron.execute(async (electron: ElectronModule) => {
    let overlay:
      | ReturnType<typeof electron.BrowserWindow.getAllWindows>[number]
      | undefined

    for (const window of electron.BrowserWindow.getAllWindows()) {
      const mode = new URL(window.webContents.getURL()).searchParams.get(
        'nativeOverlay'
      )

      if (mode !== '1' && mode !== 'menu') {
        continue
      }

      const hasMenu = (await window.webContents.executeJavaScript(`
        Boolean(document.querySelector('[role="menu"][aria-label="Displayed layouts"]'))
      `)) as boolean

      if (hasMenu) {
        overlay = window
        break
      }
    }

    overlay?.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'Escape',
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  await browser.waitUntil(async () => (await getOverlayMenuRect()) === null, {
    timeout: 5_000,
    interval: 100,
    timeoutMsg: 'NativeOverlay menu did not close before next smoke assertion',
  })
}

const mapViewportToScreenPixels = async (): Promise<PixelMapping> =>
  browser.electron.execute((electron: ElectronModule) => {
    const parent =
      electron.BrowserWindow.getAllWindows().find((window) => {
        const mode = new URL(window.webContents.getURL()).searchParams.get(
          'nativeOverlay'
        )

        return mode !== '1' && mode !== 'menu' && mode !== 'tooltip'
      }) ?? electron.BrowserWindow.getAllWindows()[0]

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

const mapOverlayViewportToScreenPixels = async (): Promise<PixelMapping> =>
  browser.electron.execute(async (electron: ElectronModule) => {
    let overlay:
      | ReturnType<typeof electron.BrowserWindow.getAllWindows>[number]
      | undefined

    for (const window of electron.BrowserWindow.getAllWindows()) {
      const mode = new URL(window.webContents.getURL()).searchParams.get(
        'nativeOverlay'
      )

      if (mode !== '1' && mode !== 'menu') {
        continue
      }

      const hasTargetSurface = (await window.webContents.executeJavaScript(`
        Boolean(
          document.querySelector(
            '[role="menu"][aria-label="Displayed layouts"], [data-workspace-overlay-id="layout-creator"]'
          )
        )
      `)) as boolean

      if (hasTargetSurface) {
        overlay = window
        break
      }
    }

    if (overlay === undefined) {
      throw new Error('Electron overlay window unavailable')
    }

    const bounds = overlay.getContentBounds()
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

const intersectBounds = (a: Bounds, b: Bounds): Bounds | null => {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)

  if (right <= left || bottom <= top) {
    return null
  }

  return { left, top, right, bottom }
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

const sampledPixelCount = (bounds: Bounds): number =>
  (Math.floor((bounds.right - bounds.left) / 2) + 1) *
  (Math.floor((bounds.bottom - bounds.top) / 2) + 1)

const waitForRealNativeGhosttyPane = async (): Promise<CssRect> => {
  let lastNativePaneCount = 0

  await browser.waitUntil(
    async () => {
      const runtime = await browser.execute(() => ({
        nativePaneCount: document.querySelectorAll(
          '[data-testid="native-ghostty-pane"]'
        ).length,
      }))
      lastNativePaneCount = runtime.nativePaneCount

      return runtime.nativePaneCount > 0
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `real Ghostty native pane did not render (${lastNativePaneCount} native panes)`,
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
  const trigger = await $(layoutDisplayTriggerSelector)
  await trigger.waitForDisplayed({ timeout: 20_000 })

  const runtime = await browser.execute((selector) => {
    const button = document.querySelector<HTMLElement>(selector)
    const rect = button?.getBoundingClientRect()

    if (!button || !rect) {
      return null
    }

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }, layoutDisplayTriggerSelector)

  if (runtime === null) {
    throw new Error('layout display trigger rect unavailable')
  }

  return runtime
}

const waitForOverlayPaint = async (
  before: DecodedPng,
  targetRect: CssRect,
  surface: 'menu' | 'dialog'
): Promise<void> => {
  const targetMapping = await mapViewportToScreenPixels()

  await browser.waitUntil(
    async () => {
      const surfaceRect =
        surface === 'menu'
          ? await getOverlayMenuRect()
          : await getOverlayDialogRect()
      if (surfaceRect === null) {
        return false
      }

      const surfaceMapping = await mapOverlayViewportToScreenPixels()
      const surfaceBounds = mapCssRect(surfaceRect, surfaceMapping)
      const targetBounds = mapCssRect(targetRect, targetMapping)
      const overlapBounds = intersectBounds(surfaceBounds, targetBounds)
      if (overlapBounds === null) {
        return false
      }

      const after = captureScreen()
      const changed = changedPixelCount(before, after, overlapBounds)

      if (surface === 'dialog') {
        return changed > 50 || changed / sampledPixelCount(overlapBounds) > 0.2
      }

      return changed > 50
    },
    {
      timeout: 5_000,
      interval: 150,
      timeoutMsg: `NativeOverlay ${surface} did not visibly paint above the real Ghostty NSView`,
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

const waitForEnabledOverlayCheckbox = async (): Promise<void> => {
  await browser.waitUntil(
    async () =>
      browser.electron.execute(async (electron: ElectronModule) => {
        for (const overlay of electron.webContents.getAllWebContents()) {
          const mode = new URL(overlay.getURL()).searchParams.get(
            'nativeOverlay'
          )

          if (mode !== '1' && mode !== 'menu') {
            continue
          }

          const hasEnabledCheckbox = (await overlay.executeJavaScript(`
            Array.from(document.querySelectorAll(
              '[role="menu"][aria-label="Displayed layouts"] [role="menuitemcheckbox"]'
            ))
              .some((element) =>
                element instanceof HTMLElement &&
                element.getAttribute('aria-disabled') !== 'true'
              )
          `)) as boolean

          if (hasEnabledCheckbox) {
            return true
          }
        }

        return false
      }),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'NativeOverlay menu had no enabled layout checkbox row',
    }
  )
}

const ensureOverlayMenuOpen = async (): Promise<void> => {
  if ((await getOverlayMenuRect()) === null) {
    const clicked = await browser.execute((selector) => {
      const button = document.querySelector<HTMLElement>(selector)
      button?.click()

      return button !== null
    }, layoutDisplayTriggerSelector)
    if (!clicked) {
      throw new Error('layout display trigger unavailable')
    }

    await waitForOverlayMenu()
  }

  await waitForEnabledOverlayCheckbox()
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
    await closeOverlayMenuIfPresent()
    await waitForLayoutDisplayAnchor()
    const before = captureScreen()
    const validationMode = await browser.execute<LayoutValidationMode, []>(
      () => {
        const compactReadout = document.querySelector(
          '[data-testid="layout-switcher"] [aria-label^="Current pane layout:"]'
        )

        return compactReadout === null ? 'display-toggle' : 'compact-selection'
      }
    )

    await ensureOverlayMenuOpen()

    await waitForOverlayPaint(before, paneRect, 'menu')
    // macOS can dismiss transient menus while `screencapture` runs. The paint
    // assertion is complete, so reopen the menu before exercising its action.
    await ensureOverlayMenuOpen()

    const checkbox = await clickEnabledOverlayCheckbox(validationMode)
    if (checkbox === null) {
      throw new Error('NativeOverlay menu had no enabled layout checkbox row')
    }

    await browser.waitUntil(
      async () =>
        browser.execute(({ label, mode, wasChecked }) => {
          if (mode === 'compact-selection') {
            const activeLayoutReadout = document.querySelector(
              `[data-testid="layout-switcher"] [aria-label="Current pane layout: ${CSS.escape(label)}"]`
            )

            return activeLayoutReadout !== null
          }

          const layoutButton = document
            .querySelector('[data-testid="layout-switcher"]')
            ?.querySelector(`button[aria-label="${CSS.escape(label)}"]`)

          return wasChecked ? layoutButton === null : layoutButton !== null
        }, checkbox),
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'NativeOverlay layout checkbox action did not reach React',
      }
    )
    await closeOverlayMenuIfPresent()
  }).timeout(90_000)

  it('renders the custom layout dialog above the real Ghostty NSView', async function () {
    if (process.platform !== 'darwin') {
      this.skip()
    }

    const hasNativeBridge = await browser.execute(() =>
      Boolean(window.vimeflow?.ghosttyNative)
    )
    if (!hasNativeBridge) {
      this.skip()
    }

    const paneRect = await waitForRealNativeGhosttyPane()
    await waitForLayoutDisplayAnchor()
    const before = captureScreen()

    await browser.execute(() => {
      document
        .querySelector<HTMLElement>(
          'button[aria-label="Configure displayed layouts"]'
        )
        ?.click()
    })
    await waitForOverlayMenu()

    const clicked = await browser.electron.execute(
      async (electron: ElectronModule) => {
        const overlay = electron.webContents
          .getAllWebContents()
          .find((contents) => {
            const mode = new URL(contents.getURL()).searchParams.get(
              'nativeOverlay'
            )

            return mode === '1' || mode === 'menu'
          })

        if (!overlay) {
          return false
        }

        return overlay.executeJavaScript(`
          (() => {
            const item = document.querySelector(
              '[role="menu"][aria-label="Displayed layouts"] [role="menuitem"][aria-label="Create custom layout"]'
            )
            if (!(item instanceof HTMLElement)) {
              return false
            }
            item.click()
            return true
          })()
        `) as Promise<boolean>
      }
    )
    if (!clicked) {
      throw new Error('Create custom layout menu item unavailable')
    }

    await browser.waitUntil(
      async () => (await getOverlayDialogRect()) !== null,
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'Layout Creator did not render in the overlay window',
      }
    )

    await browser.waitUntil(
      async () => {
        const localDialogState = await getParentLocalLayoutDialogState()

        return parentLocalLayoutDialogIsHidden(localDialogState)
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg:
          'parent renderer did not hide the local Layout Creator dialog for native overlay',
      }
    )
    const localDialogState = await getParentLocalLayoutDialogState()
    expect(parentLocalLayoutDialogIsHidden(localDialogState)).toBe(true)

    await waitForOverlayPaint(before, paneRect, 'dialog')

    await browser.waitUntil(
      async () => (await getLayoutCreatorOverlayDraftGrid()) !== null,
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'Layout Creator overlay draft grid unavailable',
      }
    )
    const readyGrid = await getLayoutCreatorOverlayDraftGrid()
    if (readyGrid === null) {
      throw new Error(
        'Layout Creator overlay draft grid unavailable after wait'
      )
    }

    await browser.electron.execute(async (electron: ElectronModule) => {
      for (const contents of electron.webContents.getAllWebContents()) {
        const mode = new URL(contents.getURL()).searchParams.get(
          'nativeOverlay'
        )

        if (mode !== '1' && mode !== 'menu') {
          continue
        }

        const clicked = (await contents.executeJavaScript(`
          (async () => {
            if (window.__VIMEFLOW_E2E__?.getLayoutCreatorDraftGrid() === undefined) {
              return false
            }

            document.querySelector('button[aria-label="Add Cols"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
            document.querySelector('button[aria-label="Add Rows"]')?.click()
            return true
          })()
        `)) as boolean

        if (clicked) {
          return
        }
      }
    })

    await browser.waitUntil(
      async () => {
        const afterGrid = await getLayoutCreatorOverlayDraftGrid()

        return (
          afterGrid?.cols === readyGrid.cols + 1 &&
          afterGrid.rows === readyGrid.rows + 1
        )
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg:
          'Layout Creator overlay did not apply native track stepper clicks',
      }
    )

    const editorState = await browser.electron.execute(
      async (electron: ElectronModule) => {
        type BrowserWindow = ReturnType<
          ElectronModule['BrowserWindow']['getAllWindows']
        >[number]

        const delay = async (milliseconds: number): Promise<void> => {
          await new Promise((resolve) => setTimeout(resolve, milliseconds))
        }

        const findLayoutCreatorOverlay =
          async (): Promise<BrowserWindow | null> => {
            for (const window of electron.BrowserWindow.getAllWindows()) {
              const mode = new URL(
                window.webContents.getURL()
              ).searchParams.get('nativeOverlay')

              if (mode !== '1' && mode !== 'menu') {
                continue
              }

              const hasLayoutCreator = (await window.webContents
                .executeJavaScript(`
                  Boolean(document.querySelector('[data-workspace-overlay-id="layout-creator"]'))
                `)) as boolean

              if (hasLayoutCreator) {
                return window
              }
            }

            return null
          }

        const waitForLayoutCreatorOverlay =
          async (): Promise<BrowserWindow | null> => {
            const deadline = Date.now() + 5_000

            while (Date.now() < deadline) {
              const overlay = await findLayoutCreatorOverlay()
              if (overlay !== null) {
                return overlay
              }

              await delay(100)
            }

            return null
          }

        const overlay = await waitForLayoutCreatorOverlay()

        const parent = overlay?.getParentWindow()
        if (!overlay || !parent) {
          return null
        }

        const beforeName = (await overlay.webContents.executeJavaScript(`
          (() => {
            const input = document.querySelector('input[aria-label="Layout name"]')
            input?.focus()
            return input?.value ?? ''
          })()
        `)) as string
        overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Z' })
        let afterName = beforeName
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await delay(50)
          afterName = (await overlay.webContents.executeJavaScript(`
            document.querySelector('input[aria-label="Layout name"]')?.value ?? ''
          `)) as string
          if (afterName === `${beforeName}Z`) {
            break
          }
        }

        const codePanelOpened = (await overlay.webContents.executeJavaScript(`
          (() => {
            const root = document.querySelector(
              '[data-workspace-overlay-id="layout-creator"]'
            )
            const button = Array.from(root?.querySelectorAll('button') ?? [])
              .find((button) => button.textContent?.includes('Code · JSON/YAML'))
            if (!(button instanceof HTMLElement)) {
              return false
            }

            button.click()
            return true
          })()
        `)) as boolean
        if (!codePanelOpened) {
          throw new Error('Layout Creator code panel toggle unavailable')
        }

        let beforeCode: string | null = null
        for (let attempt = 0; attempt < 50; attempt += 1) {
          beforeCode = (await overlay.webContents.executeJavaScript(`
            (() => {
              const textarea = document.querySelector(
                '[data-workspace-overlay-id="layout-creator"] textarea'
              )
              if (!(textarea instanceof HTMLTextAreaElement)) {
                return null
              }
              textarea.focus()
              textarea.setSelectionRange(textarea.value.length, textarea.value.length)
              return textarea.value
            })()
          `)) as string | null
          if (beforeCode !== null) {
            break
          }

          await delay(100)
        }
        if (beforeCode === null) {
          throw new Error('Layout Creator code textarea unavailable')
        }
        overlay.webContents.sendInputEvent({ type: 'char', keyCode: ' ' })
        let afterCode = beforeCode
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await delay(50)
          afterCode = (await overlay.webContents.executeJavaScript(`
            document.querySelector(
              '[data-workspace-overlay-id="layout-creator"] textarea'
            )?.value ?? ''
          `)) as string
          if (afterCode === `${beforeCode} `) {
            break
          }
        }

        parent.setBounds({ ...parent.getBounds(), height: 600 })
        let scroll: {
          overflowY: string
          scrollable: boolean
          scrolled: boolean
        } | null = null
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await delay(100)
          scroll = (await overlay.webContents.executeJavaScript(`
            (() => {
              const region = document.querySelector(
                '[data-workspace-overlay-id="layout-creator"] .overflow-y-auto'
              )
              if (!(region instanceof HTMLElement)) {
                return null
              }
              region.scrollTop = region.scrollHeight
              return {
                overflowY: getComputedStyle(region).overflowY,
                scrollable: region.scrollHeight > region.clientHeight,
                scrolled: region.scrollTop > 0,
              }
            })()
          `)) as {
            overflowY: string
            scrollable: boolean
            scrolled: boolean
          } | null
          if (scroll?.scrolled === true) {
            break
          }
        }

        return { beforeName, afterName, beforeCode, afterCode, scroll }
      }
    )
    expect(editorState).toMatchObject({
      afterName: `${editorState?.beforeName ?? ''}Z`,
      afterCode: `${editorState?.beforeCode ?? ''} `,
      scroll: {
        overflowY: 'auto',
        scrollable: true,
        scrolled: true,
      },
    })
  }).timeout(90_000)
})
