import { describe, test, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionManager } from './useSessionManager'

vi.mock('../../terminal/components/TerminalPane', () => ({
  disposeTerminalSession: vi.fn(),
}))

describe('useSessionManager', () => {
  test('starts with one default session', () => {
    const { result } = renderHook(() => useSessionManager())

    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.sessions[0].name).toBe('session 1')
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })

  test('createSession adds a new session and activates it', () => {
    const { result } = renderHook(() => useSessionManager())

    act(() => {
      result.current.createSession()
    })

    expect(result.current.sessions).toHaveLength(2)
    expect(result.current.sessions[0].name).toBe('session 2')
    expect(result.current.activeSessionId).toBe(result.current.sessions[0].id)
  })

  test('removeSession removes session', () => {
    const { result } = renderHook(() => useSessionManager())

    act(() => {
      result.current.createSession()
    })

    expect(result.current.sessions).toHaveLength(2)

    const idToRemove = result.current.sessions[0].id

    act(() => {
      result.current.removeSession(idToRemove)
    })

    expect(result.current.sessions).toHaveLength(1)
  })

  test('renameSession updates session name', () => {
    const { result } = renderHook(() => useSessionManager())
    const id = result.current.sessions[0].id

    act(() => {
      result.current.renameSession(id, 'my-session')
    })

    expect(result.current.sessions[0].name).toBe('my-session')
  })

  test('renameSession ignores empty name', () => {
    const { result } = renderHook(() => useSessionManager())
    const id = result.current.sessions[0].id

    act(() => {
      result.current.renameSession(id, '   ')
    })

    expect(result.current.sessions[0].name).toBe('session 1')
  })

  test('updateSessionCwd updates workingDirectory', () => {
    const { result } = renderHook(() => useSessionManager())
    const id = result.current.sessions[0].id

    act(() => {
      result.current.updateSessionCwd(id, '/home/user/projects')
    })

    expect(result.current.sessions[0].workingDirectory).toBe(
      '/home/user/projects'
    )
  })

  test('reorderSessions replaces session list', () => {
    const { result } = renderHook(() => useSessionManager())

    act(() => {
      result.current.createSession()
      result.current.createSession()
    })

    const reversed = [...result.current.sessions].reverse()

    act(() => {
      result.current.reorderSessions(reversed)
    })

    expect(result.current.sessions[0].id).toBe(reversed[0].id)
  })
})
