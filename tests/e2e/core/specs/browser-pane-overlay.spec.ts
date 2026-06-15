import { clickBySelector } from '../../shared/actions.js'

interface BrowserPaneIdentity {
  sessionId: string
  paneId: string
}

interface BrowserCdpInfo {
  url: string
  token: string
  targetId: string
}

interface BrowserCdpListTarget {
  id: string
  type: string
}

interface BrowserPaneBridgeWindow {
  vimeflow?: {
    browserPane?: {
      getCdpInfo: (request: BrowserPaneIdentity) => Promise<BrowserCdpInfo>
    }
  }
}

const commandPaletteSelector = '[role="dialog"][aria-label="Command palette"]'

const waitForBrowserPane = async (): Promise<void> => {
  await (
    await $('[data-testid="terminal-pane"]')
  ).waitForDisplayed({
    timeout: 20_000,
  })

  await clickBySelector('button[aria-label="Vertical split"]')

  await browser.waitUntil(
    async () =>
      await browser.execute(
        () =>
          document.querySelector('[data-testid="split-view-empty-slot"]') !==
          null
      ),
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: 'empty split slot did not render',
    }
  )

  await clickBySelector('button[aria-label="add browser pane"]')
  await (
    await $('[data-testid="browser-pane"]')
  ).waitForDisplayed({
    timeout: 15_000,
  })
}

const readBrowserPaneIdentity = async (): Promise<BrowserPaneIdentity> => {
  const identity = await browser.execute(() => {
    const pane = document.querySelector<HTMLElement>(
      '[data-testid="browser-pane"][data-browser-pane-id]'
    )
    const splitView = pane?.closest<HTMLElement>('[data-testid="split-view"]')
    const sessionId =
      splitView?.dataset.browserSessionId ?? splitView?.dataset.sessionId
    const paneId = pane?.dataset.browserPaneId

    return sessionId && paneId ? { sessionId, paneId } : null
  })

  if (!identity) {
    throw new Error('browser pane identity was not available in the DOM')
  }

  return identity
}

const waitForBrowserPaneCdpInfo = async (
  identity: BrowserPaneIdentity
): Promise<BrowserCdpInfo> => {
  let latestInfo: BrowserCdpInfo | null = null

  await browser.waitUntil(
    async () => {
      latestInfo = await browser.execute(async (request) => {
        const bridge = (window as unknown as BrowserPaneBridgeWindow).vimeflow
          ?.browserPane

        try {
          return (await bridge?.getCdpInfo(request)) ?? null
        } catch {
          return null
        }
      }, identity)

      return latestInfo !== null
    },
    {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: 'browser pane CDP target was not registered',
    }
  )

  if (!latestInfo) {
    throw new Error('browser pane CDP target was not registered')
  }

  return latestInfo
}

const assertCdpTarget = async (
  identity: BrowserPaneIdentity,
  cdpInfo: BrowserCdpInfo
): Promise<void> => {
  const response = await fetch(
    `${cdpInfo.url}/json/list?token=${cdpInfo.token}`
  )
  if (!response.ok) {
    throw new Error(`CDP list endpoint failed with ${String(response.status)}`)
  }

  const targets = (await response.json()) as BrowserCdpListTarget[]
  const expectedTargetId = `${identity.sessionId}:${identity.paneId}`
  const targetExists = targets.some(
    (target) =>
      target.id === cdpInfo.targetId &&
      target.id === expectedTargetId &&
      target.type === 'page'
  )

  if (!targetExists) {
    throw new Error(
      `CDP list did not include the browser pane target ${expectedTargetId}`
    )
  }
}

const startBoundsCapture = async (): Promise<void> => {
  const started = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.startBrowserPaneBoundsCapture() ?? false
  )

  if (!started) {
    throw new Error('browser pane bounds capture helper is unavailable')
  }
}

const matchingBoundsCaptures = (
  captures: BrowserPaneBoundsCapture[],
  identity: BrowserPaneIdentity,
  visible: boolean
): BrowserPaneBoundsCapture[] =>
  captures.filter(
    (capture) =>
      capture.sessionId === identity.sessionId &&
      capture.paneId === identity.paneId &&
      capture.visible === visible
  )

const waitForBoundsCapture = async (
  identity: BrowserPaneIdentity,
  visible: boolean
): Promise<BrowserPaneBoundsCapture> => {
  await browser.waitUntil(
    async () => {
      const captures = await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getBrowserPaneBoundsCaptures() ?? []
      )

      return matchingBoundsCaptures(captures, identity, visible).length > 0
    },
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: `browser pane never sent visible=${String(visible)} bounds`,
    }
  )

  const captures = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.getBrowserPaneBoundsCaptures() ?? []
  )
  const matching = matchingBoundsCaptures(captures, identity, visible)
  const capture = matching[matching.length - 1]
  if (!capture) {
    throw new Error(`missing visible=${String(visible)} bounds capture`)
  }

  return capture
}

const dispatchCommandPaletteShortcut = async (): Promise<void> => {
  await browser.execute(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac')
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ';',
        code: 'Semicolon',
        ctrlKey: !isMac,
        metaKey: isMac,
        bubbles: true,
        cancelable: true,
      })
    )
  })
}

const openCommandPalette = async (): Promise<void> => {
  await dispatchCommandPaletteShortcut()
  await (
    await $(commandPaletteSelector)
  ).waitForDisplayed({
    timeout: 3_000,
  })
}

const closeCommandPalette = async (): Promise<void> => {
  await browser.execute(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
  })

  await browser.waitUntil(
    async () =>
      await browser.execute(
        (selector: string) => document.querySelector(selector) === null,
        commandPaletteSelector
      ),
    {
      timeout: 3_000,
      interval: 100,
      timeoutMsg: 'command palette did not close',
    }
  )
}

const assertRealLayoutBounds = (
  capture: BrowserPaneBoundsCapture,
  context: string
): void => {
  if (capture.bounds.width <= 0 || capture.bounds.height <= 0) {
    throw new Error(
      `${context} bounds did not retain a real browser pane layout rectangle`
    )
  }
}

describe('BrowserPane native overlay occlusion', () => {
  it('hides a real WebContentsView browser pane behind the command palette', async () => {
    await waitForBrowserPane()
    const identity = await readBrowserPaneIdentity()
    const cdpInfo = await waitForBrowserPaneCdpInfo(identity)
    await assertCdpTarget(identity, cdpInfo)

    await startBoundsCapture()
    await openCommandPalette()
    const hiddenCapture = await waitForBoundsCapture(identity, false)
    assertRealLayoutBounds(hiddenCapture, 'occluded')

    await closeCommandPalette()
    const shownCapture = await waitForBoundsCapture(identity, true)
    assertRealLayoutBounds(shownCapture, 'restored')

    if (shownCapture.sequence <= hiddenCapture.sequence) {
      throw new Error('browser pane did not restore after it was hidden')
    }
  })
})
