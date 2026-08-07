// cspell:ignore Ghostty ghostty COLORTERM
// Top-level declarations in an import-less spec land in the global script
// scope and collide across files under `tsc -p tests/e2e`; the empty export
// makes this a module.
export {}

// The campaign that produced this spec lost days to an environment mismatch:
// wdio injected FORCE_COLOR=0 into the app process, the PTY children
// inherited it, and every agent under test rendered monochrome — a different
// program than the one users run. The backend now scrubs the color-disabling
// variables and forces the truecolor contract; this pins that.

const nativeTransport =
  process.platform === 'darwin' &&
  process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1'

const readTerminal = async (ptyId: string): Promise<string> =>
  (await browser.execute(
    async (id: string, native: boolean) =>
      native
        ? ((await window.__VIMEFLOW_E2E__?.readGhosttyGrid(id)) ?? '')
        : (window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(id) ?? ''),
    ptyId,
    nativeTransport
  )) ?? ''

describe('e2e pane environment', () => {
  it('scopes terminal identity to native transport and scrubs color-disabling variables', async () => {
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })

    const ptyId = await browser.execute((native: boolean) => {
      const selector = native
        ? '[data-testid="native-ghostty-pane"]'
        : '[data-testid="split-view-slot"][data-pty-id]'

      return document.querySelector(selector)?.getAttribute('data-pty-id')
    }, nativeTransport)
    if (!ptyId) {
      throw new Error('no terminal pane')
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
      'echo "E2E-ENV CT=${COLORTERM-unset} T=$TERM NC=${NO_COLOR-unset} FC=${FORCE_COLOR-unset} TP=${TERM_PROGRAM-unset} TPV=${TERM_PROGRAM_VERSION-unset}"'
    )

    await browser.waitUntil(
      async () =>
        (await readTerminal(ptyId))
          .split('\n')
          .some((line) => line.includes('E2E-ENV CT=') && !line.includes('${')),
      {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: 'the environment probe never echoed back',
      }
    )

    const marker = (await readTerminal(ptyId))
      .split('\n')
      // The echoed command itself also contains the prefix; the result line
      // is the one whose variables have already been expanded.
      .filter((line) => line.includes('E2E-ENV CT=') && !line.includes('${'))
      .at(-1)

    expect(marker).toContain('CT=truecolor')
    expect(marker).toContain('T=xterm-256color')
    expect(marker).toContain('NC=unset')
    expect(marker).toContain('FC=unset')
    expect(marker).toContain(
      nativeTransport ? 'TP=ghostty TPV=1.3.2' : 'TP=unset TPV=unset'
    )
  })
})
