// cspell:ignore ghostty
export {}

const ESCAPE_SEQUENCE_TIMEOUT_MS = 15_000
const NARROW_TERMINAL_WIDTH_PX = 360
const MAX_NARROW_PROMPT_COLS = 60

interface GhosttyViewportMetrics {
  readonly cursorVisible: boolean
  readonly firstNonEmptyRowIndex: number | null
  readonly firstNonEmptyRowText: string
  readonly hasHorizontalOverflow: boolean
  readonly rootScrollTop: number
  readonly viewportRowsMatchPty: boolean
}

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

const assertNativeGhosttyBuild = async (): Promise<void> => {
  const config = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.getTerminalRendererConfig() ?? null
  )

  expect(config).toEqual({
    terminalRenderer: 'ghostty',
    ghosttyRenderStateDriverProvider: 'native',
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

const readTerminalSize = async (): Promise<{
  readonly cols: number
  readonly rows: number
} | null> =>
  browser.execute(
    () => window.__VIMEFLOW_E2E__?.getVisibleTerminalSize() ?? null
  )

const waitForGhosttyRenderer = async (): Promise<void> => {
  const pane = await $('[data-testid="terminal-pane"]')
  await pane.waitForDisplayed({ timeout: 20_000 })

  await browser
    .waitUntil(
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
    .catch(async () => {
      const diagnostic = await browser.execute(() => {
        const visiblePane = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="terminal-pane"]'
          )
        ).find((element) => {
          const rect = element.getBoundingClientRect()

          return rect.width > 0 && rect.height > 0
        })

        return visiblePane?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      })

      throw new Error(
        `Ghostty renderer root was not mounted; terminal pane text: ${diagnostic}`
      )
    })
}

const waitForGhosttyPrompt = async (): Promise<void> => {
  await browser.waitUntil(
    async () => (await readTerminalBuffer()).trim().length > 0,
    { timeout: 20_000, timeoutMsg: 'Ghostty PTY never produced a prompt' }
  )
}

const setTerminalContentWidth = async (width: number | null): Promise<void> => {
  await browser.execute((nextWidth: number | null) => {
    const content = document.querySelector<HTMLElement>(
      '[data-testid="terminal-content"]'
    )

    if (!content) {
      return
    }

    content.style.width = nextWidth === null ? '' : `${nextWidth}px`
  }, width)
}

const waitForTerminalColsAtMost = async (maxCols: number): Promise<number> => {
  let cols = 0

  await browser.waitUntil(
    async () => {
      cols = (await readTerminalSize())?.cols ?? 0

      return cols > 3 && cols <= maxCols
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: `Ghostty pane did not settle at or below ${maxCols} columns`,
    }
  )

  return cols
}

const waitForTerminalBufferToSettle = async (): Promise<void> => {
  let lastBuffer = await readTerminalBuffer()
  let stableSince = Date.now()

  await browser.waitUntil(
    async () => {
      const nextBuffer = await readTerminalBuffer()

      if (nextBuffer !== lastBuffer) {
        lastBuffer = nextBuffer
        stableSince = Date.now()

        return false
      }

      return Date.now() - stableSince >= 500
    },
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'Ghostty terminal buffer did not settle after resize',
    }
  )
}

const waitForTerminalBufferContaining = async (
  marker: string,
  description: string
): Promise<void> => {
  await browser
    .waitUntil(
      async () => {
        const buffer = await readTerminalBuffer()

        return buffer.includes(marker)
      },
      {
        timeout: ESCAPE_SEQUENCE_TIMEOUT_MS,
        interval: 100,
      }
    )
    .catch(async () => {
      const finalBuffer = await readTerminalBuffer()

      throw new Error(
        `${description}; final visible buffer: ${JSON.stringify(finalBuffer)}`
      )
    })
}

const readGhosttyViewportMetrics = async (): Promise<GhosttyViewportMetrics> =>
  browser.execute(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-terminal-renderer="ghostty"]'
    )
    const output = root?.querySelector<HTMLElement>('pre') ?? null
    const cursorMarker =
      root?.querySelector<HTMLElement>(
        '[data-terminal-cursor-marker="true"]'
      ) ?? null
    const rows = Array.from(
      root?.querySelectorAll<HTMLElement>('[data-terminal-row="true"]') ?? []
    )
    const firstNonEmptyRowIndex = rows.findIndex(
      (row) => (row.textContent ?? '').trim().length > 0
    )
    const overflowTolerance = 1

    if (!root || !output || !cursorMarker) {
      return {
        cursorVisible: false,
        firstNonEmptyRowIndex:
          firstNonEmptyRowIndex === -1 ? null : firstNonEmptyRowIndex,
        firstNonEmptyRowText:
          firstNonEmptyRowIndex === -1
            ? ''
            : (rows[firstNonEmptyRowIndex]?.textContent ?? ''),
        hasHorizontalOverflow: true,
        rootScrollTop: 0,
        viewportRowsMatchPty: false,
      }
    }

    const rootRect = root.getBoundingClientRect()
    const cursorRect = cursorMarker.getBoundingClientRect()
    const readPixels = (value: string): number => {
      const parsed = Number.parseFloat(value)

      return Number.isFinite(parsed) ? parsed : 0
    }

    const lineHeight = readPixels(
      root.style.getPropertyValue('--terminal-line-height')
    )
    const ptyViewportHeight = readPixels(
      root.style.getPropertyValue('--terminal-pty-viewport-height')
    )
    const viewportRowsMatchPty =
      lineHeight > 0 &&
      ptyViewportHeight > 0 &&
      root.clientHeight + overflowTolerance >= ptyViewportHeight &&
      root.clientHeight < ptyViewportHeight + lineHeight

    return {
      cursorVisible:
        cursorRect.top >= rootRect.top && cursorRect.bottom <= rootRect.bottom,
      firstNonEmptyRowIndex:
        firstNonEmptyRowIndex === -1 ? null : firstNonEmptyRowIndex,
      firstNonEmptyRowText:
        firstNonEmptyRowIndex === -1
          ? ''
          : (rows[firstNonEmptyRowIndex]?.textContent ?? ''),
      hasHorizontalOverflow:
        root.scrollWidth - root.clientWidth > overflowTolerance ||
        output.scrollWidth - output.clientWidth > overflowTolerance,
      rootScrollTop: root.scrollTop,
      viewportRowsMatchPty,
    }
  })

