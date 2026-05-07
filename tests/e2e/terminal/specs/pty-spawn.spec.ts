describe('PTY spawn (default session)', () => {
  before(async () => {
    // Each spec spawns a fresh webdriver session → fresh app instance.
    // The e2e bridge attaches in a React effect after mount, so a sync
    // probe at hook-start time races against React boot. Poll until it
    // appears OR the timeout elapses; only the timeout proves the build
    // is actually missing VITE_E2E.
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
          'window.__VIMEFLOW_E2E__ missing — rebuild with VITE_E2E=1'
        )
      })
  })

  it('renders a terminal pane with non-empty buffer', async () => {
    const pane = await $('[data-testid="terminal-pane"]')
    await pane.waitForDisplayed({ timeout: 20_000 })

    let lastProbe = ''
    await browser
      .waitUntil(
        async () => {
          lastProbe = await browser.execute(
            () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
          )
          return lastProbe.trim().length > 0
        },
        { timeout: 20_000, interval: 500 }
      )
      .catch((e: unknown) => {
        throw new Error(
          `Terminal buffer empty after 20s. last probe=<${lastProbe}>. cause=${String(e)}`
        )
      })
  })

  it('reports at least one active PTY session via the bridge', async () => {
    await browser.waitUntil(
      async () => {
        const ids = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getActiveSessionIds() ?? []
        )
        return ids.length >= 1
      },
      {
        timeout: 20_000,
        timeoutMsg: 'No active PTY session IDs registered',
      }
    )
  })
})
