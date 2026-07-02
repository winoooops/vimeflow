import { createNewSession } from '../../shared/actions.js'

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

const removeLatestSessionRow = async (): Promise<void> => {
  const opened = await browser.execute(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="session-row"]')
    )
    const latestRow = rows[rows.length - 1]
    const actionsButton = latestRow?.querySelector<HTMLButtonElement>(
      'button[aria-label="Session actions"]'
    )
    if (!actionsButton) return false

    actionsButton.click()

    return true
  })

  if (!opened) {
    throw new Error('could not open actions menu for the spawned session')
  }

  await browser.waitUntil(
    async () =>
      await browser.execute(() =>
        Array.from(document.querySelectorAll('button')).some(
          (button) => button.textContent?.trim().includes('Remove') ?? false
        )
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'could not locate remove action for the spawned session',
    }
  )

  await browser.execute(() => {
    const removeButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim().includes('Remove') ?? false
    )
    removeButton?.click()
  })
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

    await createNewSession()
    await waitForCount(2, 'new tab did not register a second PTY session')

    await removeLatestSessionRow()

    await waitForCount(1, 'closing the spawned tab did not decrement count')
  })
})
