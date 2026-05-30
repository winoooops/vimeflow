import type { BrowserWindow } from 'electron'

/**
 * URLs we are willing to hand to the system browser. http(s) and mailto only —
 * never `file:`, `javascript:`, `data:`, or the app's own `vimeflow:` scheme.
 */
export const isSafeExternalUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) || url.startsWith('mailto:')

// Scheme-agnostic origin (`protocol//host`) rather than `URL.origin`, which
// only yields a real origin for schemes registered as "standard" — true for
// `vimeflow:` in the Electron runtime, but not under unit tests, where
// `.origin` collapses to the opaque "null" for both the app and `file:` URLs.
const originOf = (url: string): string | null => {
  try {
    const parsed = new URL(url)

    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

/**
 * Harden a window against renderer-driven navigation.
 *
 * The app is a single-document SPA served from one origin (`vimeflow://app` when
 * packaged, the Vite dev server in development). The markdown reading view is
 * the first surface that renders arbitrary links from on-disk documents, so a
 * clicked link in a spec/README could otherwise navigate the `BrowserWindow`
 * off-origin — and because the preload exposes `window.vimeflow` on the
 * navigated page, that remote page would inherit access to the backend IPC
 * bridge. Keep same-origin navigation, deny `window.open`, and route safe
 * external URLs to the system browser instead.
 *
 * `openExternal` is injected (rather than importing electron's `shell` here) so
 * this module stays free of the electron runtime and is unit-testable in jsdom.
 */
export const installNavigationGuard = (
  win: BrowserWindow,
  openExternal: (url: string) => void
): void => {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      openExternal(url)
    }

    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const appOrigin = originOf(win.webContents.getURL())

    // Allow the app to navigate within its own origin; block everything else.
    if (appOrigin !== null && originOf(url) === appOrigin) {
      return
    }

    event.preventDefault()

    if (isSafeExternalUrl(url)) {
      openExternal(url)
    }
  })
}
