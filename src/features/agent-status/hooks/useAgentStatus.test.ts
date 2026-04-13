import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentStatus } from './useAgentStatus'

type EventCallback<T = unknown> = (event: { payload: T }) => void

const eventListeners = new Map<string, EventCallback[]>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    (eventName: string, callback: EventCallback): Promise<() => void> => {
      const existing = eventListeners.get(eventName) ?? []
      existing.push(callback)
      eventListeners.set(eventName, existing)

      const unlisten = (): void => {
        const listeners = eventListeners.get(eventName) ?? []
        const idx = listeners.indexOf(callback)

        if (idx >= 0) {
          listeners.splice(idx, 1)
        }
      }

      return Promise.resolve(unlisten)
    }
  ),
}))

const emit = <T>(eventName: string, payload: T): void => {
  const listeners = eventListeners.get(eventName) ?? []
  for (const cb of listeners) {
    cb({ payload })
  }
}

describe('useAgentStatus', () => {
  beforeEach(() => {
    eventListeners.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns default inactive status when sessionId is null', () => {
    const { result } = renderHook(() => useAgentStatus(null))

    expect(result.current.isActive).toBe(false)
    expect(result.current.agentType).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.recentToolCalls).toEqual([])
  })

  test('subscribes to tauri events when sessionId is provided', async () => {
    const { listen } = await import('@tauri-apps/api/event')

    renderHook(() => useAgentStatus('session-1'))

    // Wait for async subscriptions
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith(
        'agent-detected',
        expect.any(Function)
      )

      expect(listen).toHaveBeenCalledWith('agent-status', expect.any(Function))

      expect(listen).toHaveBeenCalledWith(
        'agent-tool-call',
        expect.any(Function)
      )

      expect(listen).toHaveBeenCalledWith(
        'agent-disconnected',
        expect.any(Function)
      )
    })
  })

  test('unsubscribes from events on unmount', async () => {
    const { unmount } = renderHook(() => useAgentStatus('session-1'))

    // Wait for ALL 4 subscriptions to complete
    await vi.waitFor(() => {
      expect(eventListeners.get('agent-disconnected')?.length).toBe(1)
    })

    unmount()

    expect(eventListeners.get('agent-detected')?.length).toBe(0)
    expect(eventListeners.get('agent-status')?.length).toBe(0)
    expect(eventListeners.get('agent-tool-call')?.length).toBe(0)
    expect(eventListeners.get('agent-disconnected')?.length).toBe(0)
  })

  test('handles agent-detected event', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-detected')?.length).toBe(1)
    })

    act(() => {
      emit('agent-detected', {
        sessionId: 'session-1',
        agentType: 'claudeCode',
        pid: 1234,
      })
    })

    expect(result.current.isActive).toBe(true)
    expect(result.current.agentType).toBe('claude-code')
  })

  test('filters events by sessionId', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-detected')?.length).toBe(1)
    })

    act(() => {
      emit('agent-detected', {
        sessionId: 'session-other',
        agentType: 'claudeCode',
        pid: 1234,
      })
    })

    expect(result.current.isActive).toBe(false)
  })

  test('handles agent-disconnected event', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-disconnected')?.length).toBe(1)
    })

    act(() => {
      emit('agent-detected', {
        sessionId: 'session-1',
        agentType: 'claudeCode',
        pid: 1234,
      })
    })

    expect(result.current.isActive).toBe(true)

    act(() => {
      emit('agent-disconnected', { sessionId: 'session-1' })
    })

    expect(result.current.isActive).toBe(false)
  })

  test('resets state when sessionId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-detected')?.length).toBe(1)
    })

    act(() => {
      emit('agent-detected', {
        sessionId: 'session-1',
        agentType: 'claudeCode',
        pid: 1234,
      })
    })

    expect(result.current.isActive).toBe(true)

    rerender({ id: 'session-2' })

    expect(result.current.isActive).toBe(false)
    expect(result.current.agentType).toBeNull()
    expect(result.current.sessionId).toBe('session-2')
  })

  test('accumulates tool call counts by type', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Read',
        args: '{}',
        status: 'done',
        timestamp: '2026-04-12T00:00:00Z',
        durationMs: 100,
      })
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Read',
        args: '{}',
        status: 'done',
        timestamp: '2026-04-12T00:00:01Z',
        durationMs: 50,
      })
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Edit',
        args: '{}',
        status: 'done',
        timestamp: '2026-04-12T00:00:02Z',
        durationMs: 200,
      })
    })

    expect(result.current.toolCalls.total).toBe(3)
    expect(result.current.toolCalls.byType).toEqual({ Read: 2, Edit: 1 })
  })

  test('manages recentToolCalls as sliding window of 10', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    // Emit 12 tool calls
    for (let i = 0; i < 12; i++) {
      act(() => {
        emit('agent-tool-call', {
          sessionId: 'session-1',
          tool: 'Read',
          args: `{"i":${String(i)}}`,
          status: 'done',
          timestamp: `2026-04-12T00:00:${String(i).padStart(2, '0')}Z`,
          durationMs: 100,
        })
      })
    }

    expect(result.current.recentToolCalls).toHaveLength(10)
    // Newest first
    expect(result.current.recentToolCalls[0].args).toBe('{"i":11}')
  })

  test('sets active tool call on running status', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Bash',
        args: '{"command":"ls"}',
        status: 'running',
        timestamp: '2026-04-12T00:00:00Z',
        durationMs: null,
      })
    })

    expect(result.current.toolCalls.active).toEqual({
      tool: 'Bash',
      args: '{"command":"ls"}',
    })
  })

  test('clears active tool call on completion', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Bash',
        args: '{"command":"ls"}',
        status: 'running',
        timestamp: '2026-04-12T00:00:00Z',
        durationMs: null,
      })
    })

    expect(result.current.toolCalls.active).not.toBeNull()

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'session-1',
        tool: 'Bash',
        args: '{"command":"ls"}',
        status: 'done',
        timestamp: '2026-04-12T00:00:01Z',
        durationMs: 500,
      })
    })

    expect(result.current.toolCalls.active).toBeNull()
  })

  test('polls detect_agent_in_session on interval', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    renderHook(() => useAgentStatus('session-1'))

    // Should have called invoke immediately for detection
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('detect_agent_in_session', {
        sessionId: 'session-1',
      })
    })

    // Advance timer to trigger next poll
    vi.advanceTimersByTime(2000)

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2)
    })
  })

  test('stops watchers when sessionId changes', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-detected')?.length).toBe(1)
    })

    rerender({ id: 'session-2' })

    // Should have attempted to stop watchers for old session
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'session-1',
      })
    })
  })

  test('does not start duplicate watchers on repeated detection', async () => {
    const { invoke: mockInvoke } = await import('@tauri-apps/api/core')
    const invokeMock = vi.mocked(mockInvoke)

    // Return detected agent on every poll
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAgentStatus('session-1'))

    // Wait for first detection
    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
    })

    // Advance a few more polls
    act(() => {
      vi.advanceTimersByTime(6000) // 3 more polls
    })

    // The hook should have set isActive once and not re-triggered
    expect(result.current.isActive).toBe(true)
    expect(result.current.agentType).toBe('claude-code')
  })
})
