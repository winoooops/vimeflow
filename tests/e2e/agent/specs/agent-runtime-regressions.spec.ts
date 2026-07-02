import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createNewSession } from '../../shared/actions.js'
import {
  pressEnterInActiveTerminal,
  typeInActiveTerminal,
} from '../../shared/terminal.js'

type ElectronModule = typeof import('electron')
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

interface E2eAgentStatusEvent {
  sessionId: string
  agentSessionId: string
  modelId: string
  modelDisplayName: string
  version: string
  contextWindow: {
    usedPercentage: number
    remainingPercentage: number
    contextWindowSize: number
    totalInputTokens: number
    totalOutputTokens: number
    currentUsage: {
      inputTokens: number
      outputTokens: number
      cacheCreationInputTokens: number
      cacheReadInputTokens: number
    }
  }
  cost: {
    totalCostUsd: number | null
    totalDurationMs: number
    totalApiDurationMs: number
    totalLinesAdded: number
    totalLinesRemoved: number
  }
  rateLimits: {
    fiveHour: {
      usedPercentage: number
      resetsAt: number
    }
    sevenDay: {
      usedPercentage: number
      resetsAt: number
    }
  }
  usageFetched: boolean
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

const ensureActivityPanelExpanded = async (): Promise<void> => {
  const panelState = await browser.execute(() => ({
    compact: window.matchMedia('(max-width: 899px)').matches,
    hasPanel:
      document.querySelector('[data-testid="agent-status-panel"]') !== null,
    hasRail:
      document.querySelector('[data-testid="agent-status-rail"]') !== null,
    hasToggle:
      document.querySelector('[data-testid="activity-toggle-fixed"]') !== null,
  }))

  if (panelState.hasPanel) {
    return
  }

  assert.equal(
    panelState.compact,
    false,
    'agent status panel is desktop-only; test window is compact'
  )
  assert.equal(
    panelState.hasRail && panelState.hasToggle,
    true,
    'activity panel is neither expanded nor collapsible'
  )

  await browser.execute(() => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="activity-toggle-fixed"]')
      ?.click()
  })

  await browser.waitUntil(
    async () =>
      await browser.execute(
        () =>
          document.querySelector('[data-testid="agent-status-panel"]') !== null
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'activity panel did not expand',
    }
  )
}

const ensureDesktopViewport = async (): Promise<void> => {
  await browser.electron.execute((electron: ElectronModule) => {
    const win = electron.BrowserWindow.getAllWindows()[0]
    win?.setSize(1400, 900)
    win?.webContents.focus()
  })

  await browser.waitUntil(
    async () =>
      await browser.execute(
        () => !window.matchMedia('(max-width: 899px)').matches
      ),
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'desktop viewport did not apply',
    }
  )
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

const createAgentStatus = (
  ptyId: string,
  scenario: AgentStatusScenario
): E2eAgentStatusEvent => {
  const reset = Math.floor(Date.now() / 1000) + 3600

  return {
    sessionId: ptyId,
    agentSessionId: `e2e-${scenario.agentType}-session`,
    modelId: scenario.modelId,
    modelDisplayName: scenario.modelDisplayName,
    version: 'e2e',
    contextWindow: {
      usedPercentage: 1,
      remainingPercentage: 99,
      contextWindowSize: 200_000,
      totalInputTokens: 1100 * scenario.turns,
      totalOutputTokens: 250 * scenario.turns,
      currentUsage: {
        inputTokens: 1100,
        outputTokens: 250,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 150,
      },
    },
    cost: {
      totalCostUsd: null,
      totalDurationMs: 95_000,
      totalApiDurationMs: 80_000,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    rateLimits: {
      fiveHour: {
        usedPercentage: 19,
        resetsAt: reset,
      },
      sevenDay: {
        usedPercentage: 27,
        resetsAt: reset + 86_400,
      },
    },
    usageFetched: scenario.usageFetched ?? false,
  }
}

const emitAgentStatus = async (
  ptyId: string,
  scenario: AgentStatusScenario
): Promise<void> => {
  await invokeBackend<null>('e2e_emit_agent_status', {
    sessionId: ptyId,
    status: createAgentStatus(ptyId, scenario),
    numTurns: scenario.turns,
  })
}

const bufferHasExactLine = (buffer: string, expected: string): boolean =>
  buffer
    .replaceAll('\r', '\n')
    .split('\n')
    .some((line) => line.trim() === expected)

describe('Agent runtime regressions', () => {
  before(async () => {
    await waitForE2eBridge()
    await ensureDesktopViewport()
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
    const initialPtyId = await waitForVisiblePtyId()
    const cardSelector = '[data-testid="sidebar-agent-status-card"]'

    // Spawn a dedicated bridge-enabled PTY through the frontend session manager
    // so the test controls its own precondition and the UI observes it as active.
    await createNewSession()
    let ptyId: string | undefined
    await browser.waitUntil(
      async () => {
        const visible = await waitForVisiblePtyId()
        if (visible !== initialPtyId) {
          ptyId = visible
          return true
        }
        return false
      },
      {
        timeout: 15_000,
        interval: 250,
        timeoutMsg: 'new bridge-enabled session did not become the visible PTY',
      }
    )

    assert.ok(ptyId, 'spawned PTY id should be resolved')

    try {
      await seedClaudeAgent(ptyId)

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

      await ensureActivityPanelExpanded()
      const panel = await $('[data-testid="agent-status-panel"]')
      await panel.waitForDisplayed({ timeout: 10_000 })
      await (
        await $('[data-testid="agent-status-panel-body-content"]')
      ).waitForDisplayed({ timeout: 10_000 })

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

    for (const scenario of scenarios) {
      await seedAgent(ptyId, scenario.agentType)
      await emitAgentStatus(ptyId, scenario)

      await browser.waitUntil(
        async () => {
          await ensureActivityPanelExpanded()
          const cardText = await textForSelector(cardSelector)
          const panelText = await textForSelector(panelSelector)

          return (
            cardText.includes(scenario.modelDisplayName) &&
            cardText.includes(`${scenario.turns} turns`) &&
            !cardText.includes('No active agent') &&
            panelText.includes(scenario.panelLabel)
          )
        },
        {
          timeout: 15_000,
          interval: 500,
          timeoutMsg: `${scenario.agentType} status did not render in sidebar and panel`,
        }
      )
    }
  })

  it('writes /rename into Claude and Codex agent PTYs', async () => {
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
