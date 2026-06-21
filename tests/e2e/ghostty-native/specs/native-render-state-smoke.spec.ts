// cspell:ignore ghostty
export {}

const ESCAPE_SEQUENCE_TIMEOUT_MS = 15_000
const NARROW_TERMINAL_WIDTH_PX = 360
const MAX_NARROW_PROMPT_COLS = 60
const TRUE_COLOR_PINK = ['rgb', '(243, 139, 168)'].join('')
const NERD_FONT_PROMPT_ICON = String.fromCodePoint(0xf0954)

interface GhosttyViewportMetrics {
  readonly cursorAnimationName: string
  readonly cursorHeight: number
  readonly cursorVisible: boolean
  readonly cursorWidth: number
  readonly firstNonEmptyRowIndex: number | null
  readonly firstNonEmptyRowText: string
  readonly hasHorizontalOverflow: boolean
  readonly rootScrollTop: number
  readonly symbolFontReady: boolean
  readonly viewportRowsMatchPty: boolean
}

interface GhosttyStyleRun {
  readonly color: string
  readonly text: string
}

interface BackendPtyEventBridgeProbeResult {
  readonly error?: string
  readonly events: readonly string[]
  readonly sessionId: string
}

interface E2eBackendBridge {
  readonly invoke: (
    command: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>
  readonly listen: <TPayload>(
    event: string,
    callback: (payload: TPayload) => void
  ) => Promise<() => void>
}

interface E2eBackendWindow extends Window {
  readonly vimeflow?: E2eBackendBridge
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

const startRecordingPtyDataEvents = async (): Promise<void> => {
  await browser.execute(
    async () => await window.__VIMEFLOW_E2E__?.startRecordingPtyDataEvents()
  )
}

const clearRecordedPtyDataEvents = async (): Promise<void> => {
  await browser.execute(() =>
    window.__VIMEFLOW_E2E__?.clearRecordedPtyDataEvents()
  )
}

const readRecordedPtyDataEvents = async (): Promise<
  readonly VimeflowE2ePtyDataEvent[]
> =>
  browser.execute(
    () => window.__VIMEFLOW_E2E__?.getRecordedPtyDataEvents() ?? []
  )

const probeBackendPtyEventBridge =
  async (): Promise<BackendPtyEventBridgeProbeResult> =>
    browser.execute(async () => {
      const bridge = (window as E2eBackendWindow).vimeflow
      const sessionId = `native-probe-${Date.now().toString(36)}`
      const marker = `${sessionId}-ok`
      const events: string[] = []
      let unlisten: (() => void) | null = null

      if (!bridge) {
        return {
          error: 'window.vimeflow bridge was unavailable',
          events,
          sessionId,
        }
      }

      try {
        unlisten = await bridge.listen<{
          readonly data: string
          readonly sessionId: string
        }>('pty-data', (payload) => {
          if (payload.sessionId === sessionId) {
            events.push(payload.data)
          }
        })

        await bridge.invoke('spawn_pty', {
          request: {
            cwd: '~',
            enableAgentBridge: false,
            env: null,
            ephemeral: true,
            sessionId,
            shell: null,
          },
        })

        await bridge.invoke('write_pty', {
          request: {
            data: `printf '${marker}\\n'\n`,
            sessionId,
          },
        })

        const deadline = Date.now() + 5_000
        while (
          Date.now() < deadline &&
          !events.some((event) => event.includes(marker))
        ) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 50)
          })
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          events,
          sessionId,
        }
      } finally {
        unlisten?.()
        await bridge
          .invoke('kill_pty', {
            request: {
              sessionId,
            },
          })
          .catch(() => undefined)
      }

      return { events, sessionId }
    })

const readTerminalBuffer = async (): Promise<string> =>
  browser.execute(() => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? '')

const selectAllVisibleTerminal = async (): Promise<void> => {
  const didSelect = await browser.execute(
    () => window.__VIMEFLOW_E2E__?.selectAllVisibleTerminal() ?? false
  )

  if (!didSelect) {
    throw new Error('visible terminal selection was unavailable for e2e')
  }
}

const readVisibleTerminalSelection = async (): Promise<string> =>
  browser.execute(
    () => window.__VIMEFLOW_E2E__?.getVisibleTerminalSelection() ?? ''
  )

const withoutVisualRowBreaks = (buffer: string): string =>
  buffer.replace(/\n/g, '')

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

const focusGhosttyRenderer = async (): Promise<void> => {
  const renderer = await $('[data-terminal-renderer="ghostty"]')

  await renderer.click()
  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const activeElement = document.activeElement

        return (
          activeElement instanceof HTMLTextAreaElement &&
          activeElement.getAttribute('aria-label') === 'Terminal input'
        )
      }),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'Ghostty terminal input did not receive focus after click',
    }
  )
}

