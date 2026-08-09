import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { deriveSessionAgents } from './deriveSessionAgents'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/tmp/project',
  agentType: 'kimi',
  status: 'running',
  agentPhase: 'running',
  active: true,
  ...overrides,
})

describe('deriveSessionAgents', () => {
  test('running status without a running agent phase downgrades to idle (restored panes)', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', agentPhase: undefined }),
        pane({ id: 'p1', ptyId: 'pty-1' }),
      ],
    })

    expect(entries.map((e) => e.status)).toEqual(['idle', 'running'])
  })

  test('maps coding-agent shell panes in pane order', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', ptyId: 'pty-0', agentType: 'claude-code' }),
        pane({
          id: 'p1',
          ptyId: 'pty-1',
          agentType: 'codex',
          status: 'awaiting',
        }),
      ],
    })

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      paneId: 'p0',
      ptyId: 'pty-0',
      status: 'running',
    })
    expect(entries[0]?.agent.id).toBe('claude')
    expect(entries[1]).toMatchObject({ paneId: 'p1', status: 'awaiting' })
    expect(entries[1]?.agent.id).toBe('codex')
  })

  test('excludes generic and aider panes (shell-mapped agents)', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', agentType: 'generic' }),
        pane({ id: 'p1', agentType: 'aider' }),
        pane({ id: 'p2', agentType: 'opencode' }),
      ],
    })

    expect(entries.map((e) => e.paneId)).toEqual(['p2'])
  })

  test('excludes browser panes even with an agent type set', () => {
    const entries = deriveSessionAgents({
      panes: [pane({ kind: 'browser', agentType: 'kimi' })],
    })

    expect(entries).toEqual([])
  })

  test('keeps duplicate agents as separate rows', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', ptyId: 'pty-0' }),
        pane({ id: 'p1', ptyId: 'pty-1' }),
      ],
    })

    expect(entries.map((e) => e.agent.id)).toEqual(['kimi', 'kimi'])
  })

  test('label precedence: userLabel, then agentTitle, then working-on cwd dir', () => {
    const entries = deriveSessionAgents({
      panes: [
        pane({ id: 'p0', userLabel: 'my label', agentTitle: 'agent title' }),
        pane({ id: 'p1', ptyId: 'pty-1', agentTitle: 'agent title' }),
        pane({ id: 'p2', ptyId: 'pty-2', cwd: '/home/user/vimeflow/' }),
      ],
    })

    expect(entries.map((e) => e.label)).toEqual([
      'my label',
      'agent title',
      'working on vimeflow',
    ])
  })
})
