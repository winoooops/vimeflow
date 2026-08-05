import { clickBySelector } from '../../shared/actions.js'
type ElectronModule = typeof import('electron')

const hasElement = async (selector: string): Promise<boolean> =>
  await browser.execute(
    (s: string) => document.querySelector<HTMLElement>(s) !== null,
    selector
  )

const openSettings = async (): Promise<void> => {
  if (!(await hasElement('[data-testid="sidebar-settings-footer"]'))) {
    await clickBySelector('[data-testid="sidebar-toggle-fixed"]')
    await (
      await $('[data-testid="sidebar-settings-footer"]')
    ).waitForExist({ timeout: 5_000 })
  }

  await clickBySelector('[data-testid="sidebar-settings-footer"]')
  await (
    await $('[role="dialog"][aria-label="Settings"]')
  ).waitForDisplayed({ timeout: 8_000 })
}

const focusTerminalZone = async (): Promise<void> => {
  await browser.electron.execute((electron: ElectronModule) => {
    const win = electron.BrowserWindow.getAllWindows()[0]
    win?.focus()
    win?.webContents.focus()
  })
  await browser.execute(() => {
    const zone = document.querySelector<HTMLElement>(
      '[data-testid="terminal-zone"]'
    )
    zone?.focus()
    zone?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
  if (
    await hasElement('[data-testid="split-view-slot"][data-pane-active="true"]')
  ) {
    await clickBySelector(
      '[data-testid="split-view-slot"][data-pane-active="true"]'
    )
  }
  await browser.pause(100)
}

const writeToVisiblePty = async (data: string): Promise<void> => {
  const written = await browser.execute(async (input: string) => {
    const bridge = window.__VIMEFLOW_E2E__
    const sessionId = bridge?.getVisiblePtyId()
    if (!bridge || !sessionId) {
      return false
    }

    await bridge.invokeBackend('write_pty', {
      request: {
        sessionId,
        data: input,
      },
    })

    return true
  }, data)
  if (!written) {
    throw new Error('visible PTY was not available for cursor-effect input')
  }
}

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
    await openSettings()

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

    await clickBySelector('[role="dialog"] button[aria-label="Close"]')
    await (
      await $('[role="dialog"][aria-label="Settings"]')
    ).waitForDisplayed({ reverse: true, timeout: 5_000 })
    await focusTerminalZone()

    const blankFrame = await browser.execute(() =>
      document
        .querySelector<HTMLCanvasElement>(
          'canvas[data-xterm-cursor-effect="tail"]'
        )
        ?.toDataURL()
    )

    await writeToVisiblePty('x')

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