const sendInputThroughGhosttyInput = async (text: string): Promise<void> => {
  const didSend = await browser.execute((payload: string) => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-terminal-renderer="ghostty"] textarea[aria-label="Terminal input"]'
    )

    if (!input) {
      return false
    }

    input.focus()

    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', payload)

    input.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      })
    )

    return true
  }, text)

  if (!didSend) {
    throw new Error('Ghostty terminal input textarea was unavailable')
  }
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

const waitForGhosttyShellReady = async (): Promise<void> => {
  const marker = `native-ready-${Date.now().toString(36)}`
  let lastProbeAt = 0

  await startRecordingPtyDataEvents()
  await clearRecordedPtyDataEvents()

  await browser
    .waitUntil(
      async () => {
        if ((await readTerminalBuffer()).includes(marker)) {
          return true
        }

        const now = Date.now()
        if (now - lastProbeAt < 500) {
          return false
        }

        lastProbeAt = now
        await sendInputThroughGhosttyInput(
          `printf '\\033[2J\\033[1;1H${marker}\\n'\r`
        )

        return false
      },
      {
        timeout: 20_000,
        interval: 100,
      }
    )
    .catch(async () => {
      const finalBuffer = await readTerminalBuffer()
      const activePtys = await browser.execute(
        async () => await window.__VIMEFLOW_E2E__?.listActivePtySessions()
      )
      const registeredPtys = await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getActiveSessionIds() ?? []
      )
      const ptyEvents = await readRecordedPtyDataEvents()
      const eventSummary = ptyEvents.map((event) => ({
        byteLen: event.byteLen,
        data: event.data,
        offsetStart: event.offsetStart,
        sessionId: event.sessionId,
      }))
      const backendProbe = await probeBackendPtyEventBridge()

      throw new Error(
        'Ghostty PTY did not echo the startup readiness probe; ' +
          `backend PTYs: ${JSON.stringify(activePtys ?? [])}; ` +
          `registered PTYs: ${JSON.stringify(registeredPtys)}; ` +
          `pty events: ${JSON.stringify(eventSummary)}; ` +
          `backend probe: ${JSON.stringify(backendProbe)}; ` +
          `final visible buffer: ${JSON.stringify(finalBuffer)}`
      )
    })
}

