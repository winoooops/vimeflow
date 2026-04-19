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

describe('Terminal session lifecycle', () => {
  it('increments and decrements active PTY count on new/close tab', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })

    // Baseline: useSessionManager boots with one default session.
    await waitForCount(1, 'default session never became active')

    // Click "New tab".
    await clickBySelector('button[aria-label="New tab"]')
    await waitForCount(2, 'new tab did not register a second PTY session')

    // Close the *second* session by its frontend name. useSessionManager
    // auto-names sequential sessions; we target the one whose close button
    // isn't the first (originalaria-label aria-label="Close sess-...").
    const secondCloseLabel = await browser.execute(() => {
      const closeBtns = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Close "]'
        )
      )
      // Return aria-label of the last close button (most recently spawned).
      return closeBtns[closeBtns.length - 1]?.getAttribute('aria-label') ?? null
    })

    if (!secondCloseLabel) {
      throw new Error('could not locate close button for the spawned tab')
    }
    await clickBySelector(`button[aria-label="${secondCloseLabel}"]`)

    await waitForCount(1, 'closing the spawned tab did not decrement count')
  })
})
