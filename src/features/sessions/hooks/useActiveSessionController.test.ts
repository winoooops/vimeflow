import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import type { ITerminalService } from '../../terminal/services/terminalService'
import { useActiveSessionController } from './useActiveSessionController'

const buildService = (
  setActive: (id: string) => Promise<void> = () => Promise.resolve()
): ITerminalService =>
  ({
    setActiveSession: vi.fn().mockImplementation(setActive),
  }) as unknown as ITerminalService

const session = (id: string, ptyId: string): Session =>
  ({
    id,
    panes: [{ id: 'p0', ptyId, active: true }],
  }) as unknown as Session

describe('useActiveSessionController', () => {
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
})
