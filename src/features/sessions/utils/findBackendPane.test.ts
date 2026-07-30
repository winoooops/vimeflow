import { test, expect } from 'vitest'
import { findBackendSessionPane } from './findBackendPane'
import type { Pane, Session } from '../types'

const makeSession = (panes: Pane[]): Session =>
  ({
    id: 's1',
    projectId: 'proj-1',
    name: 'session 1',
    status: 'running',
    workingDirectory: '/',
    agentType: 'generic',
    layout: 'single',
    activityPanelCollapsed: false,
    panes,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    activity: {
      filesTouched: [],
      commandsRun: [],
      gitOperations: [],
    },
  }) as unknown as Session

const shellPane = (id: string, status: Pane['status'], active = false): Pane =>
  ({
    kind: 'shell',
    id,
    ptyId: id,
    cwd: '/',
    agentType: 'generic',
    status,
    active,
    pid: 1,
  }) as unknown as Pane

const browserPane = (id: string, active = false): Pane =>
  ({
    kind: 'browser',
    id,
    ptyId: id,
    cwd: '/',
    agentType: 'generic',
    status: 'running',
    active,
    browserUrl: 'https://example.com',
  }) as unknown as Pane

test('active shell -> returns that pane', () => {
  const pane = shellPane('p1', 'running', true)
  const session = makeSession([pane, shellPane('p2', 'running', false)])

  expect(findBackendSessionPane(session)).toBe(pane)
})

test('active browser + a running shell present -> returns the running shell', () => {
  const runningShell = shellPane('p1', 'running', false)
  const exitedShell = shellPane('p2', 'completed', false)

  const session = makeSession([
    runningShell,
    exitedShell,
    browserPane('p3', true),
  ])

  expect(findBackendSessionPane(session)).toBe(runningShell)
})

test('active browser + only exited shells -> returns the first shell', () => {
  const firstShell = shellPane('p1', 'completed', false)
  const secondShell = shellPane('p2', 'completed', false)

  const session = makeSession([
    firstShell,
    secondShell,
    browserPane('p3', true),
  ])

  expect(findBackendSessionPane(session)).toBe(firstShell)
})

test('active browser + an idle shell present -> returns the idle shell', () => {
  const exitedShell = shellPane('p1', 'completed', false)
  const idleShell = shellPane('p2', 'idle', false)

  const session = makeSession([exitedShell, idleShell, browserPane('p3', true)])

  // an idle agent (finished its turn, PTY alive) is still the backend pane
  expect(findBackendSessionPane(session)).toBe(idleShell)
})
