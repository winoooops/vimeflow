import { createNewSession } from '../../shared/actions.js'
import type { PaneKind, PaneLayoutId } from '@/features/sessions/types'
import {
  LAYOUTS,
  type LayoutShape,
} from '@/features/terminal/components/SplitView/layouts'

type ElectronModule = typeof import('electron')

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

interface BrowserPaneDomRect {
  x: number
  y: number
  width: number
  height: number
}

const commandPaletteSelector = '[role="dialog"][aria-label="Command palette"]'

const layouts = Object.values(LAYOUTS)

// Browser panes are added through split-view controls, so the seeded shell owns
// slot 0 and the browser can occupy each subsequently created slot.
const browserSlotCases = layouts.flatMap((layout) =>
  Array.from({ length: layout.capacity }, (_, slotIndex) => ({
    layout,
    slotIndex,
  })).filter(({ slotIndex }) => slotIndex > 0)
)

const dispatchCommandPaletteShortcut = async (): Promise<void> => {
  await browser.execute(() => {
    const platform =
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string }
        }
      ).userAgentData?.platform ?? navigator.platform
    const isMac = platform.toLowerCase().includes('mac')
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
  await browser.electron.execute((electron: ElectronModule) => {
    const win = electron.BrowserWindow.getAllWindows()[0]
    win?.focus()
    win?.webContents.focus()
  })
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

  await waitForCommandPaletteClosed()
}

const waitForCommandPaletteClosed = async (): Promise<void> => {
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

const waitForActiveSplitView = async (): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const splitViews = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
        )

        return splitViews.some((splitView) => {
          const rect = splitView.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })
      }),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'active split view did not render',
    }
  )
}

const readVisibleSessionId = async (): Promise<string | null> =>
  await browser.execute(
    () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
  )

const waitForVisibleSessionChange = async (
  previousSessionId: string | null
): Promise<void> => {
  await browser.waitUntil(
    async () => {
      const currentSessionId = await readVisibleSessionId()

      return currentSessionId !== null && currentSessionId !== previousSessionId
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'active session did not change',
    }
  )
}

const waitForDialogClosed = async (): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        () => document.querySelector('[role="dialog"]') === null
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'dialog did not close',
    }
  )
}

const waitForPaneKinds = async (
  expectedKinds: readonly PaneKind[]
): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute((kinds: readonly PaneKind[]) => {
        const splitViews = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
        )
        const splitView = splitViews.find((candidate) => {
          const rect = candidate.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })

        if (!splitView) {
          return false
        }

        const actualKinds = Array.from(
          splitView.querySelectorAll<HTMLElement>(
            '[data-testid="split-view-slot"]'
          )
        ).map((slot) => slot.dataset.paneKind)

        return (
          actualKinds.length === kinds.length &&
          actualKinds.every((kind, index) => kind === kinds[index])
        )
      }, expectedKinds),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `active pane kinds did not become ${expectedKinds.join(',')}`,
    }
  )
}

