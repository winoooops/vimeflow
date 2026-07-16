import fs from 'node:fs'
import path from 'node:path'
import type { PersistedWorkspaceLayoutStore } from '../../../../electron/workspace-layout-types.js'
import { waitForE2eBridge } from '../../shared/e2e-bridge.js'
import {
  AGENT_RESUME_FOLLOW_UP_LOG_FILE,
  AGENT_RESUME_WORKSPACES,
  FALLBACK_RESUME_CASE,
  INITIAL_ACTIVE_RESUME_WORKSPACE,
  STRESS_RESUME_WORKSPACE,
  type AgentResumeCase,
  type AgentResumeWorkspace,
  paneIdFor,
  stalePtyIdFor,
} from '../agent-resume-fixture.js'

type ElectronModule = typeof import('electron')

// macos-26 GitHub runners can vary by several seconds after Electron reload
// while still preserving the intended lazy-hydration bound for 384 panes.
const RENDERER_STRESS_RESUME_BUDGET_MS = 24_000

const fixtureLogPath = (): string => {
  const configured = process.env.VIMEFLOW_E2E_AGENT_LOG
  if (!configured) {
    throw new Error('VIMEFLOW_E2E_AGENT_LOG was not configured for this spec')
  }

  return configured
}

const readLines = (filePath: string): string[] => {
  const text = fs.readFileSync(filePath, 'utf8').trim()

  return text === '' ? [] : text.split('\n')
}

const readInvocations = (): string[] => readLines(fixtureLogPath())

const readFollowUps = (): string[] =>
  readLines(
    path.join(path.dirname(fixtureLogPath()), AGENT_RESUME_FOLLOW_UP_LOG_FILE)
  )

const expectedInvocation = (
  fixture: AgentResumeCase,
  exactIdentity = false
): string => {
  const resumeArgs =
    exactIdentity && fixture.agentType === 'claude-code'
      ? ['--resume', fixture.conversationId]
      : fixture.resumeArgs

  return [fixture.executable, ...resumeArgs].join('\t')
}

const expectedFollowUp = (fixture: AgentResumeCase): string =>
  `${fixture.executable}\t${fixture.conversationId}`

const readStoredLayout = (): PersistedWorkspaceLayoutStore =>
  JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fixtureLogPath()), 'workspace-layouts.json'),
      'utf8'
    )
  ) as PersistedWorkspaceLayoutStore

const waitForWorkspaceRows = async (): Promise<void> => {
  const workspaceIds = AGENT_RESUME_WORKSPACES.map((workspace) => workspace.id)

  await browser.waitUntil(
    async () =>
      await browser.execute(
        (workspaceIds: string[]) =>
          workspaceIds.every(
            (id) => document.getElementById(`sidebar-activate-${id}`) !== null
          ),
        workspaceIds
      ),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'persisted agent workspaces did not restore',
    }
  )
}

const activateWorkspace = async (
  workspace: AgentResumeWorkspace
): Promise<void> => {
  const workspaceId = workspace.id
  const activated = await browser.execute((id: string) => {
    const button = document.getElementById(`sidebar-activate-${id}`)
    if (!(button instanceof HTMLButtonElement)) {
      return false
    }

    button.click()

    return true
  }, workspaceId)

  if (!activated) {
    throw new Error(`could not activate ${workspaceId}`)
  }

  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
      )) === workspaceId,
    {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: `${workspaceId} did not become visible`,
    }
  )
}

const countInvocations = (fixture: AgentResumeCase): number =>
  readInvocations().filter(
    (line) =>
      line === expectedInvocation(fixture) ||
      line === expectedInvocation(fixture, true)
  ).length

const countFollowUps = (fixture: AgentResumeCase): number =>
  readFollowUps().filter((line) => line === expectedFollowUp(fixture)).length

const assertTerminalRuntime = async (): Promise<boolean> => {
  const expectsNative =
    process.platform === 'darwin' &&
    process.env.VITE_GHOSTTY_NATIVE_MACOS_PARENT === '1'
  if (!expectsNative) {
    return false
  }

  await browser.waitUntil(
    async () =>
      await browser.execute(() => {
        const api = window.vimeflow?.ghosttyNative

        return Boolean(
          api?.update &&
          api.attachSecondary &&
          api.setSecondaryVisible &&
          document.querySelector('[data-testid="native-ghostty-pane"]')
        )
      }),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'agent resume did not mount the native Ghostty parent',
    }
  )

  expect(
    await browser.execute(() => ({
      hasNativePane:
        document.querySelector('[data-testid="native-ghostty-pane"]') !== null,
      hasXtermTextarea:
        document.querySelector('.xterm-helper-textarea') !== null,
    }))
  ).toEqual({ hasNativePane: true, hasXtermTextarea: false })

  return true
}

