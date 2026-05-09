import { clickBySelector } from '../../shared/actions.js'

const readRustSessionCount = async (): Promise<number> => {
  const ids = await browser.execute(
    async () => (await window.__VIMEFLOW_E2E__?.listActivePtySessions()) ?? []
  )
  return ids.length
}

const waitForCount = async (
  expected: number,
  timeoutMsg: string
): Promise<void> => {
  await browser.waitUntil(
    async () => (await readRustSessionCount()) === expected,
    { timeout: 15_000, interval: 500, timeoutMsg }
  )
}

const clickLatestSessionTabCloseButton = async (): Promise<void> => {
  const ok = await browser.execute(() => {
    const tabs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')
    )
    const latestTab = tabs[tabs.length - 1]
    const closeButton = latestTab?.querySelector<HTMLButtonElement>(
      '[data-testid="close-tab-button"]'
    )
    if (!closeButton) return false

    closeButton.click()

    return true
  })
  if (!ok) throw new Error('could not locate close button for the spawned tab')
}

describe('Terminal session lifecycle', () => {
  it('increments and decrements active PTY count on new/close tab', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })

    // Baseline: useSessionManager boots with one default session.
    await waitForCount(1, 'default session never became active')

    // Click the SessionTabs "+" button (aria-label="New session" since
    // step 3 replaced TerminalZone's legacy tab-bar).
    await clickBySelector('button[aria-label="New session"]')
    await waitForCount(2, 'new tab did not register a second PTY session')

    // Close the most recently spawned session by finding the close control
    // inside the latest tab. The close button is intentionally hidden from
    // the a11y tree and exposed to tests via data-testid.
    await clickLatestSessionTabCloseButton()

    await waitForCount(1, 'closing the spawned tab did not decrement count')
  })
})
