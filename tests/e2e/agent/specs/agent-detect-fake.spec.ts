import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/agents')

// Host has any claude processes? The current detector (crates/backend/src/agent/
// detector.rs) scans /proc globally for argv[0]="claude" and attributes any
// match to the fresh PTY. On a dev box running real Claude Code, the host
// processes win the race and this spec sees non-deterministic failures
// (sometimes "invalid session id" when the app crashes in a code path
// triggered by the early false-detection). Skipping until PTY-ancestry
// filtering lands — tracked by https://github.com/winoooops/vimeflow/issues/71.
const hasPreexistingClaudeProcesses = (): boolean => {
  const result = spawnSync('pgrep', ['-x', 'claude'], { encoding: 'utf8' })
  // pgrep exits 0 if any matches, 1 if none. Any non-empty stdout = matches.
  return result.status === 0 && result.stdout.trim().length > 0
}

describe('Agent detection (fake-claude)', function () {
  // Linux-only: detector reads /proc; fixture uses bash + exec -a.
  before(function () {
    if (process.platform !== 'linux') {
      this.skip()
    }
    if (hasPreexistingClaudeProcesses()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[agent-detect-fake] skipping: pre-existing `claude` process(es) ' +
          'on host will collide with the global-scoped detector. ' +
          'See https://github.com/winoooops/vimeflow/issues/71'
      )
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
