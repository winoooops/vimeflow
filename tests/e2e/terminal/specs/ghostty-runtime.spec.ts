// cspell:ignore Ghostty ghostty
const renderedFrameFingerprint = (
  fingerprint: string | null | undefined
): string | null => /^id=[^,]+,seed=[^,]+/.exec(fingerprint ?? '')?.[0] ?? null

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
