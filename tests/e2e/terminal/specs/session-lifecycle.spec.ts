import { createNewSessionWithDefaults } from '../../shared/actions.js'

const commandPaletteSelector = '[role="dialog"][aria-label="Command palette"]'
const commandPaletteInputSelector = '[aria-label="Command palette search"]'
const enterKey = '\uE007'

const readRustSessionIds = async (): Promise<string[]> => {
  const ids = await browser.execute(
    async () => (await window.__VIMEFLOW_E2E__?.listActivePtySessions()) ?? []
  )

  return ids
}

const readVisiblePtyId = async (): Promise<string | null> =>
  browser.execute(() => window.__VIMEFLOW_E2E__?.getVisiblePtyId() ?? null)

const waitForVisiblePtyId = async (
  timeoutMsg: string,
  predicate: (ptyId: string) => boolean = () => true
): Promise<string> => {
  let matchedPtyId: string | null = null

  await browser.waitUntil(
    async () => {
      const visiblePtyId = await readVisiblePtyId()
      if (!visiblePtyId || !predicate(visiblePtyId)) {
        return false
      }

      matchedPtyId = visiblePtyId

      return true
    },
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg,
    }
  )

  if (matchedPtyId === null) {
    throw new Error(timeoutMsg)
  }

  return matchedPtyId
}

const waitForBackendSession = async (
  ptyId: string,
  timeoutMsg: string
): Promise<void> => {
  await browser.waitUntil(
    async () => (await readRustSessionIds()).includes(ptyId),
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

const closeActiveSession = async (closedPtyId: string): Promise<void> => {
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
  await browser.waitUntil(
    async () => !(await readRustSessionIds()).includes(closedPtyId),
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: 'closing the spawned tab did not kill its PTY',
    }
  )
  await waitForCommandPaletteClosed()
}

describe('Terminal session lifecycle', () => {
  it('increments and decrements active PTY count on new/close tab', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })

    const initialPtyId = await waitForVisiblePtyId(
      'default session never became visible'
    )
    await waitForBackendSession(
      initialPtyId,
      'default session never became active in the backend'
    )

    await createNewSessionWithDefaults()
    const spawnedPtyId = await waitForVisiblePtyId(
      'new tab never became the visible PTY session',
      (ptyId) => ptyId !== initialPtyId
    )
    await waitForBackendSession(
      spawnedPtyId,
      'new tab did not register its PTY in the backend'
    )

    await closeActiveSession(spawnedPtyId)
  })
})
