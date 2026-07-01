import { createNewSessionWithDefaults } from '../../shared/actions.js'

const commandPaletteSelector = '[role="dialog"][aria-label="Command palette"]'
const commandPaletteInputSelector = '[aria-label="Command palette search"]'
const enterKey = '\uE007'

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

const closeActiveSession = async (): Promise<void> => {
  await dispatchCommandPaletteShortcut()
  await (
    await $(commandPaletteSelector)
  ).waitForDisplayed({
    timeout: 3_000,
  })

  const input = await $(commandPaletteInputSelector)
  await input.waitForDisplayed({ timeout: 3_000 })
  await input.setValue(':close')
  await browser.execute((selector: string) => {
    document.querySelector<HTMLInputElement>(selector)?.focus()
  }, commandPaletteInputSelector)
  await browser.action('key').down(enterKey).up(enterKey).perform()
  await browser.waitUntil(async () => (await readRustSessionCount()) === 1, {
    timeout: 15_000,
    interval: 500,
    timeoutMsg: 'closing the spawned tab did not decrement count',
  })
  await waitForCommandPaletteClosed()
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

    await createNewSessionWithDefaults()
    await waitForCount(2, 'new tab did not register a second PTY session')

    await closeActiveSession()
  })
})
