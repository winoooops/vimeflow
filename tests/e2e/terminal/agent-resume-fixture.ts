import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const AGENT_RESUME_SPEC_FILE = 'agent-resume-lifecycle.spec.ts'
export const AGENT_RESUME_LOG_FILE = 'agent-resume-invocations.tsv'
export const AGENT_RESUME_FOLLOW_UP_LOG_FILE = 'agent-resume-follow-ups.tsv'

type AgentType = 'claude-code' | 'codex' | 'kimi' | 'opencode'
type AgentExecutable = 'claude' | 'codex' | 'kimi' | 'opencode'

export interface AgentResumeCase {
  id: string
  agentType: AgentType
  executable: AgentExecutable
  conversationId: string
  initialAgentSessionId: string | null
  resumeArgs: readonly string[]
}

export interface AgentResumeWorkspace {
  id: string
  active: boolean
  layout: 'grid3x2'
  panes: readonly AgentResumeCase[]
}

const WORKSPACE_COUNT = 64
const MAX_PANES_PER_WORKSPACE = 6
const STRESS_WORKSPACE_INDEX = 17

export const FALLBACK_RESUME_CASE: AgentResumeCase = {
  id: 'claude-fallback',
  agentType: 'claude-code',
  executable: 'claude',
  conversationId: 'claude-conversation-e2e',
  initialAgentSessionId: null,
  resumeArgs: ['--continue'],
}

const initialActiveCases: readonly AgentResumeCase[] = [
  FALLBACK_RESUME_CASE,
  {
    id: 'initial-codex',
    agentType: 'codex',
    executable: 'codex',
    conversationId: 'codex-conversation-e2e',
    initialAgentSessionId: 'codex-conversation-e2e',
    resumeArgs: ['resume', 'codex-conversation-e2e'],
  },
  {
    id: 'initial-kimi',
    agentType: 'kimi',
    executable: 'kimi',
    conversationId: 'kimi-conversation-e2e',
    initialAgentSessionId: 'kimi-conversation-e2e',
    resumeArgs: ['--session', 'kimi-conversation-e2e'],
  },
  {
    id: 'initial-opencode',
    agentType: 'opencode',
    executable: 'opencode',
    conversationId: 'opencode-conversation-e2e',
    initialAgentSessionId: 'opencode-conversation-e2e',
    resumeArgs: ['--session', 'opencode-conversation-e2e'],
  },
  ...[1, 2].map(
    (suffix): AgentResumeCase => ({
      id: `initial-codex-${suffix}`,
      agentType: 'codex',
      executable: 'codex',
      conversationId: `codex-initial-${suffix}-e2e`,
      initialAgentSessionId: `codex-initial-${suffix}-e2e`,
      resumeArgs: ['resume', `codex-initial-${suffix}-e2e`],
    })
  ),
]

const codexCasesFor = (workspaceIndex: number): AgentResumeCase[] =>
  Array.from({ length: MAX_PANES_PER_WORKSPACE }, (_, paneIndex) => {
    const id = `workspace-${workspaceIndex}-codex-${paneIndex}`
    const conversationId = `${id}-conversation-e2e`

    return {
      id,
      agentType: 'codex',
      executable: 'codex',
      conversationId,
      initialAgentSessionId: conversationId,
      resumeArgs: ['resume', conversationId],
    }
  })

export const AGENT_RESUME_WORKSPACES: readonly AgentResumeWorkspace[] =
  Array.from({ length: WORKSPACE_COUNT }, (_, workspaceIndex) => ({
    id: `e2e-resume-workspace-${workspaceIndex}`,
    active: workspaceIndex === WORKSPACE_COUNT - 1,
    layout: 'grid3x2',
    panes:
      workspaceIndex === WORKSPACE_COUNT - 1
        ? initialActiveCases
        : codexCasesFor(workspaceIndex),
  }))

export const INITIAL_ACTIVE_RESUME_WORKSPACE =
  AGENT_RESUME_WORKSPACES[WORKSPACE_COUNT - 1]

export const STRESS_RESUME_WORKSPACE =
  AGENT_RESUME_WORKSPACES[STRESS_WORKSPACE_INDEX]

export const AGENT_RESUME_CASES = AGENT_RESUME_WORKSPACES.flatMap(
  (workspace) => workspace.panes
)

export const paneIdFor = (fixture: AgentResumeCase): string =>
  `e2e-pane-${fixture.id}`

export const stalePtyIdFor = (fixture: AgentResumeCase): string =>
  `e2e-stale-${fixture.id}`

export interface InstalledAgentResumeFixture {
  binDir: string
  followUpLogPath: string
  logPath: string
}

export const installAgentResumeFixture = (
  userDataDir: string,
  workingDirectory: string
): InstalledAgentResumeFixture => {
  const source = fileURLToPath(
    new URL('../fixtures/agents/fake-resume-agent', import.meta.url)
  )
  const binDir = path.join(userDataDir, 'fake-agent-bin')
  const logPath = path.join(userDataDir, AGENT_RESUME_LOG_FILE)
  const followUpLogPath = path.join(
    userDataDir,
    AGENT_RESUME_FOLLOW_UP_LOG_FILE
  )

  fs.mkdirSync(binDir, { recursive: true })
  for (const executableName of new Set(
    AGENT_RESUME_CASES.map((fixture) => fixture.executable)
  )) {
    const executable = path.join(binDir, executableName)

    fs.copyFileSync(source, executable)
    fs.chmodSync(executable, 0o755)
  }

  fs.writeFileSync(logPath, '')
  fs.writeFileSync(followUpLogPath, '')
  fs.writeFileSync(
    path.join(userDataDir, 'workspace-layouts.json'),
    JSON.stringify(
      {
        version: 1,
        customPaneLayouts: [],
        sessions: AGENT_RESUME_WORKSPACES.map((workspace) => ({
          id: workspace.id,
          projectId: 'proj-1',
          layout: workspace.layout,
          placements: [],
          workingDirectory,
          active: workspace.active,
          open: true,
          panes: workspace.panes.map((fixture, index) => ({
            kind: 'shell',
            paneId: paneIdFor(fixture),
            paneIndex: index,
            active: index === 0,
            ptyId: stalePtyIdFor(fixture),
            cwd: workingDirectory,
            agentType: fixture.agentType,
            agentSessionId: fixture.initialAgentSessionId,
            agentLauncher: fixture.executable,
          })),
        })),
      },
      null,
      2
    )
  )

  return { binDir, followUpLogPath, logPath }
}
