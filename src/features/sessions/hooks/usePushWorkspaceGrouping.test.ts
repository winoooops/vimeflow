import { renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
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
        // Stable session baseline cwd; pulled from `session.workingDirectory`
        // (see the `session` helper at the top of the file).
        workingDirectory: '/r',
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
    vi.useFakeTimers()
    try {
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

      renderHook(
        ({ sessions }) =>
          usePushWorkspaceGrouping({ service, loading: false, sessions }),
        { initialProps: { sessions: initial as readonly Session[] } }
      )

      // The first push is in flight.
      await vi.waitFor(() =>
        expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
      )

      // Reject the in-flight IPC. The catch restores `pending` to the
      // failed snapshot and schedules a 5s retry timer (cycle 6: no
      // tight-loop retry). Cycle 16: dep-change rerenders no longer
      // bypass the scheduled timer because the immediate-drain kick is
      // gated on `retryTimerRef.current === null`, so we drive the
      // retry via the timer rather than a rerender.
      firstCallReject?.(new Error('sidecar crashed'))
      await Promise.resolve()
      await Promise.resolve()

      await vi.advanceTimersByTimeAsync(5000)

      await vi.waitFor(() => {
        expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
      })
    } finally {
      vi.useRealTimers()
    }
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

  // PR #290 cycle 7: Claude MEDIUM + Codex P2 — after cycle 6's `return`,
  // a transient IPC failure left the restored snapshot sitting in
  // `pending` indefinitely if the user made no structural change
  // afterwards. The fix is a single 5s deferred retry timer scheduled on
  // failure: it re-enters drain so a sidecar that recovers in seconds
  // resyncs the cache without waiting for the next sessions change.
  test('schedules a deferred retry after a transient failure', async () => {
    vi.useFakeTimers()
    try {
      const setWorkspaceSessions = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient sidecar hiccup'))
        .mockResolvedValue(undefined)
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

      // First call fires and rejects. Let the catch's microtask run.
      await vi.advanceTimersByTimeAsync(0)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // No premature retry. Backoff is 5s; well before that nothing fires.
      await vi.advanceTimersByTimeAsync(1000)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // After the full backoff the deferred retry drains the restored
      // snapshot and the second call succeeds.
      await vi.advanceTimersByTimeAsync(5000)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 7 (post-verify): Codex caught a regression in the
  // initial cycle-7 patch — if the hook unmounts WHILE a push is mid-
  // await, cleanup runs while `retryTimer` is still null, then the
  // catch (running later as a microtask) would schedule a NEW timer
  // that escaped cancellation and could fire a stale push at an
  // unmounted hook. A mount-lifetime `mountedRef` closes the race:
  // it flips false only on real unmount (NOT on dep-change cleanups),
  // so the catch checks it before scheduling, and the timer callback
  // re-checks it before re-entering drain.
  test('does not schedule a retry after unmount during an in-flight push', async () => {
    vi.useFakeTimers()
    try {
      let rejectInFlight: ((err: unknown) => void) | undefined

      const setWorkspaceSessions = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectInFlight = reject
            })
        )
        .mockResolvedValue(undefined)
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      const { unmount } = renderHook(() =>
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

      // First IPC is in flight.
      await vi.advanceTimersByTimeAsync(0)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Unmount BEFORE the IPC rejects. The one-shot useEffect cleanup
      // flips `mountedRef.current` to false.
      unmount()

      // Now reject — the catch runs post-cleanup. With the mountedRef
      // guard, no retry timer is scheduled.
      rejectInFlight?.(new Error('sidecar crashed at shutdown'))
      await vi.advanceTimersByTimeAsync(0)

      // Advance well past the backoff window. No second IPC fires.
      await vi.advanceTimersByTimeAsync(10000)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 7 (post-verify-2): Codex re-verify caught that an
  // earlier per-effect disposal flag conflated unmount with dep-
  // change cleanup. When `sessions` changes while a push is mid-await,
  // the old effect's cleanup ran and the flag was set; the rejected
  // catch then SKIPPED the retry timer even though the new effect had
  // already queued a fresh snapshot in `pending` (its drain returned at
  // the `inFlight` guard and is waiting for someone to drain). Without
  // the retry, the new snapshot sits there forever. Switching to a
  // mount-lifetime ref preserves the retry on dependency changes while
  // still suppressing it post-unmount.
  test('retries after a rerender lands during a failed in-flight push', async () => {
    vi.useFakeTimers()
    try {
      let rejectFirst: ((err: unknown) => void) | undefined

      const setWorkspaceSessions = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirst = reject
            })
        )
        .mockResolvedValue(undefined)
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      const initial = [
        session('ws-1', 'single', [
          pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        ]),
      ]

      const updated = [
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

      // First IPC is in flight.
      await vi.advanceTimersByTimeAsync(0)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Rerender with a new sessions reference WHILE the IPC is still
      // mid-await. This triggers the old effect's cleanup and starts a
      // new effect whose drain hits the `inFlight` guard and returns.
      rerender({ sessions: updated as readonly Session[] })

      // Now reject the old IPC. The catch must NOT skip retry just
      // because cleanup ran — the hook is still mounted, and the new
      // snapshot is sitting in `pending`.
      rejectFirst?.(new Error('transient'))
      await vi.advanceTimersByTimeAsync(0)

      // Backoff fires and the retry drains the new snapshot.
      await vi.advanceTimersByTimeAsync(5000)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)

      // Second call carries the NEW snapshot (2 panes), not the stale one.
      const secondPayload = setWorkspaceSessions.mock.calls[1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined
      expect(secondPayload?.sessions[0]?.panes.map((p) => p.ptyId)).toEqual([
        'pty-a',
        'pty-b',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 8 (post-verify): Codex re-verify caught that even with
  // a shared `retryTimerRef`, the timer's callback would still invoke
  // the OLD effect's `drain` closure if it was scheduled by the old
  // effect — the OLD drain captured the OLD `service`. If `service`
  // changes between effect runs (e.g. wrapper hot-swaps the service),
  // the deferred retry would push through the stale service. The fix
  // is a `latestDrainRef` that always points at the most recent drain.
  // This test changes the service between renders during a failed in-
  // flight push and verifies the retry IPC fires on the NEW service.
  test('routes the deferred retry through the latest service after a dep change', async () => {
    vi.useFakeTimers()
    try {
      let rejectOldIpc: ((err: unknown) => void) | undefined

      const oldService = {
        setWorkspaceSessions: vi.fn().mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectOldIpc = reject
            })
        ),
      } as unknown as ITerminalService

      const newService = {
        setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
      } as unknown as ITerminalService

      const sessions = [
        session('ws-1', 'single', [
          pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        ]),
      ]

      const { rerender } = renderHook(
        ({ service }) =>
          usePushWorkspaceGrouping({
            service,
            loading: false,
            sessions,
          }),
        { initialProps: { service: oldService } }
      )

      // First IPC fires on the old service and is held mid-await.
      await vi.advanceTimersByTimeAsync(0)
      expect(oldService.setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Service swaps to the new one while the old IPC is still in
      // flight. The new effect's drain returns at the `inFlight` guard.
      rerender({ service: newService })

      // Old IPC rejects. The catch schedules a retry timer.
      rejectOldIpc?.(new Error('transient'))
      await vi.advanceTimersByTimeAsync(0)

      // Backoff fires. The retry must dispatch through the NEW service,
      // not the OLD one — even though the timer was scheduled in the
      // old effect's closure.
      await vi.advanceTimersByTimeAsync(5000)
      expect(newService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
      // Old service must NOT have been called again.
      expect(oldService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 7 (post-verify-3): Codex re-verify caught that the
  // mount-lifetime ref initialized with `useRef(true)` is NOT
  // StrictMode-safe — StrictMode dev runs each effect as setup →
  // cleanup → setup, and without re-asserting `mountedRef.current =
  // true` in setup, the second setup leaves the ref stuck at false for
  // the whole mounted lifetime. The retry gate then degrades to "never
  // schedule" in dev. This test wraps `renderHook` in `<StrictMode>`
  // and verifies the retry timer still fires after a transient IPC
  // failure even though StrictMode replayed the mount effect.
  test('schedules the deferred retry even under React StrictMode replay', async () => {
    vi.useFakeTimers()
    try {
      const setWorkspaceSessions = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(undefined)
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      renderHook(
        () =>
          usePushWorkspaceGrouping({
            service,
            loading: false,
            sessions: [
              session('ws-1', 'single', [
                pane({ id: 'p0', ptyId: 'pty-a', active: true }),
              ]),
            ],
          }),
        { wrapper: StrictMode }
      )

      // StrictMode replays the effect setup/cleanup once in dev. The
      // first IPC fires and rejects.
      await vi.advanceTimersByTimeAsync(0)
      // StrictMode may invoke the effect twice on mount; we accept any
      // initial count but must see the retry happen on top of it.
      const initialCount = setWorkspaceSessions.mock.calls.length
      expect(initialCount).toBeGreaterThanOrEqual(1)

      // Drain the 5s backoff. The retry must fire even though
      // StrictMode flipped mountedRef during its replay.
      await vi.advanceTimersByTimeAsync(5000)
      expect(setWorkspaceSessions.mock.calls.length).toBeGreaterThan(
        initialCount
      )
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 14: Claude MEDIUM — the success continuation
  // (`if (pending !== null) void latestDrainRef.current?.()`) did NOT
  // check `mountedRef`, while the retry-timer path did. If the
  // component unmounted mid-await AND a newer snapshot landed in
  // `pending` during the await, the continuation would still fire an
  // IPC against the torn-down hook. The cycle-14 guard short-circuits
  // when `mountedRef.current` flipped false, mirroring the catch's
  // retry-timer pattern.
  test('does not dispatch a follow-up IPC after unmount mid-await', async () => {
    vi.useFakeTimers()
    try {
      let releaseFirst: (() => void) | undefined

      const setWorkspaceSessions = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
        )
        .mockResolvedValue(undefined)
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      const initial = [
        session('ws-1', 'single', [
          pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        ]),
      ]

      const updated = [
        session('ws-1', 'vsplit', [
          pane({ id: 'p0', ptyId: 'pty-a', active: true }),
          pane({ id: 'p1', ptyId: 'pty-b', active: false }),
        ]),
      ]

      const { rerender, unmount } = renderHook(
        ({ sessions }) =>
          usePushWorkspaceGrouping({ service, loading: false, sessions }),
        { initialProps: { sessions: initial as readonly Session[] } }
      )

      // First IPC is in flight (held by the unresolved promise).
      await vi.advanceTimersByTimeAsync(0)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Rerender lands a newer snapshot in `pending` while the first
      // IPC is still in flight. The new effect's drain returns at the
      // `inFlight` guard.
      rerender({ sessions: updated as readonly Session[] })

      // Unmount BEFORE the first IPC resolves.
      unmount()

      // Release the first IPC. The success continuation must NOT fire
      // a second IPC for the queued snapshot because the hook is gone.
      releaseFirst?.()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(10)

      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 12: Claude MEDIUM — the effect dep is `sessions`, which
  // changes on EVERY `setSessions` call (OSC 7 cwd update, agent title
  // event, user label set, PTY-exit status flip). None of those affect
  // the snapshot payload, but each one used to fire an IPC + disk write.
  // The memoization (`lastPushedJsonRef`) skips identical payloads.
  test('skips the IPC when the snapshot payload is unchanged', async () => {
    const setWorkspaceSessions = vi.fn().mockResolvedValue(undefined)
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

    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(1))

    // Simulate a non-structural mutation: same shape, new array
    // reference (the same churn React produces for OSC 7 cwd / agent
    // title / user label / status updates). The effect re-runs because
    // `sessions` is a new array, but the snapshot JSON is identical.
    rerender({ sessions: [...initial] as readonly Session[] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

    // A truly structural mutation re-enables the push.
    const withExtraPane = [
      session('ws-1', 'quad', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
        pane({ id: 'p2', ptyId: 'pty-c', active: false }),
      ]),
    ]
    rerender({ sessions: withExtraPane as readonly Session[] })
    await waitFor(() => expect(setWorkspaceSessions).toHaveBeenCalledTimes(2))
  })

  // PR #290 cycle 12: Claude MEDIUM — the drain's post-await continuation
  // would `while`-loop with the OLD effect's `service`. If a sessions
  // change between effect runs lands a newer snapshot in `pending`
  // during the in-flight await, the old drain would push it through the
  // OLD service. The fix is symmetric with the retry-timer path:
  // dispatch through `latestDrainRef` after a successful await.
  test('continuation after a successful IPC dispatches through the latest service', async () => {
    let releaseFirst: (() => void) | undefined

    const oldService = {
      setWorkspaceSessions: vi.fn().mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
      ),
    } as unknown as ITerminalService

    const newService = {
      setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    } as unknown as ITerminalService

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
      ({ service, sessions }) =>
        usePushWorkspaceGrouping({ service, loading: false, sessions }),
      { initialProps: { service: oldService, sessions: first } }
    )

    // First IPC is held mid-await on the OLD service.
    await waitFor(() =>
      expect(oldService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
    )

    // Swap BOTH the service AND the sessions: a newer snapshot lands in
    // `pending` while the old IPC is still awaiting.
    rerender({ service: newService, sessions: second })

    // Release the old IPC. The OLD drain's post-await continuation must
    // dispatch through `latestDrainRef` (which now points at the new
    // closure capturing `newService`), not push directly via its
    // captured OLD `service`.
    releaseFirst?.()
    await waitFor(() =>
      expect(newService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
    )
    // OLD service must NOT have been called a second time.
    expect(oldService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
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

  // PR #290 cycle 16: Claude HIGH — the `lastPushedJsonRef` memoization
  // skips the IPC when the new snapshot matches the previously-pushed
  // payload. When the service swaps mid-mount (e.g. the user reconnects
  // to a freshly-restarted sidecar), the NEW service has never seen the
  // current snapshot, but the ref still holds the JSON from the OLD
  // service and silently skips the first push. Restored state never
  // reaches the new backend until the next structural change.
  test('replays the latest snapshot to a newly-installed service', async () => {
    const firstService = {
      setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    } as unknown as ITerminalService

    const sessions = [
      session('ws-1', 'vsplit', [
        pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        pane({ id: 'p1', ptyId: 'pty-b', active: false }),
      ]),
    ]

    const { rerender } = renderHook(
      ({ service }) =>
        usePushWorkspaceGrouping({
          service,
          loading: false,
          sessions: sessions as readonly Session[],
        }),
      { initialProps: { service: firstService } }
    )

    await waitFor(() =>
      expect(firstService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
    )

    const secondService = {
      setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    } as unknown as ITerminalService

    // Swap to the new service with the SAME `sessions` — the snapshot
    // hasn't changed, but the new service has never seen it.
    rerender({ service: secondService })

    await waitFor(() =>
      expect(secondService.setWorkspaceSessions).toHaveBeenCalledTimes(1)
    )
  })

  // PR #381: Claude MEDIUM — the broad retry backoff delayed
  // structurally newer snapshots for up to 5s. The narrowing tracks the
  // failed snapshot's JSON and bypasses the backoff when a pending
  // snapshot differs, so a pane/layout change after a transient IPC
  // failure reaches the cache immediately while identical no-op retries
  // still respect the 5s flood gate.
  test('structurally newer snapshot drains immediately after a failed push', async () => {
    vi.useFakeTimers()
    try {
      let rejectFirst: ((err: unknown) => void) | undefined

      const setWorkspaceSessions = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirst = reject
            })
        )
        .mockResolvedValue(undefined)
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      const initial = [
        session('ws-1', 'single', [
          pane({ id: 'p0', ptyId: 'pty-a', active: true }),
        ]),
      ]

      const updated = [
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

      await vi.advanceTimersByTimeAsync(0)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Reject the in-flight push and let the catch's microtasks run.
      rejectFirst?.(new Error('transient'))
      await vi.advanceTimersByTimeAsync(0)

      // Rerender with a structurally different snapshot while a retry
      // timer for the failed payload is pending.
      rerender({ sessions: updated as readonly Session[] })
      await vi.advanceTimersByTimeAsync(0)

      // The newer snapshot must drain immediately, not sit behind 5s.
      await vi.waitFor(() =>
        expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
      )

      const secondPayload = setWorkspaceSessions.mock.calls[1]?.[0] as
        | { sessions: { panes: { ptyId: string }[] }[] }
        | undefined
      expect(secondPayload?.sessions[0]?.panes.map((p) => p.ptyId)).toEqual([
        'pty-a',
        'pty-b',
      ])

      // The stale backoff timer should not fire another identical retry.
      await vi.advanceTimersByTimeAsync(5000)
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // PR #290 cycle 16: Claude MEDIUM — repeated dep-change rerenders
  // during a sidecar outage must not bypass the 5s backoff. The cycle-6
  // backoff timer is the only thing keeping us from flooding a down
  // sidecar; the dep-change rerender path now checks for a pending
  // retry timer before issuing an immediate drain.
  test('repeated rerenders during outage do not bypass the 5s retry backoff', async () => {
    vi.useFakeTimers()
    try {
      const setWorkspaceSessions = vi
        .fn()
        .mockRejectedValue(new Error('sidecar down'))
      const service = { setWorkspaceSessions } as unknown as ITerminalService

      const { rerender } = renderHook(
        ({ tick }) =>
          usePushWorkspaceGrouping({
            service,
            loading: false,
            // Mutate panes shape on each rerender so the memoization
            // doesn't dedupe and our gate is the only thing standing
            // between the rerender and a fresh IPC.
            sessions: [
              session('ws-1', 'vsplit', [
                pane({
                  id: 'p0',
                  ptyId: 'pty-a',
                  active: true,
                  cwd: `/tick-${tick}`,
                }),
              ]),
            ] as readonly Session[],
          }),
        { initialProps: { tick: 0 } }
      )

      // First push fires immediately and rejects.
      await vi.waitFor(() =>
        expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)
      )
      await Promise.resolve()
      await Promise.resolve()

      // Rerender with new structural snapshots WITHIN the 5s window —
      // the gate must skip the immediate drain because a retry timer
      // is already scheduled.
      for (let i = 1; i <= 5; i++) {
        rerender({ tick: i })
        await vi.advanceTimersByTimeAsync(500)
      }

      // We're at t=2.5s. No additional IPC should have fired yet.
      expect(setWorkspaceSessions).toHaveBeenCalledTimes(1)

      // Advance past 5s; the backoff timer fires once.
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() =>
        expect(setWorkspaceSessions).toHaveBeenCalledTimes(2)
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
