import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNewSessionWithDefaults } from '../../shared/actions.js'
import { waitForE2eBridge } from '../../shared/e2e-bridge.js'
import { e2eTempRoot } from '../../shared/electron-app.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/agents/dummy-codex-agent.mjs'
)

interface NotificationWatcherDiagnostics {
  readonly workerAlive: boolean
  readonly activeRegistrations: number
  readonly activeByProvider: Readonly<Record<string, number>>
  readonly recordsScanned: number
  readonly notificationsEmitted: Readonly<Record<string, number>>
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

const waitForVisiblePtyId = async (
  previousPtyId: string | null = null
): Promise<string> => {
  let ptyId: string | null = null
  await browser.waitUntil(
    async () => {
      ptyId = await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getVisiblePtyId() ?? null
      )

      return ptyId !== null && ptyId !== previousPtyId
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'visible PTY id never changed',
    }
  )
  assert.ok(ptyId)

  return ptyId
}

const writePty = async (sessionId: string, data: string): Promise<void> => {
  await invokeBackend<null>('write_pty', {
    request: { sessionId, data: `${data}\n` },
  })
}

const waitForPtyText = async (
  sessionId: string,
  expected: string
): Promise<void> => {
  await browser.waitUntil(
    async () => {
      const buffer = await browser.execute(
        (ptyId: string) =>
          window.__VIMEFLOW_E2E__?.getTerminalBufferForSession(ptyId) ?? '',
        sessionId
      )

      return buffer.includes(expected)
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `PTY ${sessionId} never printed ${expected}`,
    }
  )
}

const captureLifecycleFor = async (sessionId: string): Promise<void> => {
  await browser.execute(async (targetSessionId: string) => {
    document.documentElement.removeAttribute('data-e2e-agent-phase')
    await window.vimeflow?.listen<{
      sessionId: string
      phase: string
    }>('agent-lifecycle', (event) => {
      if (event.sessionId === targetSessionId) {
        document.documentElement.dataset.e2eAgentPhase = event.phase
      }
    })
  }, sessionId)
}

const waitForLifecyclePhase = async (phase: string): Promise<void> => {
  await browser.waitUntil(
    async () =>
      await browser.execute(
        (expected: string) =>
          document.documentElement.dataset.e2eAgentPhase === expected,
        phase
      ),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `agent lifecycle never reached ${phase}`,
    }
  )
}