const waitForHydratedPane = async (
  workspaceId: string,
  fixture: AgentResumeCase,
  expectedInvocationCount: number,
  previousPtyId?: string
): Promise<string> => {
  let ptyId: string | null = null

  await browser.waitUntil(
    async () => {
      const state = await browser.execute(
        ({ paneId, workspaceId }: { paneId: string; workspaceId: string }) => {
          const slot = document.querySelector<HTMLElement>(
            `[data-testid="split-view-slot"][data-pane-id="${CSS.escape(
              paneId
            )}"]`
          )
          const panePtyId = slot?.dataset.ptyId ?? null

          return {
            visibleSessionId:
              window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null,
            panePtyId,
            paneMode: slot?.dataset.mode ?? null,
          }
        },
        { paneId: paneIdFor(fixture), workspaceId }
      )

      ptyId = state.panePtyId

      return (
        state.visibleSessionId === workspaceId &&
        ptyId !== null &&
        ptyId !== stalePtyIdFor(fixture) &&
        ptyId !== previousPtyId &&
        state.paneMode === 'attach' &&
        countFollowUps(fixture) === expectedInvocationCount &&
        countInvocations(fixture) === expectedInvocationCount
      )
    },
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: `${workspaceId} did not resume ${fixture.conversationId}`,
    }
  )

  if (ptyId === null) {
    throw new Error(`${workspaceId} resumed without a visible PTY id`)
  }

  return ptyId
}

const waitForHydratedWorkspace = async (
  workspace: AgentResumeWorkspace,
  expectedInvocationCount: number,
  previousPtyIds: ReadonlyMap<string, string> = new Map()
): Promise<Map<string, string>> => {
  const ptyIds = new Map<string, string>()

  for (const fixture of workspace.panes) {
    ptyIds.set(
      fixture.id,
      await waitForHydratedPane(
        workspace.id,
        fixture,
        expectedInvocationCount,
        previousPtyIds.get(fixture.id)
      )
    )
  }

  return ptyIds
}

const expectWorkspacesToRemainLazy = async (
  workspaces: readonly AgentResumeWorkspace[],
  expectedPtyIds: ReadonlyMap<string, string> = new Map()
): Promise<void> => {
  const fixtures = workspaces.flatMap((workspace) => workspace.panes)
  const states = await browser.execute(
    (paneIds: string[]) =>
      paneIds.map((paneId) => {
        const slot = document.querySelector<HTMLElement>(
          `[data-testid="split-view-slot"][data-pane-id="${CSS.escape(
            paneId
          )}"]`
        )

        return {
          paneId,
          mode: slot?.dataset.mode ?? null,
          ptyId: slot?.dataset.ptyId ?? null,
        }
      }),
    fixtures.map(paneIdFor)
  )

  expect(
    states.filter((state, index) => {
      const fixture = fixtures[index]

      return (
        state.mode !== 'awaiting-restart' ||
        state.ptyId !==
          (expectedPtyIds.get(fixture.id) ?? stalePtyIdFor(fixture))
      )
    })
  ).toEqual([])
}

const activeBackendPtyIds = async (): Promise<string[]> =>
  browser.execute(
    async () => (await window.__VIMEFLOW_E2E__?.listActivePtySessions()) ?? []
  )

const expectInvocationCountToStay = async (expected: number): Promise<void> => {
  expect(readInvocations()).toHaveLength(expected)
  await new Promise((resolve) => setTimeout(resolve, 750))
  expect(readInvocations()).toHaveLength(expected)
}

const assertDurableIdentities = (fallbackCaptured: boolean): void => {
  const stored = readStoredLayout()

  for (const workspace of AGENT_RESUME_WORKSPACES) {
    for (const fixture of workspace.panes) {
      const pane = stored.sessions
        .find((session) => session.id === workspace.id)
        ?.panes.find((candidate) => candidate.paneId === paneIdFor(fixture))

      expect(pane).toMatchObject({
        agentType: fixture.agentType,
        agentLauncher: fixture.executable,
        agentSessionId:
          fixture.initialAgentSessionId === null && !fallbackCaptured
            ? null
            : fixture.conversationId,
      })
    }
  }
}

const waitForPersistedActiveWorkspace = async (
  workspace: AgentResumeWorkspace
): Promise<void> => {
  await browser.waitUntil(
    async () =>
      readStoredLayout().sessions.find((session) => session.active)?.id ===
      workspace.id,
    {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: `${workspace.id} was not persisted as the active workspace`,
    }
  )
}

const persistFallbackIdentity = async (
  workspace: AgentResumeWorkspace,
  fixture: AgentResumeCase,
  ptyId: string
): Promise<void> => {
  await browser.execute(
    ({
      agentSessionId,
      sessionId,
    }: {
      agentSessionId: string
      sessionId: string
    }) => {
      window.__VIMEFLOW_E2E__?.emitBackendEvent('agent-session-title', {
        sessionId,
        agentSessionId,
        title: '',
        source: 'ai-generated',
      })
    },
    { agentSessionId: fixture.conversationId, sessionId: ptyId }
  )

  await browser.waitUntil(
    async () => {
      const pane = readStoredLayout()
        .sessions.find((session) => session.id === workspace.id)
        ?.panes.find((candidate) => candidate.paneId === paneIdFor(fixture))

      return (
        pane?.kind === 'shell' && pane.agentSessionId === fixture.conversationId
      )
    },
    {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: 'fallback agent identity was not persisted',
    }
  )
}

