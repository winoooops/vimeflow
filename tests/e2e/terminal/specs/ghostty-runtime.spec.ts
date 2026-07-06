// cspell:ignore Ghostty ghostty
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
})
