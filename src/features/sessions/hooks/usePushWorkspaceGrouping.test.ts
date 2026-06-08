import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  buildWorkspaceShape,
  usePushWorkspaceGrouping,
  type UsePushWorkspaceGroupingOptions,
} from './usePushWorkspaceGrouping'
import { emptyActivity } from '../constants'
import type { Pane, Session } from '../types'

const workspaceLayoutMock = vi.hoisted(() => {
  const finalShapeCallbacks: (() => void)[] = []

  const onWorkspaceRequestFinalShape = vi.fn((callback: () => void) => {
    finalShapeCallbacks.push(callback)

    return (): void => {
      const index = finalShapeCallbacks.indexOf(callback)
      if (index !== -1) {
        finalShapeCallbacks.splice(index, 1)
      }
    }
  })

  return {
    finalShapeCallbacks,
    onWorkspaceRequestFinalShape,
    pushWorkspaceShape: vi.fn(() => Promise.resolve()),
  }
})
vi.mock('../workspaceLayoutBridge', () => ({
  onWorkspaceRequestFinalShape:
    workspaceLayoutMock.onWorkspaceRequestFinalShape,
  pushWorkspaceShape: workspaceLayoutMock.pushWorkspaceShape,
}))

const {
  finalShapeCallbacks,
  onWorkspaceRequestFinalShape,
  pushWorkspaceShape,
} = workspaceLayoutMock

const shellPane = (over: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/repo',
  agentType: 'claude-code',
  status: 'running',
  active: true,
  ...over,
})

const browserPane = (over: Partial<Pane> = {}): Pane => ({
  kind: 'browser',
  id: 'p1',
  ptyId: 'browser:abc',
  cwd: '/repo',
  agentType: 'generic',
  status: 'running',
  active: false,
  ...over,
})

const makeSession = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  projectId: 'proj-1',
  name: 'session 1',
  status: 'running',
  workingDirectory: '/repo',
  agentType: 'claude-code',
  layout: 'vsplit',
  activityPanelCollapsed: false,
  panes: [shellPane(), browserPane()],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  activity: { ...emptyActivity },
  ...over,
})

describe('buildWorkspaceShape', () => {
  test('maps the session tree to a kind-tagged shape DTO (no browser tabs)', () => {
    expect(buildWorkspaceShape([makeSession()], 's1')).toEqual({
      sessions: [
        {
          id: 's1',
          projectId: 'proj-1',
          layout: 'vsplit',
          workingDirectory: '/repo',
          active: true,
          panes: [
            {
              kind: 'shell',
              paneId: 'p0',
              paneIndex: 0,
              active: true,
              ptyId: 'pty-0',
              cwd: '/repo',
              agentType: 'claude-code',
              agentSessionId: null,
            },
            { kind: 'browser', paneId: 'p1', paneIndex: 1, active: false },
          ],
        },
      ],
    })
  })

  test('marks active=false for a non-active session', () => {
    expect(
      buildWorkspaceShape([makeSession()], 'other').sessions[0].active
    ).toBe(false)
  })
})

