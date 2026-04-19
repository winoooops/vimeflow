import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const readColsWithTag = async (tag: string): Promise<number | null> => {
  // `echo TAG$(tput cols)END`: only the evaluated line matches /TAG(\d+)END/;
  // the typed-command echo keeps the literal `$(tput cols)` text and has no
  // digits in that slot, so it is ignored by the regex.
  await typeInActiveTerminal(`echo ${tag}$(tput cols)END`)
  await pressEnterInActiveTerminal()
  let captured: number | null = null
  const pattern = new RegExp(`${tag}(\\d+)END`)
  await browser
    .waitUntil(
      async () => {
        const buf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        const match = pattern.exec(buf)
        if (match?.[1]) {
          captured = Number(match[1])
          return true
        }
        return false
      },
      { timeout: 15_000, timeoutMsg: `echo ${tag} never produced a value` }
    )
    .catch(() => undefined)
  return captured
}

describe('Terminal resize', () => {
  it('propagates container resize to the PTY (tput cols changes)', async () => {
    const pane = await $('[data-testid="terminal-pane"]')
    await pane.waitForDisplayed({ timeout: 20_000 })

    // Ensure a prompt is ready before typing.
    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        return buf.trim().length > 0
      },
      { timeout: 20_000, timeoutMsg: 'PTY never produced a prompt' }
    )

    const baselineCols = await readColsWithTag('BASE')
    if (baselineCols === null) {
      throw new Error('failed to read baseline tput cols')
    }
    expect(baselineCols).toBeGreaterThan(0)

    // Halve the terminal-content width. TerminalZone's content area holds
    // the visible pane; constraining it via inline style drives the
    // ResizeObserver → fitAddon → invoke(resize_pty) path.
    await browser.execute(() => {
      const content = document.querySelector<HTMLElement>(
        '[data-testid="terminal-content"]'
      )
      if (content) {
        const r = content.getBoundingClientRect()
        content.style.width = `${Math.max(200, r.width / 2)}px`
      }
    })

    // Wait long enough for ResizeObserver + xterm fit + resize_pty IPC to settle.
    await browser.pause(1500)

    const resizedCols = await readColsWithTag('POST')
    if (resizedCols === null) {
      throw new Error('failed to read tput cols after resize')
    }

    expect(resizedCols).toBeLessThan(baselineCols)

    // Restore so subsequent specs aren't affected if module order changes.
    await browser.execute(() => {
      const content = document.querySelector<HTMLElement>(
        '[data-testid="terminal-content"]'
      )
      if (content) content.style.width = ''
    })
  })
})
