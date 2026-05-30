import { test, expect } from 'vitest'
import { type PaneCandidate, resolveCandidatePanes } from './activePanePicker'

const makePane = (
  overrides: Partial<PaneCandidate> & { paneId: string }
): PaneCandidate => ({
  ptyId: `pty-${overrides.paneId}`,
  tabName: 'tab',
  agentLabel: 'Claude Code',
  cwd: '/repo',
  status: 'running',
  isFocused: false,
  ...overrides,
})

test('0 candidates -> { kind: none }', () => {
  const result = resolveCandidatePanes({
    allPanes: [],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'none' })
})

test('exactly 1 matching -> { kind: one, pane }', () => {
  const pane = makePane({ paneId: 'p1' })

  const result = resolveCandidatePanes({
    allPanes: [pane],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'one', pane })
})

test('2+ matching with isFocused true on one -> { kind: one, pane: the focused }', () => {
  const paneA = makePane({ paneId: 'p1' })
  const paneB = makePane({ paneId: 'p2', isFocused: true })

  const result = resolveCandidatePanes({
    allPanes: [paneA, paneB],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'one', pane: paneB })
})

test('2+ matching with no isFocused pane -> { kind: many, candidates }', () => {
  const paneA = makePane({ paneId: 'p1' })
  const paneB = makePane({ paneId: 'p2' })

  const result = resolveCandidatePanes({
    allPanes: [paneA, paneB],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'many', candidates: [paneA, paneB] })
})

test('a pane with cwd /repo/sub matches diffCwd /repo (descendant)', () => {
  const pane = makePane({ paneId: 'p1', cwd: '/repo/sub' })

  const result = resolveCandidatePanes({
    allPanes: [pane],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'one', pane })
})

test('panes filtered out when status !== running', () => {
  const idle = makePane({ paneId: 'p1', status: 'idle' })
  const exited = makePane({ paneId: 'p2', status: 'exited' })
  const error = makePane({ paneId: 'p3', status: 'error' })

  const result = resolveCandidatePanes({
    allPanes: [idle, exited, error],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'none' })
})

test('panes filtered out when agentLabel not in { Claude Code, Codex }', () => {
  const pane = makePane({ paneId: 'p1', agentLabel: 'Other Agent' })

  const result = resolveCandidatePanes({
    allPanes: [pane],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'none' })
})

test('resolves focused pane correctly even when multiple panes share the same paneId', () => {
  const paneA = makePane({ paneId: 'p0', ptyId: 'pty-a', isFocused: false })
  const paneB = makePane({ paneId: 'p0', ptyId: 'pty-b', isFocused: true })

  const result = resolveCandidatePanes({
    allPanes: [paneA, paneB],
    diffCwd: '/repo',
  })

  expect(result).toEqual({ kind: 'one', pane: paneB })
})