const expectGhosttyViewportHealthy = (
  metrics: GhosttyViewportMetrics
): void => {
  expect(metrics.cursorVisible).toBe(true)
  expect(metrics.hasHorizontalOverflow).toBe(false)
  expect(metrics.viewportRowsMatchPty).toBe(true)
}

describe('Ghostty native render-state smoke', () => {
  let narrowTerminalCols = 0

  before(async () => {
    await waitForE2eBridge()
    await assertNativeGhosttyBuild()
    await waitForGhosttyRenderer()
    await waitForGhosttyPrompt()
    await setTerminalContentWidth(NARROW_TERMINAL_WIDTH_PX)
    narrowTerminalCols = await waitForTerminalColsAtMost(MAX_NARROW_PROMPT_COLS)
    await waitForTerminalBufferToSettle()
  })

  after(async () => {
    await setTerminalContentWidth(null)
  })

  it('wraps native output without horizontal overflow', async () => {
    await waitForTerminalBufferToSettle()
    const marker = `gn-${Date.now().toString(36)}`
    const prompt = 'native$ '
    const longInput = 'x'.repeat(narrowTerminalCols * 2 + 3)

    await writeOutputToVisibleTerminal(
      `\x1b[2J\x1b[1;1H${prompt}${longInput}\n${marker}`
    )

    await waitForTerminalBufferContaining(
      marker,
      `Ghostty native marker ${marker} never appeared in the terminal buffer`
    )

    const buffer = await readTerminalBuffer()
    const metrics = await readGhosttyViewportMetrics()

    expect(buffer).toContain(
      `${prompt}${'x'.repeat(narrowTerminalCols - prompt.length)}`
    )
    expect(buffer).toContain('\n')
    expect(buffer).toContain(marker)
    expect(buffer).not.toContain('\x1b')
    expectGhosttyViewportHealthy(metrics)
  })

  it('keeps clear-screen output at the viewport top', async () => {
    await waitForTerminalBufferToSettle()
    const prompt = 'native-clear$ '

    await writeOutputToVisibleTerminal(
      `before clear\n\x1b[2J\x1b[1;1H${prompt}`
    )

    await waitForTerminalBufferContaining(prompt, 'Ghostty native prompt')

    const metrics = await readGhosttyViewportMetrics()

    expect(metrics.firstNonEmptyRowIndex).toBe(0)
    expect(metrics.firstNonEmptyRowText).toContain(prompt)
    expect(metrics.rootScrollTop).toBe(0)
    expectGhosttyViewportHealthy(metrics)
  })

  it('keeps the cursor visible after blank-line scrolling', async () => {
    await waitForTerminalBufferToSettle()
    const rows = (await readTerminalSize())?.rows ?? 6
    const marker = `bottom-${Date.now()}`

    await writeOutputToVisibleTerminal(
      `\x1b[2J\x1b[1;1Hnative-bottom$ ${'\n'.repeat(rows + 3)}${marker}`
    )

    await waitForTerminalBufferContaining(
      marker,
      'Ghostty native blank-line marker never became visible'
    )

    const metrics = await readGhosttyViewportMetrics()

    expectGhosttyViewportHealthy(metrics)
  })

  it('keeps repeated prompt cursors inside the fitted PTY viewport', async () => {
    await waitForTerminalBufferToSettle()
    const rows = (await readTerminalSize())?.rows ?? 6
    const prompt = 'native-active$ '

    await writeOutputToVisibleTerminal(
      `\x1b[2J\x1b[1;1H${Array.from({ length: rows + 4 }, () => prompt).join(
        '\n'
      )}`
    )

    await waitForTerminalBufferContaining(prompt, 'Ghostty native prompt rows')

    const metrics = await readGhosttyViewportMetrics()

    expectGhosttyViewportHealthy(metrics)
  })
})
