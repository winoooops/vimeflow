// cspell:ignore Ghostty ghostty COLORTERM
// The campaign that produced this spec lost days to an environment mismatch:
// wdio injected FORCE_COLOR=0 into the app process, the PTY children
// inherited it, and every agent under test rendered monochrome — a different
// program than the one users run. The backend now scrubs the color-disabling
// variables and forces the truecolor contract; this pins that.

const readGrid = async (ptyId: string): Promise<string> =>
  (await browser.execute(
    async (id: string) =>
      (await window.__VIMEFLOW_E2E__?.readGhosttyGrid(id)) ?? '',
    ptyId
  )) ?? ''

describe('e2e pane environment', () => {
  before(function () {
    if (
      process.platform !== 'darwin' ||
      process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT !== '1'
    ) {
      this.skip()
    }
  })

  it('hands the PTY a truecolor environment with no color-disabling leaks', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    const ptyId = await browser.execute(() =>
      document
        .querySelector('[data-testid="native-ghostty-pane"]')
        ?.getAttribute('data-pty-id')
    )
    if (!ptyId) {
      throw new Error('no native pane')
    }

    await browser.execute(
      async (id: string, cmd: string) => {
        await window.__VIMEFLOW_E2E__?.invokeBackend('write_pty', {
          request: { sessionId: id, data: `${cmd}\r` },
        })
      },
      ptyId,
      // One marker line the grid read can find whole. `unset` markers make
      // absence assertable — an empty expansion would be invisible.
      'echo "E2E-ENV CT=${COLORTERM-unset} T=$TERM NC=${NO_COLOR-unset} FC=${FORCE_COLOR-unset}"'
    )

    await browser.waitUntil(
      async () => (await readGrid(ptyId)).includes('E2E-ENV CT='),
      {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: 'the environment probe never echoed back',
      }
    )

    const marker = (await readGrid(ptyId))
      .split('\n')
      // The echoed command itself also contains the prefix; the result line
      // is the one whose variables have already been expanded.
      .filter((line) => line.includes('E2E-ENV CT=') && !line.includes('${'))
      .at(-1)

    expect(marker).toContain('CT=truecolor')
    expect(marker).toContain('T=xterm-256color')
    expect(marker).toContain('NC=unset')
    expect(marker).toContain('FC=unset')
  })
})
