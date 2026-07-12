import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createNewSessionWithDefaults } from '../../shared/actions.js'
import { waitForE2eBridge } from '../../shared/e2e-bridge.js'
import { e2eTempRoot } from '../../shared/electron-app.js'
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

interface AgentStatusScenario {
  agentType: E2eAgentType
  modelDisplayName: string
  modelId: string
  panelLabel: string
  turns: number
  usageFetched?: boolean
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

const readVisiblePtyId = async (): Promise<string | null> =>
  await browser.execute(
    () => window.__VIMEFLOW_E2E__?.getVisiblePtyId() ?? null
  )

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

const readAgentBridgeInfo = async (
  sessionId: string
): Promise<E2eAgentBridgeInfo> =>
  await invokeBackend<E2eAgentBridgeInfo>('e2e_agent_bridge_info', {
    sessionId,
  })

const waitForVisibleBridgePtyId = async (
  previousPtyId: string
): Promise<string> => {
  let bridgePtyId: string | null = null
  await browser.waitUntil(
    async () => {
      const visible = await readVisiblePtyId()
      if (visible === null) {
        return false
      }

      if (visible === previousPtyId) {
        return false
      }

      const info = await readAgentBridgeInfo(visible).catch(() => null)
      if (info?.statusFile) {
        bridgePtyId = visible

        return true
      }

      return false
    },
    {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: 'new bridge-enabled session did not become the visible PTY',
    }
  )

  assert.ok(bridgePtyId, 'spawned bridge PTY id should be resolved')

  return bridgePtyId
}

const seedAgent = async (
  ptyId: string,
  agentType: E2eAgentType
): Promise<void> => {
  await invokeBackend<null>('e2e_seed_live_agent', {
    sessionId: ptyId,
    agentType,
  })
}

const seedClaudeAgent = async (ptyId: string): Promise<void> => {
  await seedAgent(ptyId, 'claudeCode')
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

const writeKimiWire = (
  wirePath: string,
  scenario: AgentStatusScenario
): void => {
  const sessionId = `e2e-${scenario.agentType}-session`
  const timestamp = Date.now()
  const reset = Math.floor(Date.now() / 1000) + 3600
  const lines: string[] = [
    JSON.stringify({
      type: 'config.update',
      time: timestamp,
      modelAlias: scenario.modelDisplayName,
    }),
  ]

  for (let i = 0; i < scenario.turns; i += 1) {
    lines.push(
      JSON.stringify({
        type: 'turn.prompt',
        time: timestamp + i,
        origin: { kind: 'user' },
      }),
      JSON.stringify({
        type: 'usage.record',
        time: timestamp + i + 1,
        model: scenario.modelDisplayName,
        usage: {
          inputOther: 1100,
          inputCacheRead: 150,
          inputCacheCreation: 0,
          output: 250,
        },
      })
    )
  }

  lines.push(
    JSON.stringify({
      type: 'usage.record',
      time: timestamp + scenario.turns + 2,
      model: scenario.modelDisplayName,
      rateLimits: {
        fiveHour: { usedPercent: 19, windowMinutes: 300, resetsAt: reset },
        sevenDay: {
          usedPercent: 27,
          windowMinutes: 10080,
          resetsAt: reset + 86_400,
        },
      },
      usage: {
        inputOther: 1100 * scenario.turns,
        inputCacheRead: 150 * scenario.turns,
        inputCacheCreation: 0,
        output: 250 * scenario.turns,
      },
    })
  )

  fs.appendFileSync(wirePath, `${lines.join('\n')}\n`, 'utf8')
}

const writeCodexRollout = (
  rolloutPath: string,
  ptyId: string,
  scenario: AgentStatusScenario
): void => {
  const sessionId = `e2e-${scenario.agentType}-session`
  const timestamp = new Date().toISOString()
  const reset = Math.floor(Date.now() / 1000) + 3600
  const lines = [
    JSON.stringify({
      timestamp,
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp,
        cwd: process.cwd(),
        originator: 'codex_exec',
        cli_version: 'e2e',
        source: 'exec',
        model_provider: 'openai',
      },
    }),
    JSON.stringify({
      timestamp,
      type: 'turn_context',
      payload: {
        turn_id: `turn-${scenario.agentType}`,
        cwd: process.cwd(),
        model: scenario.modelDisplayName,
        personality: 'pragmatic',
        effort: 'xhigh',
      },
    }),
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: `turn-${scenario.agentType}`,
        started_at: Math.floor(Date.now() / 1000),
        model_context_window: 200_000,
        collaboration_mode_kind: 'default',
      },
    }),
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1100,
            cached_input_tokens: 150,
            output_tokens: 250,
            reasoning_output_tokens: 0,
            total_tokens: 1350,
          },
          last_token_usage: {
            input_tokens: 1100,
            cached_input_tokens: 150,
            output_tokens: 250,
            reasoning_output_tokens: 0,
            total_tokens: 1350,
          },
          model_context_window: 200_000,
        },
        rate_limits: {
          limit_id: 'codex',
          primary: {
            used_percent: 19,
            window_minutes: 300,
            resets_at: reset,
          },
          secondary: {
            used_percent: 27,
            window_minutes: 10080,
            resets_at: reset + 86_400,
          },
          plan_type: 'prolite',
        },
      },
    }),
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: `turn-${scenario.agentType}`,
        completed_at: Math.floor(Date.now() / 1000),
        duration_ms: 95_000,
        last_agent_message: 'done',
      },
    }),
  ]

  fs.writeFileSync(rolloutPath, `${lines.join('\n')}\n`, 'utf8')
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