const captureUnexpectedNotificationEvents = async (
  sessionId: string
): Promise<void> => {
  await browser.execute(async (targetSessionId: string) => {
    const root = document.documentElement
    root.dataset.e2eUnexpectedNotificationEvents = '0'
    for (const eventName of [
      'agent-status',
      'agent-tool-call',
      'agent-replay-summary',
    ]) {
      await window.vimeflow?.listen<{ sessionId: string }>(
        eventName,
        (event) => {
          if (event.sessionId === targetSessionId) {
            root.dataset.e2eUnexpectedNotificationEvents = String(
              Number(root.dataset.e2eUnexpectedNotificationEvents ?? '0') + 1
            )
          }
        }
      )
    }
  }, sessionId)
}

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`

const notificationDiagnostics =
  async (): Promise<NotificationWatcherDiagnostics> =>
    await invokeBackend('get_agent_notification_diagnostics', {})

describe('Background agent notifications', () => {
  before(async () => {
    await waitForE2eBridge()
    await (
      await $('[data-testid="terminal-pane"]')
    ).waitForDisplayed({ timeout: 20_000 })
  })

  it('notifies when a Codex turn completes after switching to another PTY', async () => {
    const ptyA = await waitForVisiblePtyId()
    const sessionA = await browser.execute(
      () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
    )
    assert.ok(sessionA)
    const codexHome = fs.mkdtempSync(
      path.join(e2eTempRoot(), 'vimeflow-background-codex-')
    )
    let ptyClosed = false
    let foregroundCompleteCount = 0

    try {
      await captureLifecycleFor(ptyA)
      await invokeBackend<null>('e2e_seed_live_agent', {
        sessionId: ptyA,
        agentType: 'codex',
      })
      const rolloutPath = await invokeBackend<string>(
        'e2e_start_codex_watcher',
        { sessionId: ptyA, homeDir: codexHome }
      )
      await invokeBackend<null>('e2e_register_agent_notification_source', {
        sessionId: ptyA,
        provider: 'codex',
        sourcePath: rolloutPath,
      })
      const initialDiagnostics = await notificationDiagnostics()
      assert.equal(initialDiagnostics.workerAlive, true)
      assert.equal(initialDiagnostics.activeRegistrations, 1)
      assert.deepEqual(initialDiagnostics.activeByProvider, { codex: 1 })
      assert.equal(initialDiagnostics.recordsScanned, 0)
      assert.deepEqual(initialDiagnostics.notificationsEmitted, {})

      await writePty(
        ptyA,
        `node ${shellQuote(fixturePath)} ${shellQuote(rolloutPath)}`
      )
      await waitForPtyText(ptyA, 'READY dummy-codex-')
      await writePty(ptyA, 'start')
      await waitForPtyText(ptyA, 'STARTED 1')
      await writePty(ptyA, 'complete')
      await waitForPtyText(ptyA, 'COMPLETED 1')
      assert.equal(
        fs.readFileSync(rolloutPath, 'utf8').includes('"type":"task_complete"'),
        true,
        'dummy did not append task_complete to the watched rollout'
      )
      const watcher = await invokeBackend<{ agentType: string | null }>(
        'e2e_agent_bridge_info',
        { sessionId: ptyA }
      )
      assert.equal(watcher.agentType, 'codex', 'Codex watcher stopped early')
      await waitForLifecyclePhase('idle')
      foregroundCompleteCount =
        (await notificationDiagnostics()).notificationsEmitted[
          'turn-complete'
        ] ?? 0

      await writePty(ptyA, 'start')
      await waitForPtyText(ptyA, 'STARTED 2')
      await waitForLifecyclePhase('running')
      await writePty(ptyA, 'noise 1000')
      await waitForPtyText(ptyA, 'NOISE 1000')

      await createNewSessionWithDefaults()
      await waitForVisiblePtyId(ptyA)

      // `useAgentStatus` performs this same stop on session switch. Repeating
      // it here makes the regression barrier deterministic before completion.
      await browser.execute(async (sessionId: string) => {
        await window.__VIMEFLOW_E2E__
          ?.invokeBackend('stop_agent_watcher', { sessionId })
          .catch(() => undefined)
      }, ptyA)
      await captureUnexpectedNotificationEvents(ptyA)
      await writePty(ptyA, 'complete')
      await waitForPtyText(ptyA, 'COMPLETED 2')

      await browser.waitUntil(
        async () =>
          await browser.execute(
            () =>
              document.querySelector(
                'button[aria-label="Notifications, 1 unread"]'
              ) !== null
          ),
        {
          timeout: 10_000,
          interval: 250,
          timeoutMsg:
            'background Codex completion did not create an unread notification',
        }
      )

      assert.equal(
        await browser.execute(() =>
          Number(
            document.documentElement.dataset.e2eUnexpectedNotificationEvents ??
              '0'
          )
        ),
        0,
        'notification watcher emitted a full agent event'
      )

      await browser.waitUntil(
        async () =>
          await browser.execute((sessionId: string) => {
            const row = document.querySelector(
              `[data-testid="session-row"][data-session-id="${CSS.escape(sessionId)}"]`
            )

            return row?.textContent?.includes('Idle') ?? false
          }, sessionA),
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg: 'background completion left the session running',
        }
      )

      const afterBackground = await notificationDiagnostics()
      const switched = await browser.execute((sessionId: string) => {
        const activation = document.querySelector<HTMLButtonElement>(
          `[data-testid="session-row"][data-session-id="${CSS.escape(sessionId)}"] [data-role="activate"]`
        )
        activation?.click()

        return activation !== null
      }, sessionA)
      assert.equal(switched, true, 'PTY A session row was not present')
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
          )) === sessionA,
        {
          timeout: 10_000,
          interval: 100,
          timeoutMsg:
            'returning to PTY A did not restore its workspace session',
        }
      )
      assert.equal(await waitForVisiblePtyId(), ptyA)
      await browser.pause(1_000)
      assert.equal(
        (await notificationDiagnostics()).notificationsEmitted['turn-complete'],
        afterBackground.notificationsEmitted['turn-complete'],
        'returning to PTY A replayed its completion notification'
      )

      await invokeBackend<null>('e2e_seed_live_agent', {
        sessionId: ptyA,
        agentType: 'codex',
      })
      await invokeBackend('start_agent_watcher', { sessionId: ptyA })
      const beforeClose = await notificationDiagnostics()
      assert.equal(beforeClose.activeRegistrations, 1)
      assert.equal(
        beforeClose.notificationsEmitted['turn-complete'],
        foregroundCompleteCount + 1
      )

      await writePty(ptyA, 'exit')
      await waitForPtyText(ptyA, 'EXITING')
      await writePty(ptyA, 'exit')
      ptyClosed = true

      const churn = setInterval(() => {
        fs.appendFileSync(
          rolloutPath,
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            type: 'event_msg',
            payload: { type: 'token_count', info: { total_tokens: 1 } },
          })}\n`,
          'utf8'
        )
      }, 50)
      try {
        await browser.waitUntil(
          async () => {
            const [fullWatcherActive, notificationWatcher] = await Promise.all([
              invokeBackend<boolean>('e2e_full_agent_watcher_active', {
                sessionId: ptyA,
              }),
              notificationDiagnostics(),
            ])

            return (
              !fullWatcherActive &&
              !notificationWatcher.workerAlive &&
              notificationWatcher.activeRegistrations === 0
            )
          },
          {
            timeout: 10_000,
            interval: 100,
            timeoutMsg: 'PTY close left an agent watcher registered',
          }
        )
      } finally {
        clearInterval(churn)
      }

      fs.appendFileSync(
        rolloutPath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            turn_id: 'turn-after-close',
          },
        })}\n`,
        'utf8'
      )
      await invokeBackend<null>('e2e_reconcile_agent_notification_watchers', {})

      const afterClose = await notificationDiagnostics()
      assert.equal(
        afterClose.notificationsEmitted['turn-complete'],
        beforeClose.notificationsEmitted['turn-complete'],
        'orphaned notification watcher observed a closed PTY source'
      )
    } finally {
      if (!ptyClosed) {
        await writePty(ptyA, 'exit').catch(() => undefined)
      }
      fs.rmSync(codexHome, { recursive: true, force: true })
    }
  })
})
