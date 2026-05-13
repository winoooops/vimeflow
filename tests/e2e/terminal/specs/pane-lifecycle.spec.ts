import { clickBySelector } from '../../shared/actions.js'

const waitForPaneCount = async (expected: number): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (count: number) =>
          document.querySelectorAll('[data-testid="split-view-slot"]')
            .length === count,
        expected
      ),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `split view did not reach ${expected} panes`,
    }
  )
}

const assertWorkspaceVisible = async (
  expectedPaneCount: number,
  context: string
): Promise<void> => {
  const state = await browser.execute(() => ({
    terminalZone:
      document.querySelector('[data-testid="terminal-zone"]') !== null,
    splitView: document.querySelector('[data-testid="split-view"]') !== null,
    paneCount: document.querySelectorAll('[data-testid="split-view-slot"]')
      .length,
    textLength: document.body.innerText.trim().length,
  }))

  if (
    !state.terminalZone ||
    !state.splitView ||
    state.paneCount !== expectedPaneCount ||
    state.textLength === 0
  ) {
    throw new Error(
      `workspace blanked after ${context}: ${JSON.stringify(state)}`
    )
  }
}

const assertVisiblePaneIds = async (
  expectedPaneIds: readonly string[]
): Promise<void> => {
  const paneIds = await browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-testid="split-view-slot"]')
    ).map((slot) => slot.getAttribute('data-pane-id'))
  )

  if (JSON.stringify(paneIds) !== JSON.stringify(expectedPaneIds)) {
    throw new Error(
      `visible panes mismatch: expected ${JSON.stringify(
        expectedPaneIds
      )}, got ${JSON.stringify(paneIds)}`
    )
  }
}

describe('Pane lifecycle split focus', () => {
  it('keeps the workspace visible when focusing between added split panes', async () => {
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

    await clickBySelector('button[aria-label="add pane"]')
    await waitForPaneCount(2)

    await clickBySelector('[data-testid="split-view-slot"][data-pane-id="p0"]')
    await assertWorkspaceVisible(2, 'focusing p0')

    await clickBySelector('[data-testid="split-view-slot"][data-pane-id="p1"]')
    await assertWorkspaceVisible(2, 'focusing p1')

    await clickBySelector('button[aria-label="Single"]')
    await waitForPaneCount(1)
    await assertWorkspaceVisible(1, 'switching to single layout')
    await assertVisiblePaneIds(['p1'])
  })
})
