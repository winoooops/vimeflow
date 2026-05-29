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

    expect(setWorkspaceSessions).not.toHaveBeenCalled()
  })

  test('does not push when there are no sessions (per-pty kill cleanup handles drops)', () => {
    const setWorkspaceSessions = vi.fn().mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    renderHook(() =>
      usePushWorkspaceGrouping({ service, loading: false, sessions: [] })
    )

    expect(setWorkspaceSessions).not.toHaveBeenCalled()
  })

  // Push fires SYNCHRONOUSLY on each `sessions` change. A debounced timer was
  // observed to be cancelled by an unmount (e.g. Cmd+R within ~100ms of the
  // last pane addition) before it could fire, leaving the cache without
  // grouping for the last pane — exactly the symptom that reintroduced
  // fragmentation in the real dev build.
  test('pushes the snapshot immediately when sessions change', () => {
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

    expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

    const payload = setWorkspaceSessions.mock.calls[0]?.[0] as
      | { sessions: { id: string; layout: string; panes: unknown[] }[] }
      | undefined
    expect(payload?.sessions[0]?.id).toBe('ws-1')
    expect(payload?.sessions[0]?.layout).toBe('vsplit')
    expect(payload?.sessions[0]?.panes).toHaveLength(2)
  })

  // Codex P2 (PR #290): fire-and-forget pushes could overlap two snapshots
  // in flight at the sidecar, and the older one's mutate could win last,
  // dropping the newer pane/layout. The single-flight queue ensures the
  // SECOND push only starts after the FIRST resolves, and intermediate
  // snapshots collapse into one (latest wins).
  test('serializes concurrent pushes: second snapshot waits for the first to resolve', async () => {
    // The first push hangs until we release it; the second push must NOT
    // start until then.
    let releaseFirst: (() => void) | undefined
    const firstStarted = vi.fn()
    const secondStarted = vi.fn()

    const setWorkspaceSessions = vi
      .fn()
      .mockImplementationOnce(async () => {
        firstStarted()
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      })
      .mockImplementationOnce(() => {
        secondStarted()

        return Promise.resolve()
      })
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    const first = [
      session('ws-1', 'single', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
      ]),
    ]

    const second = [
      session('ws-1', 'vsplit', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
      ]),
    ]

    const { rerender } = renderHook(
      ({ sessions }) =>
        usePushWorkspaceGrouping({ service, loading: false, sessions }),
      { initialProps: { sessions: first as readonly Session[] } }
    )

    // First push started but is held mid-flight.
    await waitFor(() => expect(firstStarted).toHaveBeenCalled())
    expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
    expect(secondStarted).not.toHaveBeenCalled()

    // While the first is in flight, mutate sessions; the second push must
    // queue, not race the first.
    rerender({ sessions: second as readonly Session[] })

    // Confirm the second push didn't start eagerly.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(secondStarted).not.toHaveBeenCalled()

    // Release the first push; the queued second one drains next.
    releaseFirst?.()

    await waitFor(() => expect(secondStarted).toHaveBeenCalled())
    expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)

    // Second call carries the latest snapshot (2 panes), not the stale one.
    const secondPayload = setWorkspaceSessions.mock.calls[1]?.[0] as
      | { sessions: { panes: { ptyId: string }[] }[] }
      | undefined
    expect(secondPayload?.sessions[0]?.panes.map((p) => p.ptyId)).toEqual([
      'pty-a',
      'pty-b',
    ])
  })

  // PR #290 cycle 5: Claude MEDIUM — the cycle-1 drain cleared `pending`
  // before the try block. On IPC failure it logged a warning but didn't
  // restore `pending`, so a sidecar crash mid-push would permanently drop
  // that snapshot. The next `sessions` change would enqueue a NEW snapshot
  // and recover, but if the user stopped interacting (or the app exited)
  // the cache stays stale and the next reload fragments. The fix restores
  // `pending` in the catch when no newer snapshot arrived during the await.
  test('restores the snapshot for retry when the IPC fails', async () => {
    let firstCallReject: ((err: unknown) => void) | undefined

    const setWorkspaceSessions = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            firstCallReject = reject
          })
      )
      .mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    const initial = [
      session('ws-1', 'vsplit', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
      ]),
    ]

    const { rerender } = renderHook(
      ({ sessions }) =>
        usePushWorkspaceGrouping({ service, loading: false, sessions }),
      { initialProps: { sessions: initial as readonly Session[] } }
    )

    // The first push is in flight.
    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(1))

    // Reject the in-flight IPC and let the catch's microtask drain. The
    // catch restores `pending` to the failed snapshot and breaks out of
    // the drain loop (cycle 6: no tight-loop retry).
    firstCallReject?.(new Error('sidecar crashed'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The next `sessions` change re-enters the effect, which calls drain
    // again. With the cycle-5 restore in place, the snapshot survives and
    // the second IPC eventually fires; without it, the first failure
    // would have permanently lost the snapshot.
    rerender({ sessions: [...initial] as readonly Session[] })

    await waitFor(() => {
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
    })
  })

  // PR #290 cycle 6: Claude MEDIUM + Codex P2 — the cycle-5 retry restore
  // re-entered the `while` loop on the same drain call. If the IPC keeps
  // failing (sidecar down), the loop spun the microtask queue with no
  // backoff. Adding a `return` after the restore exits the drain on
  // failure; the next `sessions` change re-enters via the effect.
  test('does not tight-loop when the IPC keeps failing', async () => {
    // setWorkspaceSessions ALWAYS rejects. Without the cycle-6 return the
    // drain would call it repeatedly in a tight loop until React unmounts.
    const setWorkspaceSessions = vi
      .fn()
      .mockRejectedValue(new Error('sidecar down'))
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    renderHook(() =>
      usePushWorkspaceGrouping({
        service,
        loading: false,
        sessions: [
          session('ws-1', 'single', [
            pane({ id: 'p0', ptyId: 'pty-a', active: true }),
          ]),
        ],
      })
    )

    // Give the drain ample time to react. Even with the failure, only
    // ONE IPC call should fire on this effect run; the drain returns
    // after restoring `pending` and the next entry comes from a future
    // sessions change (not from a tight-loop retry).
    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
  })

  // Latest-wins coalesce: when several sessions changes pile up during one
  // in-flight push, only the MOST RECENT snapshot is sent next — intermediate
  // ones are dropped (the cache replaces its groupings map on every push, so
  // intermediates would be overwritten anyway).
  test('coalesces intermediate snapshots while a push is in flight (latest wins)', async () => {
    let releaseFirst: (() => void) | undefined

    const setWorkspaceSessions = vi
      .fn()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      })
      .mockResolvedValue(undefined)
    const service = { setWorkspaceSessions } as unknown as ITerminalService

    const v1 = [
      session('ws-1', 'single', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
      ]),
    ]

    const v2 = [
      session('ws-1', 'vsplit', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
      ]),
    ]

    const v3 = [
      session('ws-1', 'quad', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
        pane({ id: 'p2', ptyId: 'pty-c', active: false }),
      ]),
    ]

    const { rerender } = renderHook(
      ({ sessions }) =>
        usePushWorkspaceGrouping({ service, loading: false, sessions }),
      { initialProps: { sessions: v1 as readonly Session[] } }
    )

    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(1))

    // Stack two more updates while the first is still pending.
    rerender({ sessions: v2 as readonly Session[] })
    rerender({ sessions: v3 as readonly Session[] })

    // Release the first; the queue drains the latest pending snapshot (v3)
    // and skips v2 entirely.
    releaseFirst?.()

    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(2))

    const secondPayload = setWorkspaceSessions.mock.calls[1]?.[0] as
      | { sessions: { panes: { ptyId: string }[] }[] }
      | undefined
    expect(secondPayload?.sessions[0]?.panes.map((p) => p.ptyId)).toEqual([
      'pty-a',
      'pty-b',
      'pty-c',
    ])
  })
})
