import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { emptyActivity } from '../constants'
import type { Pane, Session } from '../types'
import {
  buildGroupingSnapshot,
  usePushWorkspaceGrouping,
} from './usePushWorkspaceGrouping'

const pane = (overrides: Partial<Pane> & Pick<Pane, 'id' | 'ptyId'>): Pane => ({
  cwd: '/r',
  agentType: 'generic',
  status: 'running',
  active: false,
  ...overrides,
})

const session = (
  id: string,
  layout: Session['layout'],
  panes: Pane[]
): Session => ({
  id,
  projectId: 'proj-1',
  name: id,
  status: 'running',
  workingDirectory: '/r',
  agentType: 'generic',
  layout,
  activityPanelCollapsed: false,
  panes,
  createdAt: '2026-05-28T00:00:00Z',
  lastActivityAt: '2026-05-28T00:00:00Z',
  activity: { ...emptyActivity },
})

describe('buildGroupingSnapshot', () => {
  test('converts a multi-pane session to the IPC payload shape', () => {
    const snapshot = buildGroupingSnapshot([
      session('ws-1', 'vsplit', [
        pane({
          id: 'p0',
          ptyId: 'pty-a',
          active: true,
          agentType: 'claude-code',
        }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false, agentType: 'generic' }),
      ]),
    ])
    expect(snapshot.sessions).toEqual([
      {
        id: 'ws-1',
        layout: 'vsplit',
        panes: [
          {
            ptyId: 'pty-a',
            paneId: 'p0',
            paneIndex: 0,
            agentType: 'claude-code',
            active: true,
          },
          {
            ptyId: 'pty-b',
            paneId: 'p1',
            paneIndex: 1,
            agentType: 'generic',
            active: false,
          },
        ],
      },
    ])
  })
})

describe('usePushWorkspaceGrouping', () => {
  test('does not push while loading', () => {
    vi.useFakeTimers()
    const setWorkspaceSessions = vi.fn().mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    renderHook(() =>
      usePushWorkspaceGrouping({
        service,
        loading: true,
        sessions: [
          session('ws-1', 'single', [
            pane({ id: 'p0', ptyId: 'a', active: true }),
          ]),
        ],
      })
    )
    vi.advanceTimersByTime(500)
    expect(setWorkspaceSessions).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  test('does not push when there are no sessions (per-pty kill cleanup handles drops)', () => {
    vi.useFakeTimers()
    const setWorkspaceSessions = vi.fn().mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    renderHook(() =>
      usePushWorkspaceGrouping({ service, loading: false, sessions: [] })
    )
    vi.advanceTimersByTime(500)
    expect(setWorkspaceSessions).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  test('pushes a snapshot after a brief debounce when sessions change', async () => {
    const setWorkspaceSessions = vi.fn().mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    renderHook(() =>
      usePushWorkspaceGrouping({
        service,
        loading: false,
        sessions: [
          session('ws-1', 'vsplit', [
            pane({ id: 'p0', ptyId: 'pty-a', active: true }),
            pane({ id: 'p1', ptyId: 'pty-b', active: false }),
          ]),
        ],
      })
    )

    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(1))

    const payload = setWorkspaceSessions.mock.calls[0]?.[0] as
      | { sessions: { id: string; layout: string; panes: unknown[] }[] }
      | undefined
    expect(payload?.sessions[0]?.id).toBe('ws-1')
    expect(payload?.sessions[0]?.layout).toBe('vsplit')
    expect(payload?.sessions[0]?.panes).toHaveLength(2)
  })
})
