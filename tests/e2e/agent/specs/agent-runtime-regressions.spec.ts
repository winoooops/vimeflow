import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

type E2eAgentType = 'claudeCode' | 'codex' | 'kimi' | 'aider' | 'generic'

interface E2eAgentBridgeInfo {
  sessionId: string
  cwd: string
  appDataDir: string
  bridgeDir: string | null
  statusFile: string | null
  shimDir: string | null
  agentType: E2eAgentType | null
}

const waitForE2eBridge = async (): Promise<void> => {
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
}

const waitForVisiblePtyId = async (): Promise<string> => {
  let lastValue: string | null = null
  await browser.waitUntil(
    async () => {
      lastValue = await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getVisiblePtyId() ?? null
      )

      return lastValue !== null
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'visible PTY id never resolved',
    }
  )

  assert.ok(lastValue)

  return lastValue
}

const invokeBackend = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> =>
  await browser.execute(
    async (backendMethod: string, backendArgs?: Record<string, unknown>) =>
      await window.__VIMEFLOW_E2E__!.invokeBackend<T>(
        backendMethod,
        backendArgs
      ),
    method,
    args
  )

const seedClaudeAgent = async (ptyId: string): Promise<void> => {
  await invokeBackend<null>('e2e_seed_live_agent', {
    sessionId: ptyId,
    agentType: 'claudeCode',
  })
}

const createClaudeStatusline = (): string => {
  const reset = Math.floor(Date.now() / 1000) + 3600

  return JSON.stringify({
    session_id: 'e2e-agent-session',
    version: 'e2e',
    model: {
      id: 'claude-sonnet-4-5',
      display_name: 'Claude Sonnet 4.5',
    },
    context_window: {
      used_percentage: 42,
      remaining_percentage: 58,
      context_window_size: 200_000,
      total_input_tokens: 80_000,
      total_output_tokens: 4_000,
      current_usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 700,
      },
    },
    cost: {
      total_cost_usd: 1.23,
      total_duration_ms: 120_000,
      total_api_duration_ms: 90_000,
      total_lines_added: 12,
      total_lines_removed: 3,
    },
    rate_limits: {
      five_hour: {
        used_percentage: 17,
        resets_at: reset,
      },
      seven_day: {
        used_percentage: 23,
        resets_at: reset + 86_400,
      },
    },
  })
}

const emitAgentTurn = async (
  sessionId: string,
  turns: number
): Promise<void> => {
  await browser.execute(
    (ptyId: string, numTurns: number) => {
      window.__VIMEFLOW_E2E__?.emitBackendEvent('agent-turn', {
        sessionId: ptyId,
        numTurns,
      })
    },
    sessionId,
    turns
  )
}

const textForSelector = async (selector: string): Promise<string> =>
  await browser.execute((target: string) => {
    const el = document.querySelector<HTMLElement>(target)

    return el?.textContent ?? ''
  }, selector)

const bufferHasExactLine = (buffer: string, expected: string): boolean =>
  buffer
    .replaceAll('\r', '\n')
    .split('\n')
    .some((line) => line.trim() === expected)

