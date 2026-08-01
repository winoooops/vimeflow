import { typeInActiveTerminal } from '../../shared/terminal.js'

describe('xterm cursor effects', () => {
  before(async function () {
    if (process.platform !== 'linux') {
      this.skip()
    }

    await browser.waitUntil(
      async () =>
        await browser.execute(
          () => typeof window.__VIMEFLOW_E2E__ !== 'undefined'
        ),
      {
        timeout: 20_000,
        timeoutMsg: 'window.__VIMEFLOW_E2E__ did not attach',
      }
    )
  })

  it('presents the selected Tail effect after terminal input', async () => {
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
    await cursorEffect.selectByAttribute('value', 'tail')

    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            'canvas[data-xterm-cursor-effect="tail"]'
          )

          return Boolean(canvas && canvas.width > 0 && canvas.height > 0)
        }),
      {
        timeout: 8_000,
        timeoutMsg: 'Tail cursor-effect canvas did not attach to xterm',
      }
    )

    await (await $('[role="dialog"] button[aria-label="Close"]')).click()

    const blankFrame = await browser.execute(() =>
      document
        .querySelector<HTMLCanvasElement>(
          'canvas[data-xterm-cursor-effect="tail"]'
        )
        ?.toDataURL()
    )

    await typeInActiveTerminal('x')

    await browser.waitUntil(
      async () =>
        await browser.execute((blank) => {
          const frame = document
            .querySelector<HTMLCanvasElement>(
              'canvas[data-xterm-cursor-effect="tail"]'
            )
            ?.toDataURL()

          return frame !== undefined && frame !== blank
        }, blankFrame),
      {
        timeout: 2_000,
        interval: 16,
        timeoutMsg: 'Tail cursor effect did not present a rendered frame',
      }
    )
  })
})
