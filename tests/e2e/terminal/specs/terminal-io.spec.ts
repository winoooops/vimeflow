import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

describe('Terminal I/O', () => {
  it('types a marker into the terminal and sees it echoed back', async () => {
    const pane = await $('[data-testid="terminal-pane"]')
    await pane.waitForDisplayed({ timeout: 20_000 })

    // Wait for a prompt so we know the PTY is ready.
    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        return buf.trim().length > 0
      },
      { timeout: 20_000, timeoutMsg: 'PTY never produced a prompt' }
    )

    // Unique marker avoids matching the shell prompt or other noise.
    const marker = `__VIMEFLOW_E2E_${Date.now()}__`
    await typeInActiveTerminal(`echo ${marker}`)
    await pressEnterInActiveTerminal()

    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        // Expect the echoed marker to appear on its own line (not just the
        // typed-in command echo).
        const occurrences = buf.split(marker).length - 1
        return occurrences >= 2
      },
      {
        timeout: 15_000,
        timeoutMsg: `marker '${marker}' never echoed as shell output`,
      }
    )
  })
})
