import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { PtyBufferDrain } from '../../terminal/orchestration/usePtyBufferDrain'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useSessionRestore } from './useSessionRestore'

const buildBuffer = (): PtyBufferDrain =>
  ({
    bufferEvent: vi.fn(),
    registerPending: vi.fn(),
    getBufferedSnapshot: vi.fn(() => []),
    notifyPaneReady: vi.fn(),
    dropAllForPty: vi.fn(),
  }) as never

describe('useSessionRestore', () => {
  test('attaches onData listener before listSessions', async () => {
    const order: string[] = []

    const service = {
      onData: vi.fn().mockImplementation(() => {
        order.push('onData-attached')

        return Promise.resolve((): void => undefined)
      }),
      listSessions: vi.fn().mockImplementation(() => {
        order.push('listSessions-called')

        return Promise.resolve({ sessions: [], activeSessionId: null })
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => {
      expect(service.listSessions).toHaveBeenCalled()
    })
    expect(order).toEqual(['onData-attached', 'listSessions-called'])
  })

  test('builds one-pane sessions from alive infos', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: 'pty-1',
            cwd: '/home/will/repo',
            status: {
              kind: 'Alive',
              pid: 1234,
              replay_data: '',
              replay_end_offset: BigInt(0),
            },
          },
        ],
        activeSessionId: 'pty-1',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onRestore).toHaveBeenCalled()
    const firstCall = onRestore.mock.calls[0]
    if (!firstCall) {
      throw new Error('expected onRestore to be called')
    }
    const restoredSessions = firstCall[0]

    expect(restoredSessions).toHaveLength(1)
    expect(restoredSessions[0].panes[0].ptyId).toBe('pty-1')
    expect(restoredSessions[0].panes[0].active).toBe(true)
    expect(restoredSessions[0].panes[0].status).toBe('running')
  })

  // Fragmentation regression (captured evidence for the multi-pane restore
  // bug): when several PTYs belonged to ONE workspace session (e.g. a quad
  // layout with 3 agents + 1 shell), restore currently fragments them into
  // one single-pane session PER PTY, because the backend cache persists no
  // pane grouping (see the multi-pane session-restore plan). This test pins
  // the buggy behavior so the fix can flip it to a single grouped session.
  test('FRAGMENTS multiple PTYs into separate single-pane sessions (bug)', async () => {
    const alive = (id: string, cwd: string): unknown => ({
      id,
      cwd,
      status: {
        kind: 'Alive',
        pid: 1000,
        replay_data: '',
        replay_end_offset: BigInt(0),
      },
    })

    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi.fn().mockResolvedValue({
        // Four PTYs that (conceptually) were the four panes of one quad
        // workspace session in the same repo.
        sessions: [
          alive('pty-a', '/home/will/repo'),
          alive('pty-b', '/home/will/repo'),
          alive('pty-c', '/home/will/repo'),
          alive('pty-d', '/home/will/repo'),
        ],
        activeSessionId: 'pty-a',
      }),
    } as unknown as ITerminalService
    const onRestore = vi.fn<(sessions: Session[]) => void>()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const restoredSessions = onRestore.mock.calls[0]?.[0]
    if (!restoredSessions) {
      throw new Error('expected onRestore to be called')
    }

    // BUG: 4 PTYs -> 4 separate sessions, each single-pane.
    expect(restoredSessions).toHaveLength(4)
    for (const session of restoredSessions) {
      expect(session.layout).toBe('single')
      expect(session.panes).toHaveLength(1)
    }
    // The fix target: this should become exactly ONE quad-layout session
    // owning all four panes.
  })

  test('null active id with no sessions leaves activeSessionId null', async () => {
    const service = {
      onData: vi.fn().mockResolvedValue(() => undefined),
      listSessions: vi
        .fn()
        .mockResolvedValue({ sessions: [], activeSessionId: null }),
    } as unknown as ITerminalService
    const onRestore = vi.fn()
    const onActiveResolved = vi.fn()

    const { result } = renderHook(() =>
      useSessionRestore({
        service,
        buffer: buildBuffer(),
        onRestore,
        onActiveResolved,
      })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(onActiveResolved).not.toHaveBeenCalled()
  })
})
