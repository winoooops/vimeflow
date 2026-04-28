import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentStatus } from './useAgentStatus'

type EventCallback<T = unknown> = (event: { payload: T }) => void

const eventListeners = new Map<string, EventCallback[]>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../../terminal/ptySessionMap', () => ({
  getPtySessionId: vi.fn((id: string) => `pty-${id}`),
  getStatusFilePath: vi.fn(
    (id: string) => `/project/.vimeflow/sessions/pty-${id}/status.json`
  ),
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

    // Detection/disconnect is polling-only — only agent-status and
    // agent-tool-call have event listeners.
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('agent-status', expect.any(Function))

      expect(listen).toHaveBeenCalledWith(
        'agent-tool-call',
        expect.any(Function)
      )
    })
  })

  test('unsubscribes from events on unmount', async () => {
    const { unmount } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBeGreaterThanOrEqual(
        1
      )
    })

    unmount()

    // After unmount, all listeners should be cleaned up
    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(0)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(0)
    })
  })

  test('filters status events by sessionId', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    // Event for a different session should be ignored
    act(() => {
      emit('agent-status', {
        sessionId: 'other-pty-id',
        modelId: 'opus',
        modelDisplayName: 'Opus',
        version: '1.0',
        agentSessionId: null,
        contextWindow: null,
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.modelId).toBeNull()
  })

  test('resets state when sessionId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

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
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_001',
        tool: 'Read',
        args: '{}',
        status: 'done',
        timestamp: '2026-04-12T00:00:00Z',
        durationMs: 100,
      })
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_002',
        tool: 'Read',
        args: '{}',
        status: 'done',
        timestamp: '2026-04-12T00:00:01Z',
        durationMs: 50,
      })
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_003',
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

  test('manages recentToolCalls as a sliding window capped at 50', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    // Emit 55 tool calls — oldest 5 should fall out of the window.
    for (let i = 0; i < 55; i++) {
      act(() => {
        emit('agent-tool-call', {
          sessionId: 'pty-session-1',
          toolUseId: `toolu_${String(i).padStart(3, '0')}`,
          tool: 'Read',
          args: `{"i":${String(i)}}`,
          status: 'done',
          timestamp: `2026-04-12T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
          durationMs: 100,
        })
      })
    }

    expect(result.current.recentToolCalls).toHaveLength(50)
    // Newest first — arrival order determines insertion, and #54 was last.
    expect(result.current.recentToolCalls[0].args).toBe('{"i":54}')
  })

  test('sets active tool call on running status', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_bash1',
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
      startedAt: '2026-04-12T00:00:00Z',
      toolUseId: 'toolu_bash1',
    })
  })

  test('clears active tool call on completion', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_bash2',
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
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_bash2',
        tool: 'Bash',
        args: '{"command":"ls"}',
        status: 'done',
        timestamp: '2026-04-12T00:00:01Z',
        durationMs: 500,
      })
    })

    expect(result.current.toolCalls.active).toBeNull()
  })

  test('propagates isTestFile from agent-tool-call event to recentToolCalls', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_test1',
        tool: 'Write',
        args: 'src/foo.test.ts',
        status: 'done',
        timestamp: '2026-04-28T12:00:00Z',
        durationMs: 100,
        isTestFile: true,
      })
    })

    expect(result.current.recentToolCalls[0]?.isTestFile).toBe(true)
  })

  test('parallel same-tool completions retain distinct ids via toolUseId', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    // Simulate three parallel Read calls completing inside a single
    // user message: the Rust parser emits the same message-level
    // timestamp for each. Before the toolUseId fix, all three
    // collapsed to the same key and React silently dropped rows.
    const sharedTimestamp = '2026-04-22T10:30:45.123Z'
    for (const id of ['toolu_A', 'toolu_B', 'toolu_C']) {
      act(() => {
        emit('agent-tool-call', {
          sessionId: 'pty-session-1',
          toolUseId: id,
          tool: 'Read',
          args: `{"file":"${id}"}`,
          status: 'done',
          timestamp: sharedTimestamp,
          durationMs: 10,
        })
      })
    }

    const ids = result.current.recentToolCalls.map((c) => c.id)
    expect(ids).toEqual(['toolu_C', 'toolu_B', 'toolu_A'])
    expect(new Set(ids).size).toBe(3)
  })

  test('polls detect_agent_in_session on interval', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    renderHook(() => useAgentStatus('session-1'))

    // Should have called invoke immediately for detection
    // getPtySessionId mock maps 'session-1' → 'pty-session-1'
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('detect_agent_in_session', {
        sessionId: 'pty-session-1',
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
      expect(eventListeners.get('agent-status')?.length).toBeGreaterThanOrEqual(
        1
      )
    })

    rerender({ id: 'session-2' })

    // Should have attempted to stop watchers for old session
    // getPtySessionId mock maps 'session-1' → 'pty-session-1'
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
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
          sessionId: 'pty-session-1',
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
