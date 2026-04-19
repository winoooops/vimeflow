import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/agents')

describe('Agent detection (fake-claude)', function () {
  // Linux-only: detector reads /proc; fixture uses bash + exec -a.
  before(function () {
    if (process.platform !== 'linux') {
      this.skip()
    }
  })

  it('detects a spawned fake claude process and expands the status panel', async () => {
    const pane = await $('[data-testid="terminal-pane"]')
    await pane.waitForDisplayed({ timeout: 20_000 })

    // Wait for the PTY prompt so typing lands in the shell, not the xterm
    // pre-init buffer.
    await browser.waitUntil(
      async () => {
        const buf = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )
        return buf.trim().length > 0
      },
      { timeout: 20_000, timeoutMsg: 'PTY never produced a prompt' }
    )

    // The default PTY CWD is ~, so use an absolute path to the fixture.
    const fixturePath = `${FIXTURE_DIR}/fake-claude`
    await typeInActiveTerminal(fixturePath)
    await pressEnterInActiveTerminal()

    // Detector polls /proc every ~2s for argv[0]="claude".
    const statusCard = await $('[data-testid="agent-status-card"]')
    await statusCard.waitForDisplayed({ timeout: 30_000 })

    const panel = await $('[data-testid="agent-status-panel"]')
    await panel.waitForDisplayed({ timeout: 5_000 })
  })
})
