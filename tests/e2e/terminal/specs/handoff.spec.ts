// cspell:ignore Ghostty ghostty
// Not a test: an automated STAGE-SETTER. It builds the exact reproduction
// environment (wide window, sidebars hidden, vertical split, a colored
// Claude Code in each pane) and then holds the app open so a human can take
// over the very same instance for a recorded demo — eliminating every
// "your environment differs from mine" gap in one move.

const COMPOSER_MARKER = 'manual mode'

const readGrid = async (ptyId: string): Promise<string> =>
  (await browser.execute(
    async (id: string) =>
      (await window.__VIMEFLOW_E2E__?.readGhosttyGrid(id)) ?? '',
    ptyId
  )) ?? ''

const writePty = async (ptyId: string, data: string): Promise<void> => {
  await browser.execute(
    async (id: string, payload: string) => {
      await window.__VIMEFLOW_E2E__?.invokeBackend('write_pty', {
        request: { sessionId: id, data: payload },
      })
    },
    ptyId,
    data
  )
}

const pressShortcut = async (code: string, key: string): Promise<void> => {
  await browser.execute(
    (keyCode: string, keyChar: string) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: keyChar,
          code: keyCode,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    },
    code,
    key
  )
}

const slotCount = async (): Promise<number> =>
  await browser.execute(
    () => document.querySelectorAll('[data-testid="split-view-slot"]').length
  )

const startAgent = async (ptyId: string): Promise<void> => {
  await writePty(ptyId, 'claude\r')

  let trusted = false
  await browser.waitUntil(
    async () => {
      const grid = await readGrid(ptyId)
      if (grid.includes(COMPOSER_MARKER) || grid.includes('bypass')) {
        return true
      }

      if (!trusted && grid.includes('trust this folder')) {
        trusted = true
        await writePty(ptyId, '\r')
      }

      return false
    },
    {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: `agent never became ready in ${ptyId}`,
    }
  )
}

describe('handoff stage', () => {
  before(function () {
    // Not a test: this holds the app open for half an hour so a human can
    // take over the exact automated environment. Only an explicit opt-in
    // may run it — never CI, never a full local spec sweep.
    if (
      process.env.VIMEFLOW_E2E_HANDOFF !== '1' ||
      process.platform !== 'darwin' ||
      process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT !== '1'
    ) {
      this.skip()
    }
  })

  it('prepares two colored agents and holds the app for a human', async function () {
    // The hold IS the point — disable Mocha's timeout for this test.
    this.timeout(0)

    await browser.electron.execute((electron: typeof import('electron')) => {
      const win = electron.BrowserWindow.getAllWindows()[0]
      win?.setSize(1720, 980)
      win?.center()
    })

    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    // Hide both sidebars so the panes get their real-use width.
    await pressShortcut('KeyB', 'b')
    await pressShortcut('KeyR', 'r')

    // Reach the vertical split without the palette or the layout menu —
    // neither is reachable from the DOM under a native-overlay build.
    // `cycle-layout` (Cmd+\) walks the built-in layouts; a single-pane
    // session renders vsplit as one filled slot plus one EMPTY slot, so the
    // layout attribute is the only reliable target.
    const currentLayout = async (): Promise<string | null> =>
      await browser.execute(
        () =>
          document
            .querySelector('[data-testid="split-view"]')
            ?.getAttribute('data-layout') ?? null
      )
    for (
      let attempt = 0;
      attempt < 8 && (await currentLayout()) !== 'vsplit';
      attempt++
    ) {
      await pressShortcut('Backslash', '\\')
      await browser.pause(400)
    }
    if ((await currentLayout()) !== 'vsplit') {
      const scene = await browser.execute(() => ({
        slots: document.querySelectorAll('[data-testid="split-view-slot"]')
          .length,
        layout: document
          .querySelector('[data-testid="split-view"]')
          ?.getAttribute('data-layout'),
        panes: document.querySelectorAll('[data-testid="terminal-pane"]')
          .length,
        body: document.body.innerText.slice(0, 160),
      }))

      throw new Error(
        `could not reach a two-pane layout via cycle-layout: ${JSON.stringify(scene)}`
      )
    }

    const emptySlot = await browser.execute(
      () =>
        document.querySelector('[data-testid="split-view-empty-slot"]') !== null
    )
    if (emptySlot) {
      await browser.execute(() => {
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-label="add shell pane"]'
          )
          ?.click()
      })
    }

    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelectorAll(
              '[data-testid="native-ghostty-pane"][data-pty-id]'
            ).length === 2
        ),
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: 'two native panes never appeared',
      }
    )

    const paneIds = await browser.execute(() =>
      Array.from(
        document.querySelectorAll('[data-testid="native-ghostty-pane"]')
      ).map((pane) => pane.getAttribute('data-pty-id') ?? '')
    )
    for (const ptyId of paneIds) {
      await startAgent(ptyId)
    }

    // Diagnostic pass before handing over: one Z-cycle, then watch the
    // restored pane for three seconds WITHOUT resizing. If hydration works
    // it comes back with content immediately; a blank grid here is the
    // deterministic root of the "first paint on resize" disease.
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })
    await browser.pause(700)
    await browser.execute(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })

    for (let tick = 0; tick < 12; tick++) {
      await browser.pause(250)
      for (const ptyId of paneIds) {
        const grid = await readGrid(ptyId)
        const rows = grid.split('\n')
        const filled = rows.filter((row) => row.trim().length > 0).length
        const marks = await browser.execute(() => ({
          attach: (window as unknown as Record<string, unknown>)
            .__ghosttyAttachRuns,
          hydration: (window as unknown as Record<string, unknown>)
            .__ghosttyHydration,
        }))
        // eslint-disable-next-line no-console
        console.log(
          `CYCLE-PROBE t=${tick} pane=${ptyId.slice(0, 8)} rows=${rows.length} filled=${filled} composer=${grid.includes(COMPOSER_MARKER) || grid.includes('bypass')} marks=${JSON.stringify(marks)}`
        )
      }
    }

    // eslint-disable-next-line no-console
    console.log('READY FOR HANDOFF — take the window, the stage is yours.')

    // Hold for half an hour; closing the app or killing the runner ends it.
    await browser.pause(30 * 60_000)
  })
})