const pasteTextIntoGhosttyInput = sendInputThroughGhosttyInput

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
        cursorAnimationName: '',
        cursorHeight: 0,
        cursorVisible: false,
        cursorWidth: 0,
        firstNonEmptyRowIndex:
          firstNonEmptyRowIndex === -1 ? null : firstNonEmptyRowIndex,
        firstNonEmptyRowText:
          firstNonEmptyRowIndex === -1
            ? ''
            : (rows[firstNonEmptyRowIndex]?.textContent ?? ''),
        hasHorizontalOverflow: true,
        rootScrollTop: 0,
        symbolFontReady: false,
        viewportRowsMatchPty: false,
      }
    }

    const rootRect = root.getBoundingClientRect()
    const cursorRect = cursorMarker.getBoundingClientRect()
    const cursorStyle = window.getComputedStyle(cursorMarker)
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

    const symbolFontReady =
      document.fonts?.check(
        '14px "Vimeflow Nerd Symbols"',
        String.fromCodePoint(0xf0954)
      ) ?? true

    return {
      cursorAnimationName: cursorStyle.animationName,
      cursorHeight: cursorRect.height,
      cursorVisible:
        cursorRect.top >= rootRect.top && cursorRect.bottom <= rootRect.bottom,
      cursorWidth: cursorRect.width,
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
      symbolFontReady,
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
    await focusGhosttyRenderer()
    await waitForGhosttyShellReady()
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

  it('renders ANSI color, Nerd Font glyphs, and a block cursor with native snapshots', async () => {
    await waitForTerminalBufferToSettle()
    const marker = `native-style-${Date.now().toString(36)}`
    const prompt = `${'x'.repeat(
      Math.max(1, narrowTerminalCols - marker.length - 6)
    )}${NERD_FONT_PROMPT_ICON}> `

    await writeOutputToVisibleTerminal(
      `\x1b[2J\x1b[1;1H\x1b[38;2;243;139;168m${marker}\x1b[0m ${prompt}`
    )

    await waitForTerminalBufferContaining(
      NERD_FONT_PROMPT_ICON,
      'Ghostty native Nerd Font prompt icon never appeared'
    )

    const buffer = await readTerminalBuffer()
    const styleRuns = await readGhosttyStyleRuns()
    const metrics = await readGhosttyViewportMetrics()

    expect(buffer).toContain(marker)
    expect(buffer).toContain(NERD_FONT_PROMPT_ICON)
    expect(buffer).not.toContain('\x1b')
    expect(
      styleRuns.some(
        (run) => run.text.includes(marker) && run.color === TRUE_COLOR_PINK
      )
    ).toBe(true)
    expect(metrics.cursorAnimationName).toBe('vfTerminalCursorBlink')
    expect(metrics.cursorWidth).toBeGreaterThan(4)
    expect(metrics.cursorHeight).toBeGreaterThan(10)
    expect(metrics.symbolFontReady).toBe(true)
    expectGhosttyViewportHealthy(metrics)
  })

  it('copies interpreted native snapshot text without viewport filler rows', async () => {
    await waitForTerminalBufferToSettle()
    const prompt = `native-select-${Date.now().toString(36)}$ `

    await writeOutputToVisibleTerminal(`\x1b[2J\x1b[1;1H${prompt}`)

    await waitForTerminalBufferContaining(
      prompt,
      'Ghostty native selectable prompt never appeared'
    )
    await selectAllVisibleTerminal()

    const buffer = await readTerminalBuffer()
    const selection = await readVisibleTerminalSelection()
    const metrics = await readGhosttyViewportMetrics()

    expect(buffer).toBe(prompt)
    expect(selection).toBe(prompt)
    expect(selection).not.toContain('\n')
    expectGhosttyViewportHealthy(metrics)
  })

  it('runs common POSIX commands through native stdin, stdout, and stderr', async () => {
    await waitForTerminalBufferToSettle()
    const marker = `native-posix-${Date.now().toString(36)}`
    const stdinPayload = `stdin-${marker}`

    await sendInputThroughGhosttyInput(
      [
        "printf '\\033[2J\\033[1;1H'",
        `printf '${marker}:pwd:%s\\n' "$(pwd)"`,
        `printf '${marker}:uname:%s\\n' "$(uname -s)"`,
        `printf '${marker}:stdout\\n'`,
        `printf '${marker}:stderr\\n' 1>&2`,
        'read vf_m4_line',
        `printf '${marker}:stdin:%s\\n' "$vf_m4_line"`,
        `printf '${marker}:done\\n'`,
      ].join('; ') + '\r'
    )
    await sendInputThroughGhosttyInput(`${stdinPayload}\r`)

    await waitForTerminalBufferContaining(
      `${marker}:done`,
      'Ghostty native POSIX command sequence did not finish'
    )

    const buffer = await readTerminalBuffer()
    const unwrappedBuffer = withoutVisualRowBreaks(buffer)
    const metrics = await readGhosttyViewportMetrics()

    expect(unwrappedBuffer).toContain(`${marker}:pwd:/`)
    expect(unwrappedBuffer).toMatch(
      new RegExp(`${marker}:uname:(Darwin|Linux)`)
    )
    expect(unwrappedBuffer).toContain(`${marker}:stdout`)
    expect(unwrappedBuffer).toContain(`${marker}:stderr`)
    expect(unwrappedBuffer).toContain(`${marker}:stdin:${stdinPayload}`)
    expect(buffer).not.toContain('\x1b')
    expect(metrics.firstNonEmptyRowIndex).toBe(0)
    expect(metrics.firstNonEmptyRowText).toContain(`${marker}:pwd:`)
    expectGhosttyViewportHealthy(metrics)
  })

  it('keeps POSIX command output soft-wrapped inside the native pane width', async () => {
    await waitForTerminalBufferToSettle()
    const marker = `native-wrap-${Date.now().toString(36)}`
    const repeatedCells = narrowTerminalCols * 4 + 7

    await sendInputThroughGhosttyInput(
      [
        "printf '\\033[2J\\033[1;1H'",
        `printf '${marker}:wrap:'`,
        'i=0',
        `while [ "$i" -lt ${repeatedCells} ]; do printf x; i=$((i + 1)); done`,
        `printf '\\n${marker}:done\\n'`,
      ].join('; ') + '\r'
    )

    await waitForTerminalBufferContaining(
      `${marker}:done`,
      'Ghostty native wrapping command did not finish'
    )

    const buffer = await readTerminalBuffer()
    const metrics = await readGhosttyViewportMetrics()

    expect(buffer).toContain(`${marker}:wrap:`)
    expect(buffer).toContain(`${marker}:done`)
    expect(buffer).toContain('x'.repeat(narrowTerminalCols))
    expectGhosttyViewportHealthy(metrics)
  })

  it('routes paste events into shell stdin on the native renderer', async () => {
    await waitForTerminalBufferToSettle()
    const marker = `native-paste-${Date.now().toString(36)}`
    const pastePayload = `paste-${marker}`

    await sendInputThroughGhosttyInput(
      [
        "printf '\\033[2J\\033[1;1H'",
        'read vf_m4_paste',
        `printf '${marker}:paste:%s\\n' "$vf_m4_paste"`,
        `printf '${marker}:done\\n'`,
      ].join('; ') + '\r'
    )

    await pasteTextIntoGhosttyInput(`${pastePayload}\r`)

    await waitForTerminalBufferContaining(
      `${marker}:done`,
      'Ghostty native paste command did not finish'
    )

    const buffer = await readTerminalBuffer()
    const unwrappedBuffer = withoutVisualRowBreaks(buffer)
    const metrics = await readGhosttyViewportMetrics()

    expect(unwrappedBuffer).toContain(`${marker}:paste:${pastePayload}`)
    expectGhosttyViewportHealthy(metrics)
  })
})