const splitViewSlotExistsForSession = async (
  sessionId: string
): Promise<boolean> =>
  await browser.execute((targetSessionId: string) => {
    const slots = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="split-view-slot"][data-pty-id]'
      )
    )

    return slots.some((slot) => slot.dataset.ptyId === targetSessionId)
  }, sessionId)

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
    const tempRoot = fs.mkdtempSync(path.join(e2eTempRoot(), 'vimeflow-e2e-'))
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
          data: 'printf \'%s\' vimeflow_bridge_e2e > "$VIMEFLOW_STATUS_FILE"\n',
        },
      })

      await browser.waitUntil(
        () =>
          fs.existsSync(info.statusFile!) &&
          fs.readFileSync(info.statusFile!, 'utf8') === 'vimeflow_bridge_e2e',
        {
          timeout: 30_000,
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
    const initialPtyId = await waitForVisiblePtyId()
    const cardSelector = '[data-testid="sidebar-agent-status-card"]'

    // Spawn a dedicated bridge-enabled PTY through the frontend session manager
    // so the test controls its own precondition and the UI observes it as active.
    await createNewSessionWithDefaults()
    const ptyId = await waitForVisibleBridgePtyId(initialPtyId)

    try {
      await seedClaudeAgent(ptyId)

      await invokeBackend<null>('start_agent_watcher', { sessionId: ptyId })
      const info = await readAgentBridgeInfo(ptyId)

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
      if (await panel.isExisting()) {
        await panel.waitForDisplayed({ timeout: 10_000 })
        await (
          await $('[data-testid="agent-status-panel-body-content"]')
        ).waitForDisplayed({ timeout: 10_000 })
      }

      const cardText = await textForSelector(cardSelector)
      assert.equal(cardText.includes('No active agent'), false)
    } finally {
      await browser.execute(() => {
        const tabs = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')
        )
        const latestTab = tabs[tabs.length - 1]
        const closeButton = latestTab?.querySelector<HTMLButtonElement>(
          '[data-testid="close-tab-button"]'
        )
        closeButton?.click()
      })
    }
  })

  it('renders seeded Codex and Kimi statuses in the sidebar card and status panel', async () => {
    const ptyId = await waitForVisiblePtyId()
    const codexHome = fs.mkdtempSync(
      path.join(e2eTempRoot(), 'vimeflow-codex-e2e-')
    )
    const kimiHome = fs.mkdtempSync(
      path.join(e2eTempRoot(), 'vimeflow-kimi-e2e-')
    )

    const scenarios: AgentStatusScenario[] = [
      {
        agentType: 'codex',
        modelDisplayName: 'GPT-5 Codex',
        modelId: 'gpt-5-codex',
        panelLabel: 'CODEX',
        turns: 2,
      },
      {
        agentType: 'kimi',
        modelDisplayName: 'Kimi K2.7',
        modelId: 'kimi-code/k2.7',
        panelLabel: 'KIMI',
        turns: 3,
        usageFetched: true,
      },
    ]
    const cardSelector = '[data-testid="sidebar-agent-status-card"]'
    const panelSelector = '[data-testid="agent-status-panel"]'

    try {
      for (const scenario of scenarios) {
        await seedAgent(ptyId, scenario.agentType)

        if (scenario.agentType === 'codex') {
          const rolloutPath = await invokeBackend<string>(
            'e2e_start_codex_watcher',
            { sessionId: ptyId, homeDir: codexHome }
          )
          writeCodexRollout(rolloutPath, ptyId, scenario)
          await emitAgentTurn(ptyId, scenario.turns)
        } else {
          const wirePath = await invokeBackend<string>(
            'e2e_start_kimi_watcher',
            { sessionId: ptyId, homeDir: kimiHome }
          )
          writeKimiWire(wirePath, scenario)
          await emitAgentTurn(ptyId, scenario.turns)
        }

        await browser.waitUntil(
          async () => {
            const cardText = await textForSelector(cardSelector)

            return (
              cardText.includes(scenario.modelDisplayName) &&
              !cardText.includes('No active agent')
            )
          },
          {
            timeout: 15_000,
            interval: 500,
            timeoutMsg: `${scenario.agentType} status did not render in sidebar card`,
          }
        )

        const panel = await $(panelSelector)
        if (await panel.isExisting()) {
          await panel.waitForDisplayed({ timeout: 10_000 })
          await browser.waitUntil(
            async () => {
              const panelText = await textForSelector(panelSelector)

              return panelText.includes(scenario.panelLabel)
            },
            {
              timeout: 10_000,
              interval: 500,
              timeoutMsg: `${scenario.agentType} status did not render in status panel`,
            }
          )
        }
      }
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true })
      fs.rmSync(kimiHome, { recursive: true, force: true })
    }
  })

  it('renames Claude and Codex agent terminals and writes /rename into the PTY', async () => {
    const ptyId = await waitForVisiblePtyId()
    const agents: E2eAgentType[] = ['claudeCode', 'codex']

    for (const agentType of agents) {
      const title = `e2e-${agentType}-renamed-${Date.now()}`
      await seedAgent(ptyId, agentType)

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
          timeoutMsg: `${agentType} rename did not write /rename into the PTY`,
        }
      )
    }
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
    await browser.waitUntil(
      async () => await splitViewSlotExistsForSession(ptyIdBeforeReload),
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: 'reloaded split view did not restore previous PTY slot',
      }
    )

    const visiblePtyIdAfterReload = await browser.execute(
      () => window.__VIMEFLOW_E2E__?.getVisiblePtyId() ?? null
    )
    if (visiblePtyIdAfterReload !== null) {
      assert.equal(visiblePtyIdAfterReload, ptyIdBeforeReload)
    }

    await browser.waitUntil(
      async () => {
        const buffer = await browser.execute(
          (sessionId: string) =>
            window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(sessionId) ??
            '',
          ptyIdBeforeReload
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