const switchToLayout = async (layout: LayoutShape): Promise<void> => {
  await waitForActiveSplitView()

  const alreadyActive = await browser.execute((layoutId: PaneLayoutId) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rect.width > 0 && rect.height > 0
    })

    return splitView?.dataset.layout === layoutId
  }, layout.id)

  if (alreadyActive) {
    return
  }

  const clickedVisiblePill = await browser.execute((label: string) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`
    )
    if (button === null) {
      return false
    }

    button.click()

    return true
  }, layout.name)

  if (!clickedVisiblePill) {
    await clickBySelector('button[aria-label="Configure displayed layouts"]')

    const revealed = await browser.execute((label: string) => {
      const row = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemcheckbox"]'
        )
      ).find((candidate) => (candidate.textContent ?? '').includes(label))

      if (row === undefined) {
        return false
      }

      if (row.getAttribute('aria-checked') !== 'true') {
        row.click()
      }

      return true
    }, layout.name)

    if (!revealed) {
      throw new Error(`layout display menu had no ${layout.name} row`)
    }

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
          (label: string) =>
            document.querySelector(`button[aria-label="${label}"]`) !== null,
          layout.name
        ),
      {
        timeout: 3_000,
        interval: 100,
        timeoutMsg: `${layout.name} layout pill did not become visible`,
      }
    )

    await clickBySelector(`button[aria-label="${layout.name}"]`)
  }

  await browser.waitUntil(
    async () =>
      await browser.execute((layoutId: PaneLayoutId) => {
        const splitViews = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
        )
        const splitView = splitViews.find((candidate) => {
          const rect = candidate.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })

        return splitView?.dataset.layout === layoutId
      }, layout.id),
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: `${layout.id} split did not render`,
    }
  )
}

const clickActiveSplitViewButton = async (label: string): Promise<void> => {
  const clicked = await browser.execute((buttonLabel: string) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rect.width > 0 && rect.height > 0
    })
    const button = Array.from(
      splitView?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ).find((candidate) => candidate.getAttribute('aria-label') === buttonLabel)

    button?.click()

    return button !== undefined
  }, label)

  if (!clicked) {
    throw new Error(`active split view had no ${label} button`)
  }
}

const addShellPane = async (nextPaneCount: number): Promise<void> => {
  await clickActiveSplitViewButton('add shell pane')
  await browser.waitUntil(
    async () =>
      await browser.execute((count: number) => {
        const splitViews = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
        )
        const splitView = splitViews.find((candidate) => {
          const rect = candidate.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })

        return (
          splitView?.querySelectorAll('[data-testid="split-view-slot"]')
            .length === count
        )
      }, nextPaneCount),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `split view did not reach ${String(nextPaneCount)} panes`,
    }
  )
}

const addBrowserPane = async (nextPaneCount: number): Promise<void> => {
  await clickActiveSplitViewButton('add browser pane')
  await browser.waitUntil(
    async () =>
      await browser.execute((count: number) => {
        const splitViews = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
        )
        const splitView = splitViews.find((candidate) => {
          const rect = candidate.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })

        return (
          splitView?.querySelectorAll('[data-testid="split-view-slot"]')
            .length === count &&
          splitView.querySelector('[data-testid="browser-pane"]') !== null
        )
      }, nextPaneCount),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `browser pane did not mount at pane count ${String(
        nextPaneCount
      )}`,
    }
  )
}

const createFreshShellSession = async (): Promise<void> => {
  await waitForActiveSplitView()
  const previousSessionId = await readVisibleSessionId()
  await createNewSession()
  await waitForVisibleSessionChange(previousSessionId)
  await waitForDialogClosed()
  await waitForPaneKinds(['shell'])
}

const readBrowserPaneIdentity = async (
  paneId: string
): Promise<BrowserPaneIdentity> => {
  const identity = await browser.execute((targetPaneId: string) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rect.width > 0 && rect.height > 0
    })
    const pane = Array.from(
      splitView?.querySelectorAll<HTMLElement>(
        '[data-testid="browser-pane"][data-browser-pane-id]'
      ) ?? []
    ).find((candidate) => candidate.dataset.browserPaneId === targetPaneId)
    const sessionId =
      splitView?.dataset.browserSessionId ?? splitView?.dataset.sessionId
    const browserPaneId = pane?.dataset.browserPaneId

    return sessionId && browserPaneId
      ? { sessionId, paneId: browserPaneId }
      : null
  }, paneId)

  if (!identity) {
    throw new Error(`browser pane identity ${paneId} was not available`)
  }

  return identity
}

const readBrowserPaneContentRect = async (
  paneId: string
): Promise<BrowserPaneDomRect> => {
  const rect = await browser.execute((targetPaneId: string) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const measured = candidate.getBoundingClientRect()

      return measured.width > 0 && measured.height > 0
    })
    const slot = Array.from(
      splitView?.querySelectorAll<HTMLElement>(
        '[data-testid="split-view-slot"]'
      ) ?? []
    ).find((candidate) => candidate.dataset.paneId === targetPaneId)
    const content = slot?.querySelector<HTMLElement>(
      '[data-testid="browser-pane-content"]'
    )
    const measured = content?.getBoundingClientRect()

    return measured
      ? {
          x: Math.round(measured.left),
          y: Math.round(measured.top),
          width: Math.round(measured.width),
          height: Math.round(measured.height),
        }
      : null
  }, paneId)

  if (!rect) {
    throw new Error(`browser pane ${paneId} content rect was not available`)
  }

  return rect
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
    (target) => target.id === cdpInfo.targetId && target.type === 'page'
  )

  if (!targetExists) {
    throw new Error(
      `CDP list did not include browser pane target ${cdpInfo.targetId}`
    )
  }

  if (cdpInfo.targetId !== expectedTargetId) {
    throw new Error(
      `CDP target id mismatch: got ${cdpInfo.targetId}, expected ${expectedTargetId}`
    )
  }
}

const resetBoundsCapture = async (): Promise<void> => {
  const started = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.startBrowserPaneBoundsCapture() ?? false
  )

  if (!started) {
    throw new Error('browser pane bounds capture helper is unavailable')
  }

  await browser.execute(() => {
    window.__VIMEFLOW_E2E__?.clearBrowserPaneBoundsCaptures()
  })
}

const stopBoundsCapture = async (): Promise<void> => {
  await browser.execute(() => {
    window.__VIMEFLOW_E2E__?.stopBrowserPaneBoundsCapture()
    window.__VIMEFLOW_E2E__?.clearBrowserPaneBoundsCaptures()
  })
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

const latestBoundsCapture = async (
  identity: BrowserPaneIdentity,
  visible: boolean
): Promise<BrowserPaneBoundsCapture | undefined> => {
  const captures = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.getBrowserPaneBoundsCaptures() ?? []
  )
  const matching = matchingBoundsCaptures(captures, identity, visible)

  return matching[matching.length - 1]
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

const boundsMatchContentRect = (
  capture: BrowserPaneBoundsCapture,
  rect: BrowserPaneDomRect
): boolean => {
  const tolerance = 1
  const deltas = {
    x: Math.abs(capture.bounds.x - rect.x),
    y: Math.abs(capture.bounds.y - rect.y),
    width: Math.abs(capture.bounds.width - rect.width),
    height: Math.abs(capture.bounds.height - rect.height),
  }

  return Object.values(deltas).every((delta) => delta <= tolerance)
}

const waitForBoundsToMatchContentRect = async (
  identity: BrowserPaneIdentity,
  paneId: string,
  context: string,
  timeout = 7_000
): Promise<void> => {
  let latestMessage = 'no bounds capture yet'

  try {
    await browser.waitUntil(
      async () => {
        const capture = await latestBoundsCapture(identity, true)
        const rect = await readBrowserPaneContentRect(paneId)

        if (!capture) {
          latestMessage = `rect=${JSON.stringify(rect)}`

          return false
        }

        latestMessage =
          `bounds=${JSON.stringify(capture.bounds)} ` +
          `rect=${JSON.stringify(rect)}`

        if (capture.bounds.width <= 0 || capture.bounds.height <= 0) {
          return false
        }

        return boundsMatchContentRect(capture, rect)
      },
      {
        timeout,
        interval: 100,
        timeoutMsg: `${context} native bounds did not match browser content rect`,
      }
    )
  } catch (error) {
    throw new Error(
      `${context} native bounds did not match browser content rect: ${latestMessage}`,
      { cause: error }
    )
  }
}

const translateActiveSplitView = async (x: number): Promise<void> => {
  const moved = await browser.execute((translateX: number) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rect.width > 0 && rect.height > 0
    })

    if (!splitView) {
      return false
    }

    splitView.style.transform = `translateX(${String(translateX)}px)`

    return true
  }, x)

  if (!moved) {
    throw new Error('active split view was not available to translate')
  }
}

const prepareBrowserPaneAtSlot = async (
  layout: LayoutShape,
  slotIndex: number
): Promise<BrowserPaneIdentity> => {
  await resetBoundsCapture()

  await createFreshShellSession()

  await switchToLayout(layout)

  const expectedKinds: PaneKind[] = ['shell']

  for (let index = 1; index < slotIndex; index += 1) {
    await addShellPane(index + 1)
    expectedKinds.push('shell')
  }

  if (slotIndex > 0) {
    await addBrowserPane(slotIndex + 1)
    expectedKinds.push('browser')
  }

  await waitForPaneKinds(expectedKinds)

  const paneId = await browser.execute((index: number) => {
    const splitViews = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="split-view"]')
    )
    const splitView = splitViews.find((candidate) => {
      const rect = candidate.getBoundingClientRect()

      return rect.width > 0 && rect.height > 0
    })
    const slots = Array.from(
      splitView?.querySelectorAll<HTMLElement>(
        '[data-testid="split-view-slot"]'
      ) ?? []
    )

    return slots[index]?.dataset.paneId ?? null
  }, slotIndex)

  if (!paneId) {
    throw new Error(`no pane id found for slot ${String(slotIndex)}`)
  }

  const identity = await readBrowserPaneIdentity(paneId)
  await waitForBrowserPaneCdpInfo(identity)

  return identity
}

describe('BrowserPane native overlay occlusion', () => {
  afterEach(async () => {
    await stopBoundsCapture()
  })

  it('hides a real WebContentsView browser pane behind the command palette', async () => {
    const identity = await prepareBrowserPaneAtSlot(LAYOUTS.vsplit, 1)
    const cdpInfo = await waitForBrowserPaneCdpInfo(identity)
    await assertCdpTarget(identity, cdpInfo)

    await resetBoundsCapture()
    await openCommandPalette()
    await browser.waitUntil(
      async () => {
        const hiddenCapture = await latestBoundsCapture(identity, false)
        if (!hiddenCapture) {
          return false
        }

        assertRealLayoutBounds(hiddenCapture, 'occluded')

        return true
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'browser pane never sent occluded bounds',
      }
    )

    await closeCommandPalette()
    await browser.waitUntil(
      async () => {
        const shownCapture = await latestBoundsCapture(identity, true)
        if (!shownCapture) {
          return false
        }

        assertRealLayoutBounds(shownCapture, 'restored')

        return true
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: 'browser pane never restored visible bounds',
      }
    )
  }).timeout(90_000)

  for (const { layout, slotIndex } of browserSlotCases) {
    it(`keeps a ${layout.id} WebContentsView clipped to slot ${String(
      slotIndex + 1
    )}`, async () => {
      const identity = await prepareBrowserPaneAtSlot(layout, slotIndex)

      await waitForBoundsToMatchContentRect(
        identity,
        `p${slotIndex}`,
        `${layout.id} slot ${String(slotIndex + 1)}`
      )
    }).timeout(90_000)
  }

  it('resyncs a quad WebContentsView after a position-only ancestor move', async () => {
    const identity = await prepareBrowserPaneAtSlot(LAYOUTS.quad, 3)
    await waitForBoundsToMatchContentRect(identity, 'p3', 'quad slot 4')

    await resetBoundsCapture()
    await translateActiveSplitView(24)

    await waitForBoundsToMatchContentRect(
      identity,
      'p3',
      'quad slot 4 after position-only move',
      2_000
    )
  }).timeout(90_000)
})
