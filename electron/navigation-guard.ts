import type { BrowserWindow } from 'electron'

/**
 * URLs we are willing to hand to the system browser. http(s) and mailto only —
 * never `file:`, `javascript:`, `data:`, or the app's own `vimeflow:` scheme.
 */
export const isSafeExternalUrl = (url: string): boolean =>
  /^https?:\/\//i.test(url) || /^mailto:/i.test(url)

// Sanitize a `mailto:` link from an untrusted doc before it reaches
// `shell.openExternal`. We allowlist rather than blocklist: keep only the
// recipient (path) and `subject`, dropping every other RFC 6068 field. That
// closes `body=` (pre-filled phishing content), `attach=` (a historical
// local-file-attachment exploit), and `cc=` / `bcc=` (silent extra recipients
// the user might send to without noticing) in one rule, leaving no param to
// enumerate. Non-mailto URLs pass through untouched.
const sanitizeOutboundUrl = (url: string): string => {
  if (!url.toLowerCase().startsWith('mailto:')) {
    return url
  }
  try {
    const parsed = new URL(url)
    const subject = parsed.searchParams.get('subject')
    parsed.search = ''
    if (subject !== null) {
      parsed.searchParams.set('subject', subject)
    }

    return parsed.toString()
  } catch {
    // A mailto: we could not parse must NOT reach the mail client with its
    // query intact — that would silently undo the sanitizer. Drop everything
    // from the first '?' so no body/cc/bcc/attach param can survive the
    // fallback. (`isSafeExternalUrl` already gated this to a mailto: link.)
    const queryStart = url.indexOf('?')

    return queryStart === -1 ? url : url.slice(0, queryStart)
  }
}

// The URL with its `#fragment` stripped. Two URLs that differ only by fragment
// address the same document, which lets us tell an in-page anchor jump apart
// from a real navigation to a different document.
const documentUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    parsed.hash = ''

    return parsed.href
  } catch {
    return null
  }
}

// Whether the URL carries a non-empty `#fragment`. A same-document link with no
// fragment is a full reload (it would drop SPA / editor state), so it must NOT
// be treated as an in-page anchor jump.
const hasFragment = (url: string): boolean => {
  try {
    return new URL(url).hash !== ''
  } catch {
    return false
  }
}

// Scheme + host comparison (works for the custom `vimeflow:` scheme too). Used
// only to decide whether a blocked navigation is genuinely external: a
// same-origin link is internal and must not pop the system browser.
const isSameOrigin = (a: string, b: string): boolean => {
  try {
    const ua = new URL(a)
    const ub = new URL(b)

    return ua.protocol === ub.protocol && ua.host === ub.host
  } catch {
    return false
  }
}

/**
 * Harden a window against renderer-driven navigation.
 *
 * The app is a single-document SPA: it never performs a real top-level
 * navigation (the UI is React state, and HMR / reloads do not fire
 * `will-navigate`). The markdown reading view is the first surface that renders
 * arbitrary links from on-disk documents, and any of them — external
 * (`https://…`), absolute (`/index.html`), relative (`./next.md`), or
 * `file:///…` — would otherwise navigate the `BrowserWindow` away from the app
 * shell: losing unsaved editor state, and (for off-origin targets) handing the
 * preload's `window.vimeflow` bridge to a remote page.
 *
 * So block every navigation except a same-document `#hash` anchor and deny
 * `window.open`; hand only genuinely external (different-origin) safe URLs to
 * the system browser. `openExternal` is injected (rather than importing
 * electron's `shell` here) so this module stays free of the electron runtime
 * and is unit-testable in jsdom.
 */
export const installNavigationGuard = (
  win: BrowserWindow,
  openExternal: (url: string) => void
): void => {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      openExternal(sanitizeOutboundUrl(url))
    }

    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    const targetDoc = documentUrl(url)

    // Allow ONLY a real in-page anchor jump: the same document AND a non-empty
    // `#fragment`. A same-document link without a fragment (e.g. "/index.html"
    // when the app is already at ".../index.html") is a full reload that would
    // drop SPA / editor state, so it must be blocked like any other navigation.
    if (
      hasFragment(url) &&
      targetDoc !== null &&
      targetDoc === documentUrl(current)
    ) {
      return
    }

    event.preventDefault()

    // Only genuinely external safe URLs go to the system browser; a blocked
    // same-origin/relative link is internal — don't pop the browser for it.
    if (isSafeExternalUrl(url) && !isSameOrigin(url, current)) {
      openExternal(sanitizeOutboundUrl(url))
    }
  })
}