describe('Agent conversation resume lifecycle', () => {
  it('resumes only the last active workspace across 384 persisted panes and stays within the renderer budget', async () => {
    await waitForE2eBridge()
    await waitForWorkspaceRows()
    assertDurableIdentities(false)
    const nativeRuntime = await assertTerminalRuntime()

    expect(
      await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
      )
    ).toBe(INITIAL_ACTIVE_RESUME_WORKSPACE.id)

    const firstPtyIds = await waitForHydratedWorkspace(
      INITIAL_ACTIVE_RESUME_WORKSPACE,
      1
    )
    const fallbackPtyId = firstPtyIds.get(FALLBACK_RESUME_CASE.id)
    if (fallbackPtyId === undefined) {
      throw new Error('fallback pane hydrated without a PTY id')
    }
    await persistFallbackIdentity(
      INITIAL_ACTIVE_RESUME_WORKSPACE,
      FALLBACK_RESUME_CASE,
      fallbackPtyId
    )
    assertDurableIdentities(true)

    expect(await activeBackendPtyIds()).toHaveLength(
      INITIAL_ACTIVE_RESUME_WORKSPACE.panes.length
    )
    await expectWorkspacesToRemainLazy(
      AGENT_RESUME_WORKSPACES.filter(
        (workspace) => workspace.id !== INITIAL_ACTIVE_RESUME_WORKSPACE.id
      )
    )
    await expectInvocationCountToStay(
      INITIAL_ACTIVE_RESUME_WORKSPACE.panes.length
    )

    await activateWorkspace(STRESS_RESUME_WORKSPACE)
    for (const [fixtureId, ptyId] of await waitForHydratedWorkspace(
      STRESS_RESUME_WORKSPACE,
      1
    )) {
      firstPtyIds.set(fixtureId, ptyId)
    }
    const hydratedCases = [
      ...INITIAL_ACTIVE_RESUME_WORKSPACE.panes,
      ...STRESS_RESUME_WORKSPACE.panes,
    ]
    expect(await activeBackendPtyIds()).toHaveLength(hydratedCases.length)
    await expectInvocationCountToStay(hydratedCases.length)
    await expectWorkspacesToRemainLazy(
      AGENT_RESUME_WORKSPACES.filter(
        (workspace) =>
          workspace.id !== INITIAL_ACTIVE_RESUME_WORKSPACE.id &&
          workspace.id !== STRESS_RESUME_WORKSPACE.id
      )
    )
    await waitForPersistedActiveWorkspace(STRESS_RESUME_WORKSPACE)

    const oldWebdriverSessionId = browser.sessionId
    await browser.electron.execute((electron: ElectronModule) => {
      setTimeout(() => electron.app.quit(), 50)
    })
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await browser.reloadSession()

    expect(browser.sessionId).not.toBe(oldWebdriverSessionId)
    await waitForE2eBridge()
    await waitForWorkspaceRows()
    assertDurableIdentities(true)
    expect(await assertTerminalRuntime()).toBe(nativeRuntime)

    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => window.__VIMEFLOW_E2E__?.getVisibleSessionId() ?? null
        )) === STRESS_RESUME_WORKSPACE.id,
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: 'last active stress workspace was not reselected',
      }
    )

    const secondPtyIds = await waitForHydratedWorkspace(
      STRESS_RESUME_WORKSPACE,
      2,
      firstPtyIds
    )
    expect(await browser.execute(() => performance.now())).toBeLessThan(
      RENDERER_STRESS_RESUME_BUDGET_MS
    )
    expect(await activeBackendPtyIds()).toHaveLength(
      STRESS_RESUME_WORKSPACE.panes.length
    )
    await expectInvocationCountToStay(
      hydratedCases.length + STRESS_RESUME_WORKSPACE.panes.length
    )
    await expectWorkspacesToRemainLazy(
      AGENT_RESUME_WORKSPACES.filter(
        (workspace) => workspace.id !== STRESS_RESUME_WORKSPACE.id
      ),
      firstPtyIds
    )

    await activateWorkspace(INITIAL_ACTIVE_RESUME_WORKSPACE)
    for (const [fixtureId, ptyId] of await waitForHydratedWorkspace(
      INITIAL_ACTIVE_RESUME_WORKSPACE,
      2,
      firstPtyIds
    )) {
      secondPtyIds.set(fixtureId, ptyId)
    }

    for (const fixture of hydratedCases) {
      expect(secondPtyIds.get(fixture.id)).not.toBe(firstPtyIds.get(fixture.id))
    }

    const expectedInvocations = hydratedCases
      .flatMap((fixture) => [
        expectedInvocation(fixture),
        expectedInvocation(fixture, true),
      ])
      .sort()

    expect(readInvocations().sort()).toEqual(expectedInvocations)
    expect(readFollowUps().sort()).toEqual(
      hydratedCases
        .flatMap((fixture) => [
          expectedFollowUp(fixture),
          expectedFollowUp(fixture),
        ])
        .sort()
    )
    expect(await activeBackendPtyIds()).toHaveLength(hydratedCases.length)
  })
})
