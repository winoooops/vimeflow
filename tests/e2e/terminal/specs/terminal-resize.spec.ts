import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const readColsWithTag = async (tag: string): Promise<number> => {
  // Query COLUMNS directly (set by the shell from TIOCGWINSZ, matches what
  // xterm has already negotiated with the PTY). `tput cols` works locally
  // but on CI the TERM env can be empty inside xvfb-run's PTY, making tput
  // emit nothing and collapsing the substitution to `echo TAGEND`.
  // `echo TAG${COLUMNS}END`: only the evaluated line has digits; the
  // typed-command echo keeps `${COLUMNS}` literal.
  await typeInActiveTerminal(`echo ${tag}\${COLUMNS}END`)
  await pressEnterInActiveTerminal()
  let captured: number | null = null
  let lastBuf = ''
  const pattern = new RegExp(`${tag}(\\d+)END`)
  await browser
    .waitUntil(
      async () => {
        lastBuf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        const match = pattern.exec(lastBuf)
        if (match?.[1]) {
          captured = Number(match[1])
          return true
        }
        return false
      },
      { timeout: 30_000, interval: 500 }
    )
    .catch(() => undefined)
  if (captured === null) {
    const tail = lastBuf.slice(-600).replace(/\s+/g, ' ')
    throw new Error(
      `echo ${tag} never produced a numeric value. buffer tail: <${tail}>`
    )
  }

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