describe('Agent runtime regressions', () => {
  before(async () => {
    await waitForE2eBridge()
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })
  })

  it('stores bridge files under app data and leaves project .vimeflow absent', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vimeflow-e2e-'))
    const projectDir = path.join(tempRoot, 'Project With Spaces & Symbols')
    fs.mkdirSync(projectDir)
    const sessionId = `e2e_bridge_${Date.now()}`
    let bridgeDir: string | null = null
    let shimDir: string | null = null

    try {
      await invokeBackend('spawn_pty', {
        request: {
          sessionId,
          cwd: projectDir,
          shell: null,
          env: null,
          enableAgentBridge: true,
          ephemeral: false,
        },
      })

      const info = await invokeBackend<E2eAgentBridgeInfo>(
        'e2e_agent_bridge_info',
        { sessionId }
      )
      bridgeDir = info.bridgeDir
      shimDir = info.shimDir

      assert.equal(info.cwd, fs.realpathSync(projectDir))
      assert.ok(info.bridgeDir, 'bridgeDir should be populated')
      assert.ok(info.statusFile, 'statusFile should be populated')
      assert.ok(info.shimDir, 'shimDir should be populated')

      const bridgeRelativeToAppData = path.relative(
        info.appDataDir,
        info.bridgeDir
      )
      assert.ok(
        bridgeRelativeToAppData.length > 0 &&
          !bridgeRelativeToAppData.startsWith('..') &&
          !path.isAbsolute(bridgeRelativeToAppData),
        `bridge dir should live inside app data: ${info.bridgeDir}`
      )
      assert.equal(path.dirname(info.statusFile), info.bridgeDir)
      assert.equal(
        info.bridgeDir.split(path.sep).includes('.vimeflow'),
        false,
        `bridge dir must not use a .vimeflow path component: ${info.bridgeDir}`
      )
      assert.ok(
        info.bridgeDir.split(path.sep).includes('runtime'),
        `bridge dir should use the app-data runtime bucket: ${info.bridgeDir}`
      )
      assert.ok(
        info.bridgeDir.split(path.sep).includes('workspaces'),
        `bridge dir should include a workspace bucket: ${info.bridgeDir}`
      )
      assert.equal(fs.existsSync(path.join(projectDir, '.vimeflow')), false)

      await invokeBackend('write_pty', {
        request: {
          sessionId,
          data: 'printf vimeflow_bridge_e2e > "$VIMEFLOW_STATUS_FILE"\n',
        },
      })

      await browser.waitUntil(
        () =>
          fs.existsSync(info.statusFile!) &&
          fs.readFileSync(info.statusFile!, 'utf8') === 'vimeflow_bridge_e2e',
        {
          timeout: 10_000,
          interval: 250,
          timeoutMsg:
            'spawned shell did not write through VIMEFLOW_STATUS_FILE',
        }
      )
      assert.equal(fs.existsSync(path.join(projectDir, '.vimeflow')), false)
    } finally {
      await invokeBackend('kill_pty', {
        request: {
          sessionId,
        },
      }).catch(() => undefined)
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }

    if (bridgeDir) {
      await browser.waitUntil(() => !fs.existsSync(bridgeDir), {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: `bridge dir was not cleaned up: ${bridgeDir}`,
      })
    }
    if (shimDir) {
      await browser.waitUntil(() => !fs.existsSync(shimDir), {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: `shim dir was not cleaned up: ${shimDir}`,
      })
    }
  })

  it('ingests app-data status files through the watcher into the sidebar card and status panel', async () => {
    const ptyId = await waitForVisiblePtyId()
    await seedClaudeAgent(ptyId)
    const cardSelector = '[data-testid="sidebar-agent-status-card"]'

    await invokeBackend<null>('start_agent_watcher', { sessionId: ptyId })
    const info = await invokeBackend<E2eAgentBridgeInfo>(
      'e2e_agent_bridge_info',
      { sessionId: ptyId }
    )

    assert.equal(info.agentType, 'claudeCode')
    assert.ok(info.statusFile, 'statusFile should be populated')
    assert.ok(
      path
        .relative(info.appDataDir, info.statusFile)
        .split(path.sep)
        .includes('runtime'),
      `status file should live under the app-data runtime bucket: ${info.statusFile}`
    )

    fs.mkdirSync(path.dirname(info.statusFile), { recursive: true })
    fs.writeFileSync(info.statusFile, createClaudeStatusline(), 'utf8')
    await emitAgentTurn(ptyId, 4)

    await browser.waitUntil(
      async () => {
        const cardText = await textForSelector(cardSelector)

        return (
          cardText.includes('Claude Sonnet 4.5') &&
          cardText.includes('4 turns') &&
          !cardText.includes('No active agent')
        )
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg:
          'sidebar agent status card did not render watcher-ingested metrics',
      }
    )

    const panel = await $('[data-testid="agent-status-panel"]')
    await panel.waitForDisplayed({ timeout: 10_000 })
    await (
      await $('[data-testid="agent-status-panel-body-content"]')
    ).waitForDisplayed({ timeout: 10_000 })

    const cardText = await textForSelector(cardSelector)
    assert.equal(cardText.includes('No active agent'), false)
  })

  it('renames the active agent terminal and writes /rename into the PTY', async () => {
    const ptyId = await waitForVisiblePtyId()
    const title = `e2e-renamed-${Date.now()}`
    await seedClaudeAgent(ptyId)

    await invokeBackend<null>('rename_agent_session', { ptyId, title })

    await browser.waitUntil(
      async () => {
        const buffer = await browser.execute(
          (sessionId: string) =>
            window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(sessionId) ??
            '',
          ptyId
        )

        return buffer.includes(`/rename ${title}`)
      },
      {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: 'backend rename did not write /rename into the PTY',
      }
    )

    await browser.execute(
      (sessionId: string, renamedTitle: string) => {
        window.__VIMEFLOW_E2E__?.emitBackendEvent('agent-session-title', {
          sessionId,
          agentSessionId: 'e2e-agent-session',
          title: renamedTitle,
          source: 'user-renamed',
        })
      },
      ptyId,
      title
    )

    await browser.waitUntil(
      async () => {
        const headerText = await textForSelector(
          '[data-testid="terminal-pane-header"]'
        )

        return headerText.includes(title)
      },
      {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: 'terminal header did not show renamed agent title',
      }
    )
  })

  it('restores the previous terminal session after renderer reload', async () => {
    const ptyIdBeforeReload = await waitForVisiblePtyId()
    const marker = `vimeflow_restore_${Date.now()}`

    await typeInActiveTerminal(`printf '%s\\n' '${marker}'`)
    await pressEnterInActiveTerminal()
    await browser.waitUntil(
      async () => {
        const buffer = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )

        return bufferHasExactLine(buffer, marker)
      },
      {
        timeout: 10_000,
        interval: 250,
        timeoutMsg: 'terminal did not print restore marker before reload',
      }
    )

    await browser.execute(() => {
      window.location.reload()
    })
    await waitForE2eBridge()
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({
      timeout: 20_000,
    })
    const ptyIdAfterReload = await waitForVisiblePtyId()
    assert.equal(ptyIdAfterReload, ptyIdBeforeReload)

    await browser.waitUntil(
      async () => {
        const buffer = await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
        )

        return bufferHasExactLine(buffer, marker)
      },
      {
        timeout: 20_000,
        interval: 500,
        timeoutMsg: 'terminal replay did not restore pre-reload buffer',
      }
    )
  })
})
