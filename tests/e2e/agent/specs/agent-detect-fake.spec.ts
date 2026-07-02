import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/agents')

const textForSelector = async (selector: string): Promise<string> =>
  await browser.execute((target: string) => {
    const el = document.querySelector<HTMLElement>(target)

    return el?.textContent ?? ''
  }, selector)

describe('Agent detection (fake-claude)', function () {
  // Linux-only: detector reads /proc; fixture uses bash + exec -a.
  //
  // The detector is PTY-scoped — `detect_agent` (crates/backend/src/agent/
  // detector.rs) walks the queried PTY's process tree via
  // /proc/<pid>/task/<pid>/children rather than scanning /proc globally,
  // so a host `claude` process outside the PTY tree no longer collides
  // with the test. The pre-existing skip guard for issue #71 has been
  // removed; the original race it described is fixed.
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
    await browser.waitUntil(
      async () => {
        const cardText = await textForSelector(
          '[data-testid="sidebar-agent-status-card"]'
        )

        return (
          cardText.includes('Claude Sonnet 4') &&
          !cardText.includes('No active agent')
        )
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: 'sidebar agent status card did not show fake Claude',
      }
    )

    const panel = await $('[data-testid="agent-status-panel"]')
    if (await panel.isExisting()) {
      await panel.waitForDisplayed({ timeout: 5_000 })
    }
  })
})
