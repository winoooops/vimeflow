import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useActiveSessionController } from './useActiveSessionController'

const focusBrowserPane = vi.hoisted(() => vi.fn())
vi.mock('../../browser/browserBridge', () => ({ focusBrowserPane }))

const buildService = (
  setActive: (id: string) => Promise<void> = () => Promise.resolve()
): ITerminalService =>
  ({
    setActiveSession: vi.fn().mockImplementation(setActive),
  }) as unknown as ITerminalService

const session = (id: string, ptyId: string): Session =>
  ({
    id,
    panes: [{ id: 'p0', ptyId, status: 'running', active: true }],
  }) as unknown as Session

const browserOnlySession = (id: string): Session =>
  ({
    id,
    panes: [
      {
        kind: 'browser',
        id: 'p0',
        ptyId: 'browser:x',
        status: 'running',
        active: true,
      },
    ],
  }) as unknown as Session

describe('useActiveSessionController', () => {
  beforeEach(() => {
    focusBrowserPane.mockClear()
  })

  test('setActiveSessionId optimistically updates and calls IPC with active pane ptyId', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)

    const sessionsRef = {
      current: [session('sess-A', 'pty-A'), session('sess-B', 'pty-B')],
    }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-B')
    })

    expect(result.current.activeSessionId).toBe('sess-B')
    expect(setActive).toHaveBeenCalledWith('pty-B')
  })

  test('rolls back on IPC failure when no newer request superseded', async () => {
    let rejectActive: (err: Error) => void = () => undefined

    const setActive = vi.fn().mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectActive = reject
      })
    )

    const service = buildService(setActive)
    const sessionsRef = { current: [session('sess-A', 'pty-A')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )
    expect(result.current.activeSessionId).toBeNull()

    act(() => {
      result.current.setActiveSessionId('sess-A')
    })
    expect(result.current.activeSessionId).toBe('sess-A')

    await act(async () => {
      rejectActive(new Error('IPC failed'))
      await Promise.resolve()
    })

    expect(result.current.activeSessionId).toBeNull()
  })

  test('does not roll back when superseded by newer request', async () => {
    let reject1: (err: Error) => void = () => undefined
    let resolve2: () => void = () => undefined

    const setActive = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          reject1 = reject
        })
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolve2 = resolve
        })
      )

    const service = buildService(setActive)

    const sessionsRef = {
      current: [
        session('sess-A', 'pty-A'),
        session('sess-B', 'pty-B'),
        session('sess-C', 'pty-C'),
      ],
    }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-B')
    })

    act(() => {
      result.current.setActiveSessionId('sess-C')
    })

    await act(async () => {
      reject1(new Error('first IPC failed'))
      resolve2()
      await Promise.resolve()
    })

    expect(result.current.activeSessionId).toBe('sess-C')
  })

  test('setActiveSessionIdRaw bypasses IPC', () => {
    const setActive = vi.fn()
    const service = buildService(setActive)
    const sessionsRef = { current: [session('sess-A', 'pty-A')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionIdRaw('sess-A')
    })

    expect(result.current.activeSessionId).toBe('sess-A')
    expect(setActive).not.toHaveBeenCalled()
  })

  // F5 (claude MEDIUM) regression: setActiveSessionId must look up the
  // session BEFORE mutating ref+state. Calling with a non-existent id
  // must be a no-op (no ghost state, no IPC).
  test('ignores missing session id without mutating active state or firing IPC', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)
    const sessionsRef = { current: [session('sess-A', 'pty-A')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionIdRaw('sess-A')
    })
    setActive.mockClear()

    act(() => {
      result.current.setActiveSessionId('does-not-exist')
    })

    expect(result.current.activeSessionId).toBe('sess-A')
    expect(result.current.activeSessionIdRef.current).toBe('sess-A')
    expect(setActive).not.toHaveBeenCalled()
  })

  test('browser-only session: selects, focuses the browser pane, no PTY IPC', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)
    const sessionsRef = { current: [browserOnlySession('sess-browser')] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-browser')
    })

    expect(result.current.activeSessionId).toBe('sess-browser')
    expect(setActive).not.toHaveBeenCalled()
    expect(focusBrowserPane).toHaveBeenCalledWith({
      sessionId: 'sess-browser',
      paneId: 'p0',
    })
  })

  test('placeholder-only shells: skips the PTY IPC and does not focus a browser', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)

    const dead = {
      id: 'sess-dead',
      panes: [{ id: 'p0', ptyId: 'dead', status: 'completed', active: true }],
    } as unknown as Session
    const sessionsRef = { current: [dead] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-dead')
    })

    expect(result.current.activeSessionId).toBe('sess-dead')
    expect(setActive).not.toHaveBeenCalled()
    expect(focusBrowserPane).not.toHaveBeenCalled()
  })

  test('resolves a live shell beyond the first pane (not shellPanes[0])', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)

    const mixed = {
      id: 'sess-mixed',
      panes: [
        { id: 'p0', ptyId: 'dead', status: 'completed', active: false },
        { id: 'p1', ptyId: 'live', status: 'running', active: true },
      ],
    } as unknown as Session
    const sessionsRef = { current: [mixed] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-mixed')
    })

    expect(setActive).toHaveBeenCalledWith('live')
  })

  // Restore persists which pane was active; activating the session must target
  // THAT pane's PTY, not the first live shell, or Rust's active PTY diverges
  // from the pane the UI restored as active.
  test('activates the active pane PTY, not the first live shell', () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const service = buildService(setActive)

    const multi = {
      id: 'sess-multi',
      panes: [
        { id: 'p0', ptyId: 'pty-first', status: 'running', active: false },
        { id: 'p1', ptyId: 'pty-active', status: 'running', active: true },
      ],
    } as unknown as Session
    const sessionsRef = { current: [multi] }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-multi')
    })

    expect(setActive).toHaveBeenCalledWith('pty-active')
  })

  test('a browser-only selection supersedes a prior in-flight shell rollback', async () => {
    let rejectActive: (err: Error) => void = () => undefined

    const setActive = vi.fn().mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectActive = reject
      })
    )
    const service = buildService(setActive)

    const sessionsRef = {
      current: [session('sess-A', 'pty-A'), browserOnlySession('sess-browser')],
    }

    const { result } = renderHook(() =>
      useActiveSessionController({ service, sessionsRef })
    )

    act(() => {
      result.current.setActiveSessionId('sess-A')
    })
    expect(result.current.activeSessionId).toBe('sess-A')

    act(() => {
      result.current.setActiveSessionId('sess-browser')
    })
    expect(result.current.activeSessionId).toBe('sess-browser')

    await act(async () => {
      rejectActive(new Error('shell IPC failed'))
      await Promise.resolve()
    })

    // The request-id bump means the stale shell rollback must NOT revert the
    // browser-only selection.
    expect(result.current.activeSessionId).toBe('sess-browser')
  })
})
