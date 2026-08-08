// cspell:ignore Ghostty ghostty
const renderedFrameFingerprint = (
  fingerprint: string | null | undefined
): string | null => /^id=[^,]+,seed=[^,]+/.exec(fingerprint ?? '')?.[0] ?? null

const nativePtyId = async (): Promise<string> => {
  const ptyId = await browser.execute(() =>
    document
      .querySelector('[data-testid="native-ghostty-pane"]')
      ?.getAttribute('data-pty-id')
  )

  if (!ptyId) {
    throw new Error('native Ghostty pane has no PTY id')
  }

  return ptyId
}

const writePty = async (ptyId: string, data: string): Promise<void> => {
  await browser.execute(
    async (id: string, input: string) => {
      await window.__VIMEFLOW_E2E__?.invokeBackend('write_pty', {
        request: { sessionId: id, data: input },
      })
    },
    ptyId,
    data
  )
}

describe('Ghostty native terminal runtime', () => {
  before(async function () {
    if (
      process.platform !== 'darwin' ||
      process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT !== '1'
    ) {
      this.skip()
    }

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

  it('boots the terminal pane through the native Ghostty parent bridge', async () => {
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const api = window.vimeflow?.ghosttyNative

          return Boolean(
            api?.update &&
            api.attachSecondary &&
            api.setSecondaryVisible &&
            document.querySelector('[data-testid="native-ghostty-pane"]')
          )
        }),
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: 'native Ghostty pane did not boot with the parent bridge',
      }
    )

    const state = await browser.execute(() => ({
      hasNativePane:
        document.querySelector('[data-testid="native-ghostty-pane"]') !== null,
      hasXtermTextarea:
        document.querySelector('.xterm-helper-textarea') !== null,
    }))

    expect(state).toEqual({
      hasNativePane: true,
      hasXtermTextarea: false,
    })
  })

  it('drives renderer header progress from the native Ghostty PTY', async () => {
    const ptyId = await nativePtyId()

    await writePty(ptyId, "printf '\\033]9;4;3\\007'\r")
    await browser.waitUntil(
      async () =>
        await browser.execute((id: string) => {
          const pane = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="split-view-slot"]'
            )
          ).find((candidate) => candidate.dataset.ptyId === id)
          const bar = pane?.querySelector(
            '[data-testid="terminal-pane-progress"]'
          )

          return (
            bar !== null &&
            bar !== undefined &&
            !bar.hasAttribute('aria-valuenow')
          )
        }, ptyId),
      { timeoutMsg: 'native indeterminate progress did not render' }
    )

    await writePty(ptyId, "printf '\\033]9;4;1;42\\007'\r")
    await browser.waitUntil(
      async () =>
        await browser.execute((id: string) => {
          const pane = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="split-view-slot"]'
            )
          ).find((candidate) => candidate.dataset.ptyId === id)
          const bar = pane?.querySelector(
            '[data-testid="terminal-pane-progress"]'
          )
          const fill = pane?.querySelector<HTMLElement>(
            '[data-testid="terminal-pane-progress-fill"]'
          )

          return (
            bar?.getAttribute('aria-valuenow') === '42' &&
            fill?.style.width === '42%'
          )
        }, ptyId),
      { timeoutMsg: 'native determinate progress did not render' }
    )

    await writePty(ptyId, 'echo E2E-NATIVE-PROGRESS-OK\r')
    await browser.waitUntil(
      async () =>
        await browser.execute(
          async (id: string) =>
            (
              (await window.__VIMEFLOW_E2E__?.readGhosttyGrid(id)) ?? ''
            ).includes('E2E-NATIVE-PROGRESS-OK'),
          ptyId
        ),
      { timeoutMsg: 'native Ghostty surface stopped presenting PTY output' }
    )

    await writePty(ptyId, "printf '\\033]9;4;0\\007'\r")
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () =>
            document.querySelector('[data-testid="terminal-pane-progress"]') ===
            null
        ),
      { timeoutMsg: 'native progress did not clear' }
    )
  })

  it('has Ghostty accept and present the selected cursor shader', async () => {
    await (await $('[data-testid="sidebar-settings-footer"]')).click()
    await (
      await $('[role="dialog"][aria-label="Settings"]')
    ).waitForDisplayed({ timeout: 8_000 })

    await browser.execute(() => {
      const terminalButton = Array.from(
        document.querySelectorAll('[role="dialog"] nav button')
      ).find((button) => (button.textContent ?? '').includes('Terminal'))
      ;(terminalButton as HTMLElement | undefined)?.click()
    })

    const cursorEffect = await $('select[aria-label="Terminal cursor effect"]')
    await cursorEffect.waitForEnabled({ timeout: 8_000 })
    await cursorEffect.selectByAttribute('value', 'off')
    const offFingerprint = await browser.execute(
      async () => await window.__VIMEFLOW_E2E__?.readGhosttyPresentation()
    )
    const offFrameFingerprint = renderedFrameFingerprint(offFingerprint)
    await cursorEffect.selectByAttribute('value', 'warp')

    await browser.waitUntil(
      async () =>
        await browser.execute(async (previousFrameFingerprint) => {
          const fingerprint =
            await window.__VIMEFLOW_E2E__?.readGhosttyPresentation()
          const frameFingerprint =
            /^id=[^,]+,seed=[^,]+/.exec(fingerprint ?? '')?.[0] ?? null

          return (
            frameFingerprint !== previousFrameFingerprint &&
            (fingerprint?.endsWith('/cursor_warp.glsl') ?? false)
          )
        }, offFrameFingerprint),
      {
        timeout: 8_000,
        interval: 250,
        timeoutMsg:
          'native Ghostty did not accept and present cursor_warp.glsl',
      }
    )

    await (await $('[role="dialog"] button[aria-label="Close"]')).click()
  })
})
