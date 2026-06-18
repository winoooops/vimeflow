// cspell:ignore ghostty
const ESCAPE_SEQUENCE_TIMEOUT_MS = 15_000
const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')

const waitForE2eBridge = async (): Promise<void> => {
  await browser
    .waitUntil(
      async () =>
        await browser.execute(
          () => typeof window.__VIMEFLOW_E2E__ !== 'undefined'
        ),
      { timeout: 20_000, interval: 250 }
    )
    .catch(() => {
      throw new Error(
        'window.__VIMEFLOW_E2E__ missing; rebuild with VITE_E2E=1'
      )
    })
}

const writeOutputToVisibleTerminal = async (data: string): Promise<void> => {
  const didWrite = await browser.execute(
    (payload: string) =>
      window.__VIMEFLOW_E2E__?.writeOutputToVisibleTerminal(payload) ?? false,
    data
  )

  if (!didWrite) {
    throw new Error('visible terminal renderer was unavailable for e2e output')
  }
}

const readTerminalBuffer = async (): Promise<string> =>
  browser.execute(() => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? '')

const hasGhosttyCursor = async (): Promise<boolean> =>
  browser.execute(
    () =>
      document.querySelector(
        '[data-terminal-renderer="ghostty"] [data-terminal-cursor="true"]'
      ) !== null
  )

interface GhosttyStyleRun {
  readonly color: string
  readonly text: string
}

const readGhosttyStyleRuns = async (): Promise<readonly GhosttyStyleRun[]> =>
  browser.execute(() =>
    Array.from(
      document.querySelectorAll(
        '[data-terminal-renderer="ghostty"] [data-terminal-style-run="true"]'
      )
    ).map((element) => ({
      color: (element as HTMLElement).style.color,
      text: element.textContent ?? '',
    }))
  )

describe('Ghostty renderer smoke', () => {
  before(async () => {
    await waitForE2eBridge()
  })

  it('boots the Ghostty adapter and strips zsh-style OSC/CSI controls', async () => {
    const pane = await $('[data-testid="terminal-pane"]')
    await pane.waitForDisplayed({ timeout: 20_000 })

    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelector('[data-terminal-renderer="ghostty"]') !==
            null
        ),
      {
        timeout: 20_000,
        timeoutMsg:
          'Ghostty renderer root was not mounted; rebuild with VITE_TERMINAL_RENDERER=ghostty',
      }
    )

    await browser.waitUntil(hasGhosttyCursor, {
      timeout: 20_000,
      timeoutMsg: 'Ghostty renderer did not mount a visible cursor marker',
    })

    await browser.waitUntil(
      async () => (await readTerminalBuffer()).trim().length > 0,
      { timeout: 20_000, timeoutMsg: 'Ghostty PTY never produced a prompt' }
    )

    const marker = `GHOSTTY_E2E_${Date.now()}`
    const progressText = 'Start'
    const progressRewrite = 'S\x1b[1DSt\x1b[2DSta\x1b[3DStart'

    await writeOutputToVisibleTerminal(
      `\x1b[H\x1b[2J${progressRewrite} ` +
        `\x1b]2;ghostty-e2e\x07\x1b[38;2;243;139;168m${marker}\x1b[0m\n`
    )

    await browser.waitUntil(
      async () => (await readTerminalBuffer()).includes(marker),
      {
        timeout: ESCAPE_SEQUENCE_TIMEOUT_MS,
        timeoutMsg: `Ghostty marker ${marker} never appeared in the terminal buffer`,
      }
    )

    const buffer = await readTerminalBuffer()

    expect(buffer).toContain(marker)
    expect(buffer).toContain(`${progressText} ${marker}`)
    expect(buffer).not.toContain('SStSta')
    expect(buffer).not.toContain('\x1b')
    expect(buffer).not.toContain(']2;ghostty-e2e')
    expect(buffer).not.toContain('[38;2;243;139;168m')
    expect(buffer).not.toContain('[0m')
    expect(await hasGhosttyCursor()).toBe(true)

    const styleRuns = await readGhosttyStyleRuns()

    expect(
      styleRuns.some(
        (run) => run.text.includes(marker) && run.color === TRUE_COLOR_PINK
      )
    ).toBe(true)
  })
})