describe('usePushWorkspaceGrouping', () => {
  beforeEach(() => {
    pushWorkspaceShape.mockClear()
    onWorkspaceRequestFinalShape.mockClear()
    finalShapeCallbacks.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('does not push while loading', () => {
    renderHook(() =>
      usePushWorkspaceGrouping({
        sessions: [makeSession()],
        activeSessionId: 's1',
        loading: true,
      })
    )
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })

  test('pushes an empty shape when empty writes are allowed', () => {
    renderHook(() =>
      usePushWorkspaceGrouping({
        sessions: [],
        activeSessionId: null,
        loading: false,
      })
    )
    expect(pushWorkspaceShape).toHaveBeenCalledWith({ sessions: [] })
  })

  test('does not push an empty shape when empty writes are disallowed', () => {
    renderHook(() =>
      usePushWorkspaceGrouping({
        sessions: [],
        activeSessionId: null,
        loading: false,
        canPushEmptyShape: false,
      })
    )
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })

  test('pushes the shape eagerly on a structural change', () => {
    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)

    rerender({
      sessions: [
        makeSession({
          panes: [
            shellPane(),
            browserPane(),
            shellPane({ id: 'p2', ptyId: 'pty-2', active: false }),
          ],
        }),
      ],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(2)
  })

  test('debounces a cwd drift change', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1) // initial eager push
    pushWorkspaceShape.mockClear()

    rerender({
      sessions: [
        makeSession({
          panes: [shellPane({ cwd: '/repo/sub' }), browserPane()],
        }),
      ],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)
  })

  test('skips a no-op rerender (identical shape, new array reference)', () => {
    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)

    rerender({
      sessions: [makeSession()],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)
  })

  test('pushes eagerly when the active session changes', () => {
    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)

    rerender({
      sessions: [makeSession()],
      activeSessionId: 'other',
      loading: false,
    })
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(2)
  })

  test('cancels pending drift debounce when loading becomes true', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    pushWorkspaceShape.mockClear()

    // Schedule a drift debounce
    rerender({
      sessions: [
        makeSession({
          panes: [shellPane({ cwd: '/repo/sub' }), browserPane()],
        }),
      ],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).not.toHaveBeenCalled()

    // Enter loading before the debounce fires
    rerender({
      sessions: [
        makeSession({
          panes: [shellPane({ cwd: '/repo/sub' }), browserPane()],
        }),
      ],
      activeSessionId: 's1',
      loading: true,
    })

    vi.advanceTimersByTime(500)
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })

  test('pushes and cancels pending drift debounce when sessions become empty', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1' as string | null,
          loading: false,
        },
      }
    )
    pushWorkspaceShape.mockClear()

    // Schedule a drift debounce
    rerender({
      sessions: [
        makeSession({
          panes: [shellPane({ cwd: '/repo/sub' }), browserPane()],
        }),
      ],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).not.toHaveBeenCalled()

    // Drain sessions before the debounce fires
    rerender({
      sessions: [],
      activeSessionId: null,
      loading: false,
    })
    expect(pushWorkspaceShape).toHaveBeenCalledWith({ sessions: [] })

    vi.advanceTimersByTime(500)
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)
  })

  test('final-shape request pushes immediately and cancels pending drift', () => {
    vi.useFakeTimers()

    const { rerender } = renderHook(
      (props: UsePushWorkspaceGroupingOptions) =>
        usePushWorkspaceGrouping(props),
      {
        initialProps: {
          sessions: [makeSession()],
          activeSessionId: 's1',
          loading: false,
        },
      }
    )
    pushWorkspaceShape.mockClear()

    rerender({
      sessions: [
        makeSession({
          panes: [shellPane({ cwd: '/repo/sub' }), browserPane()],
        }),
      ],
      activeSessionId: 's1',
      loading: false,
    })
    expect(pushWorkspaceShape).not.toHaveBeenCalled()

    finalShapeCallbacks[0]()
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)
    expect(pushWorkspaceShape).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            panes: [
              expect.objectContaining({ cwd: '/repo/sub' }),
              expect.objectContaining({ kind: 'browser' }),
            ],
          }),
        ],
      })
    )

    vi.advanceTimersByTime(500)
    expect(pushWorkspaceShape).toHaveBeenCalledTimes(1)
  })

  test('final-shape request is ignored while loading', () => {
    renderHook(() =>
      usePushWorkspaceGrouping({
        sessions: [makeSession()],
        activeSessionId: 's1',
        loading: true,
      })
    )

    finalShapeCallbacks[0]()
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })

  test('final-shape request does not push disallowed empty shapes', () => {
    renderHook(() =>
      usePushWorkspaceGrouping({
        sessions: [],
        activeSessionId: null,
        loading: false,
        canPushEmptyShape: false,
      })
    )

    finalShapeCallbacks[0]()
    expect(pushWorkspaceShape).not.toHaveBeenCalled()
  })
})
