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

const switchToLayout = async (
  menuLabel: string,
  pillLabel = menuLabel
): Promise<void> => {
  const clickedVisiblePill = await browser.execute((layoutLabel: string) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${layoutLabel}"]`
    )
    if (button === null) {
      return false
    }

    button.click()

    return true
  }, pillLabel)

  if (clickedVisiblePill) {
    return
  }

  await clickBySelector('button[aria-label="Configure displayed layouts"]')

  const revealed = await browser.execute((layoutLabel: string) => {
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')
    ).find((candidate) => (candidate.textContent ?? '').includes(layoutLabel))

    if (row === undefined) {
      return false
    }

    if (row.getAttribute('aria-checked') !== 'true') {
      row.click()
    }

    return true
  }, menuLabel)

  if (!revealed) {
    throw new Error(`layout display menu had no ${menuLabel} row`)
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
        (layoutLabel: string) =>
          document.querySelector(`button[aria-label="${layoutLabel}"]`) !==
          null,
        pillLabel
      ),
    {
      timeout: 3_000,
      interval: 100,
      timeoutMsg: `${pillLabel} layout pill did not become visible`,
    }
  )

  await clickBySelector(`button[aria-label="${pillLabel}"]`)
}

describe('Pane lifecycle split focus', () => {
  it('keeps the workspace visible when focusing between added split panes', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })

    await switchToLayout('Vertical split')

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

    await clickBySelector('button[aria-label="add shell pane"]')
    await waitForPaneCount(2)

    await clickBySelector('[data-testid="split-view-slot"][data-pane-id="p0"]')
    await assertWorkspaceVisible(2, 'focusing p0')

    await clickBySelector('[data-testid="split-view-slot"][data-pane-id="p1"]')
    await assertWorkspaceVisible(2, 'focusing p1')

    await switchToLayout('Single', 'Focus active pane')
    await waitForPaneCount(1)
    await assertWorkspaceVisible(1, 'switching to single layout')
    await assertVisiblePaneIds(['p1'])
  })
})
