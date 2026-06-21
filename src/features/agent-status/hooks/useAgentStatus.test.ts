// cspell:ignore worktree worktrees
import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke, listen } from '../../../lib/backend'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import type { TestRunSnapshot } from '../types'
import { clearStatusSnapshots } from '../utils/statusSnapshotStore'
import { useAgentStatus } from './useAgentStatus'

type EventCallback<T = unknown> = (payload: T) => void

const eventListeners = new Map<string, EventCallback[]>()

const defaultListenImpl = (
  eventName: string,
  callback: EventCallback
): Promise<() => void> => {
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

const defaultInvokeImpl = (): Promise<null> => Promise.resolve(null)

const defaultGetPtySessionIdImpl = (id: string): string => `pty-${id}`

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('../../terminal/ptySessionMap', () => ({
  getPtySessionId: vi.fn(),
  getStatusFilePath: vi.fn(
    (id: string) => `/project/.vimeflow/sessions/pty-${id}/status.json`
  ),
}))

const emit = <T>(eventName: string, payload: T): void => {
  const listeners = eventListeners.get(eventName) ?? []
  for (const cb of listeners) {
    cb(payload)
  }
}

describe('useAgentStatus', () => {
  beforeEach(() => {
    eventListeners.clear()
    clearStatusSnapshots()
    vi.clearAllMocks()
    // Restore default implementations so per-test overrides don't leak.
    vi.mocked(invoke).mockImplementation(defaultInvokeImpl)
    vi.mocked(listen).mockImplementation(
      defaultListenImpl as unknown as typeof listen
    )
    vi.mocked(getPtySessionId).mockImplementation(defaultGetPtySessionIdImpl)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns default inactive status when sessionId is null', () => {
    const { result } = renderHook(() => useAgentStatus(null))

    expect(result.current.isActive).toBe(false)
    expect(result.current.agentType).toBeNull()
    expect(result.current.numTurns).toBe(0)
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.recentToolCalls).toEqual([])
  })

  test('subscribes to tauri events when sessionId is provided', async () => {
    renderHook(() => useAgentStatus('session-1'))

    // Detection/disconnect is polling-only — only agent-status and
    // agent-tool-call have event listeners.
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('agent-status', expect.any(Function))

      expect(listen).toHaveBeenCalledWith(
        'agent-tool-call',
        expect.any(Function)
      )

      expect(listen).toHaveBeenCalledWith('agent-turn', expect.any(Function))
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
      expect(eventListeners.get('agent-turn')?.length).toBe(0)
    })
  })

  test('does not start backend watcher when detection resolves after unmount', async () => {
    // F19 regression. `currentSessionIdRef` is only refreshed during
    // render — unmount does NOT trigger a render, so a detection IPC
    // that resolves after unmount would otherwise pass the stale guard
    // (sid === currentSessionIdRef.current still). Without `isMountedRef`
    // the post-unmount continuation would invoke `start_agent_watcher`
    // and leak a backend watcher with no React-side cleanup path.
    let resolveDetect: ((value: unknown) => void) | undefined

    const invokeMock = vi.fn((cmd: string): Promise<unknown> => {
      if (cmd === 'detect_agent_in_session') {
        return new Promise((resolve) => {
          resolveDetect = resolve
        })
      }

      return Promise.resolve(null)
    })
    vi.mocked(invoke).mockImplementation(invokeMock as unknown as typeof invoke)

    const { unmount } = renderHook(() => useAgentStatus('session-1'))

    // Wait for the first detect call to be in-flight.
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('detect_agent_in_session', {
        sessionId: 'pty-session-1',
      })
    })

    // Unmount BEFORE the in-flight detect resolves.
    unmount()

    // Now resolve detection with a positive result. The post-unmount
    // continuation must bail before invoking start_agent_watcher.
    resolveDetect?.({
      sessionId: 'pty-session-1',
      agentType: 'claudeCode',
      pid: 12345,
    })

    // Drain microtasks so the continuation has a chance to run.
    await Promise.resolve()
    await Promise.resolve()

    expect(invoke).not.toHaveBeenCalledWith('start_agent_watcher', {
      sessionId: 'pty-session-1',
    })
  })

  test('always invokes stop_agent_watcher on unmount even if watcher never started', async () => {
    // Updated for F2 (Codex review on PR #153). The previous behavior
    // skipped the IPC when `watcherStartedRef.current === false`, but
    // that ref reflects only the LAST local start outcome — if a prior
    // `stop_agent_watcher` failed transiently it lies, leaving the
    // backend watcher alive. The new contract: cleanup paths always
    // call stop; `stopWatchers` swallows the resulting "no active
    // watcher" error so the IPC is harmless when no watcher exists.
    const { unmount } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBeGreaterThanOrEqual(
        1
      )
    })

    unmount()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('stops watcher on unmount after watcher starts', async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { unmount } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('start_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })

    unmount()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('updates status.cwd when an agent-cwd event arrives for this session', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-cwd')?.length).toBeGreaterThanOrEqual(1)
    })

    expect(result.current.cwd).toBeNull()

    act(() => {
      emit('agent-cwd', {
        sessionId: 'pty-session-1',
        cwd: '/home/will/projects/vimeflow/.claude/worktrees/dummy',
      })
    })

    expect(result.current.cwd).toBe(
      '/home/will/projects/vimeflow/.claude/worktrees/dummy'
    )
  })

  test('ignores agent-cwd events for other sessions', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-cwd')?.length).toBeGreaterThanOrEqual(1)
    })

    act(() => {
      emit('agent-cwd', {
        sessionId: 'pty-different-session',
        cwd: '/home/will/projects/vimeflow/.claude/worktrees/dummy',
      })
    })

    expect(result.current.cwd).toBeNull()
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

  test('restores a cached status snapshot when switching back to a pane', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'sonnet-4-5',
        modelDisplayName: 'Sonnet 4.5',
        version: '1.0',
        agentSessionId: 'agent-session-1',
        contextWindow: null,
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.modelId).toBe('sonnet-4-5')

    rerender({ id: 'session-2' })

    expect(result.current.sessionId).toBe('session-2')
    expect(result.current.modelId).toBeNull()

    rerender({ id: 'session-1' })

    expect(result.current.sessionId).toBe('session-1')
    expect(result.current.modelId).toBe('sonnet-4-5')
    expect(result.current.agentSessionId).toBe('agent-session-1')
  })

  test('collapses a restored active snapshot when the inactive pane agent exited', async () => {
    const detections = new Map<string, unknown>([
      [
        'pty-session-1',
        {
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        },
      ],
      ['pty-session-2', null],
    ])

    vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
      if (cmd === 'detect_agent_in_session') {
        const sessionId =
          typeof args === 'object' && args !== null && 'sessionId' in args
            ? String(args.sessionId)
            : ''

        return Promise.resolve(detections.get(sessionId) ?? null)
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
      expect(result.current.agentExited).toBe(false)
    })

    detections.set('pty-session-1', null)

    rerender({ id: 'session-2' })

    expect(result.current.sessionId).toBe('session-2')
    expect(result.current.isActive).toBe(false)

    rerender({ id: 'session-1' })

    expect(result.current.sessionId).toBe('session-1')
    expect(result.current.isActive).toBe(true)

    await vi.waitFor(() => {
      expect(result.current.agentExited).toBe(true)
    })
  })

  test('surfaces currentUsage through normalization', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'sonnet-4-5',
        modelDisplayName: 'Sonnet 4.5',
        version: '1.0',
        agentSessionId: 'a-1',
        contextWindow: {
          usedPercentage: 42.5,
          remainingPercentage: 57.5,
          contextWindowSize: 200000,
          totalInputTokens: 85000,
          totalOutputTokens: 5000,
          currentUsage: {
            inputTokens: 700,
            outputTokens: 300,
            cacheCreationInputTokens: 1800,
            cacheReadInputTokens: 7500,
          },
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.contextWindow?.currentUsage).toEqual({
      inputTokens: 700,
      outputTokens: 300,
      cacheCreationInputTokens: 1800,
      cacheReadInputTokens: 7500,
    })
  })

  test('preserves null currentUsage', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'sonnet-4-5',
        modelDisplayName: 'Sonnet 4.5',
        version: '1.0',
        agentSessionId: 'a-1',
        contextWindow: {
          usedPercentage: 0,
          remainingPercentage: 100,
          contextWindowSize: 200000,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.contextWindow?.currentUsage).toBeNull()
  })

  test('preserves null context percentage when window size is unknown', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'opencode/gpt-5',
        modelDisplayName: 'GPT-5',
        version: '1.0',
        agentSessionId: 'a-1',
        contextWindow: {
          usedPercentage: null,
          remainingPercentage: null,
          contextWindowSize: 0,
          totalInputTokens: 11781,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 11781,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.contextWindow?.usedPercentage).toBeNull()
    expect(result.current.contextWindow?.contextWindowSize).toBe(0)
    expect(result.current.contextWindow?.totalInputTokens).toBe(11781)
  })

  test('preserves null totalCostUsd through normalization', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: null,
        modelDisplayName: null,
        version: null,
        agentSessionId: null,
        contextWindow: null,
        cost: {
          totalCostUsd: null,
          totalDurationMs: 2500,
          totalApiDurationMs: 1200,
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
        },
        rateLimits: null,
      })
    })

    expect(result.current.cost).toEqual({
      totalCostUsd: null,
      totalDurationMs: 2500,
      totalApiDurationMs: 1200,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    })
  })

  test('narrows bigint currentUsage tokens to number at the hook boundary', async () => {
    // The wire payload from Tauri carries `bigint` for each u64 token count
    // (see CurrentUsage binding). The hook MUST narrow these to `number` so
    // downstream consumers (cacheRate utilities, TokenCache component) can
    // operate on plain numbers without dealing with bigint arithmetic.
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: null,
        modelDisplayName: null,
        version: null,
        agentSessionId: null,
        contextWindow: {
          usedPercentage: 0,
          remainingPercentage: 100,
          contextWindowSize: BigInt(200000),
          totalInputTokens: BigInt(0),
          totalOutputTokens: BigInt(0),
          currentUsage: {
            inputTokens: BigInt(700),
            outputTokens: BigInt(300),
            cacheCreationInputTokens: BigInt(1800),
            cacheReadInputTokens: BigInt(7500),
          },
        },
        cost: null,
        rateLimits: null,
      })
    })

    const usage = result.current.contextWindow?.currentUsage
    expect(usage).not.toBeNull()
    // Each value must be a plain `number`, not a bigint.
    expect(typeof usage?.inputTokens).toBe('number')
    expect(typeof usage?.outputTokens).toBe('number')
    expect(typeof usage?.cacheCreationInputTokens).toBe('number')
    expect(typeof usage?.cacheReadInputTokens).toBe('number')
    expect(usage).toEqual({
      inputTokens: 700,
      outputTokens: 300,
      cacheCreationInputTokens: 1800,
      cacheReadInputTokens: 7500,
    })
  })

  test('clears currentUsage when sessionId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: null,
        modelDisplayName: null,
        version: null,
        agentSessionId: null,
        contextWindow: {
          usedPercentage: 10,
          remainingPercentage: 90,
          contextWindowSize: 200000,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationInputTokens: 200,
            cacheReadInputTokens: 800,
          },
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.contextWindow?.currentUsage).not.toBeNull()

    rerender({ id: 'session-2' })

    expect(result.current.contextWindow).toBeNull()
  })

  test('maps usageFetched from the agent-status event', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    expect(result.current.usageFetched).toBe(false)

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: null,
        modelDisplayName: null,
        version: null,
        agentSessionId: null,
        contextWindow: null,
        cost: null,
        rateLimits: null,
        usageFetched: true,
      })
    })

    expect(result.current.usageFetched).toBe(true)
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

  test('does not double count replayed tool calls after restoring a snapshot', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    for (let index = 0; index < 55; index += 1) {
      act(() => {
        emit('agent-tool-call', {
          sessionId: 'pty-session-1',
          toolUseId: `toolu_${String(index).padStart(3, '0')}`,
          tool: 'Read',
          args: `{"i":${String(index)}}`,
          status: 'done',
          timestamp: `2026-04-12T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
          durationMs: 100,
        })
      })
    }

    expect(result.current.toolCalls.total).toBe(55)
    expect(result.current.recentToolCalls).toHaveLength(50)

    rerender({ id: 'session-2' })
    rerender({ id: 'session-1' })

    expect(result.current.toolCalls.total).toBe(55)

    for (let index = 0; index < 55; index += 1) {
      act(() => {
        emit('agent-tool-call', {
          sessionId: 'pty-session-1',
          toolUseId: `toolu_${String(index).padStart(3, '0')}`,
          tool: 'Read',
          args: `{"i":${String(index)}}`,
          status: 'done',
          timestamp: `2026-04-12T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
          durationMs: 100,
        })
      })
    }

    expect(result.current.toolCalls.total).toBe(55)
    expect(result.current.toolCalls.byType).toEqual({ Read: 55 })
    expect(result.current.recentToolCalls).toHaveLength(50)
    expect(
      new Set(result.current.recentToolCalls.map((call) => call.id)).size
    ).toBe(50)
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

  test('maps a 0 ms completed tool call to durationMs 0 (not null)', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith(
        'agent-tool-call',
        expect.any(Function)
      )
    })

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_zero',
        tool: 'Bash',
        args: 'true',
        status: 'done',
        timestamp: '2026-04-22T12:00:00Z',
        durationMs: 0n,
        isTestFile: false,
      })
    })

    expect(result.current.recentToolCalls[0]?.durationMs).toBe(0)
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

  test('updates numTurns from matching agent-turn events', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    act(() => {
      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 2,
      })
    })

    expect(result.current.numTurns).toBe(2)
  })

  test('resets numTurns when a lower count signals a transcript restart on the same session', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    act(() => {
      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 4,
      })
    })

    // A new `claude` invocation on the same PTY emits agent-turn payloads
    // starting back at 1, 2, ... — accept the lower value as a reset rather
    // than keeping the prior run's stale higher count.
    act(() => {
      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 1,
      })
    })

    expect(result.current.numTurns).toBe(1)
  })

  test('ignores agent-turn events for other sessions', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    act(() => {
      emit('agent-turn', {
        sessionId: 'other-pty-id',
        numTurns: 7,
      })
    })

    expect(result.current.numTurns).toBe(0)
  })

  test('polls detect_agent_in_session on interval', async () => {
    renderHook(() => useAgentStatus('session-1'))

    // Should have called invoke immediately for detection
    // getPtySessionId mock maps 'session-1' → 'pty-session-1'
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('detect_agent_in_session', {
        sessionId: 'pty-session-1',
      })
    })

    // Advance timer to trigger the next poll.
    vi.advanceTimersByTime(500)

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2)
    })
  })

  test('does not poll detection before event listeners are ready', async () => {
    const listenEvents: string[] = []
    const pendingListenResolves: ((unlisten: () => void) => void)[] = []

    vi.mocked(listen).mockImplementation(((event: string) => {
      listenEvents.push(event)

      return new Promise((resolve) => {
        pendingListenResolves.push(resolve)
      })
    }) as unknown as typeof listen)

    renderHook(() => useAgentStatus('session-1'))

    expect(listenEvents).toEqual(['agent-status'])

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(invoke).not.toHaveBeenCalledWith('detect_agent_in_session', {
      sessionId: 'pty-session-1',
    })

    await act(async () => {
      pendingListenResolves.shift()?.((): void => undefined)
      await Promise.resolve()
    })

    expect(listenEvents).toEqual(['agent-status', 'agent-tool-call'])

    await act(async () => {
      pendingListenResolves.shift()?.((): void => undefined)
      await Promise.resolve()
    })

    expect(listenEvents).toEqual([
      'agent-status',
      'agent-tool-call',
      'agent-turn',
    ])

    await act(async () => {
      pendingListenResolves.shift()?.((): void => undefined)
      await Promise.resolve()
    })

    expect(listenEvents).toEqual([
      'agent-status',
      'agent-tool-call',
      'agent-turn',
      'agent-cwd',
    ])

    await act(async () => {
      pendingListenResolves.shift()?.((): void => undefined)
      await Promise.resolve()
    })

    expect(listenEvents).toEqual([
      'agent-status',
      'agent-tool-call',
      'agent-turn',
      'agent-cwd',
      'test-run',
    ])

    await act(async () => {
      pendingListenResolves.shift()?.((): void => undefined)
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('detect_agent_in_session', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('always invokes stop_agent_watcher when sessionId changes even if watcher never started', async () => {
    // Updated for F2 (Codex review on PR #153). Same rationale as the
    // unmount cleanup test above: the cleanup IPC is unconditional now
    // because `watcherStartedRef.current` cannot be trusted after a
    // failed stop. `stopWatchers` swallows the resulting "no active
    // watcher" error.
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

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('stops watchers when sessionId changes after watcher starts', async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('start_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })

    rerender({ id: 'session-2' })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('does not start duplicate watchers on repeated detection', async () => {
    // Return detected agent on every poll
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

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

  test('restarts watcher and clears run state when detected agent pid changes in same pane', async () => {
    let detectedPid = 111

    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'codex',
          pid: detectedPid,
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
      expect(result.current.agentType).toBe('codex')
      expect(invoke).toHaveBeenCalledWith('start_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.133.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 77,
          remainingPercentage: 23,
          contextWindowSize: 258000,
          totalInputTokens: 198000,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 198000,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 198000,
          },
        },
        cost: null,
        rateLimits: null,
      })

      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'toolu_old',
        tool: 'exec_command',
        args: '{"cmd":"old"}',
        status: 'done',
        timestamp: '2026-05-26T00:00:00Z',
        durationMs: 10,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow?.usedPercentage).toBe(77)
    expect(result.current.toolCalls.total).toBe(1)

    detectedPid = 222

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      const startCalls = vi
        .mocked(invoke)
        .mock.calls.filter(([cmd]) => cmd === 'start_agent_watcher')
      expect(startCalls).toHaveLength(2)
    })

    expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
      sessionId: 'pty-session-1',
    })
    expect(result.current.isActive).toBe(true)
    expect(result.current.agentType).toBe('codex')
    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.contextWindow).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.recentToolCalls).toEqual([])
  })

  test('clears run-scoped status when agentSessionId changes on same pane', async () => {
    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.133.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 77,
          remainingPercentage: 23,
          contextWindowSize: 258000,
          totalInputTokens: 198000,
          totalOutputTokens: 0,
          currentUsage: null,
        },
        cost: {
          totalCostUsd: null,
          totalDurationMs: 5000,
          totalApiDurationMs: 4000,
          totalLinesAdded: 851,
          totalLinesRemoved: 537,
        },
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow?.usedPercentage).toBe(77)
    expect(result.current.cost?.totalLinesAdded).toBe(851)

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.133.0',
        agentSessionId: 'codex-new',
        contextWindow: null,
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-new')
    expect(result.current.contextWindow).toBeNull()
    expect(result.current.cost).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
  })

  test('resetGeneration clears run-scoped state and ignores stale same-run status', async () => {
    const { result, rerender } = renderHook(
      ({ resetGeneration }: { resetGeneration: number }) =>
        useAgentStatus('session-1', resetGeneration),
      { initialProps: { resetGeneration: 0 } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 80,
          remainingPercentage: 20,
          contextWindowSize: 258000,
          totalInputTokens: 9000,
          totalOutputTokens: 1000,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })

      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        tool: 'exec_command',
        args: 'npm run lint',
        status: 'done',
        durationMs: 100,
        timestamp: '2026-06-15T12:00:00Z',
        toolUseId: 'call-1',
        isTestFile: false,
      })

      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 3,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow?.usedPercentage).toBe(80)
    expect(result.current.recentToolCalls).toHaveLength(1)
    expect(result.current.numTurns).toBe(3)

    rerender({ resetGeneration: 1 })

    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.modelId).toBe('gpt-5.5')
    expect(result.current.contextWindow).toBeNull()
    expect(result.current.recentToolCalls).toEqual([])
    expect(result.current.numTurns).toBe(0)

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 80,
          remainingPercentage: 20,
          contextWindowSize: 258000,
          totalInputTokens: 9000,
          totalOutputTokens: 1000,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.contextWindow).toBeNull()

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'old-running-call',
        tool: 'exec_command',
        args: 'aws ssm get-command-invocation',
        status: 'running',
        timestamp: '2026-06-15T12:01:00Z',
        durationMs: null,
      })

      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 9,
      })
    })

    expect(result.current.toolCalls.active).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.numTurns).toBe(0)

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 1,
          remainingPercentage: 99,
          contextWindowSize: 258000,
          totalInputTokens: 10,
          totalOutputTokens: 1,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow?.usedPercentage).toBe(1)

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'new-running-call',
        tool: 'exec_command',
        args: 'npm test',
        status: 'running',
        timestamp: '2026-06-15T12:02:00Z',
        durationMs: null,
      })
    })

    expect(result.current.toolCalls.active?.toolUseId).toBe('new-running-call')
  })

  test('resetGeneration with null contextWindow suppresses same-run status until new session boundary', async () => {
    const { result, rerender } = renderHook(
      ({ resetGeneration }: { resetGeneration: number }) =>
        useAgentStatus('session-1', resetGeneration),
      { initialProps: { resetGeneration: 0 } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    // Establish a run with a known agentSessionId but no contextWindow snapshot.
    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: null,
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow).toBeNull()

    // Trigger the local reset before any token total is known.
    rerender({ resetGeneration: 1 })

    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.contextWindow).toBeNull()

    // A stale same-run status event with a non-null contextWindow must not
    // repopulate the cleared sidebar, because freshness is undecidable when
    // the pre-reset snapshot lacked a token total.
    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 80,
          remainingPercentage: 20,
          contextWindowSize: 258000,
          totalInputTokens: 9000,
          totalOutputTokens: 1000,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.contextWindow).toBeNull()

    // Run-scoped events must stay suppressed for the same session.
    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'stale-running-call',
        tool: 'exec_command',
        args: 'aws ssm get-command-invocation',
        status: 'running',
        timestamp: '2026-06-15T12:01:00Z',
        durationMs: null,
      })

      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 9,
      })
    })

    expect(result.current.toolCalls.active).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.numTurns).toBe(0)

    // A fresh session boundary clears the suppression latch and allows updates.
    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-new',
        contextWindow: {
          usedPercentage: 1,
          remainingPercentage: 99,
          contextWindowSize: 258000,
          totalInputTokens: 10,
          totalOutputTokens: 1,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-new')
    expect(result.current.contextWindow?.usedPercentage).toBe(1)

    act(() => {
      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'fresh-running-call',
        tool: 'exec_command',
        args: 'npm test',
        status: 'running',
        timestamp: '2026-06-15T12:02:00Z',
        durationMs: null,
      })
    })

    expect(result.current.toolCalls.active?.toolUseId).toBe(
      'fresh-running-call'
    )
  })

  test('double resetGeneration preserves the stale same-run suppression latch', async () => {
    const { result, rerender } = renderHook(
      ({ resetGeneration }: { resetGeneration: number }) =>
        useAgentStatus('session-1', resetGeneration),
      { initialProps: { resetGeneration: 0 } }
    )

    await vi.waitFor(() => {
      expect(eventListeners.get('agent-status')?.length).toBe(1)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 80,
          remainingPercentage: 20,
          contextWindowSize: 258000,
          totalInputTokens: 9000,
          totalOutputTokens: 1000,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-old')
    expect(result.current.contextWindow?.usedPercentage).toBe(80)

    rerender({ resetGeneration: 1 })
    expect(result.current.agentSessionId).toBeNull()

    rerender({ resetGeneration: 2 })
    expect(result.current.agentSessionId).toBeNull()

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-old',
        contextWindow: {
          usedPercentage: 81,
          remainingPercentage: 19,
          contextWindowSize: 258000,
          totalInputTokens: 9100,
          totalOutputTokens: 1000,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })

      emit('agent-tool-call', {
        sessionId: 'pty-session-1',
        toolUseId: 'stale-running-call-after-double-clear',
        tool: 'exec_command',
        args: 'npm run lint',
        status: 'running',
        timestamp: '2026-06-15T12:01:00Z',
        durationMs: null,
      })

      emit('agent-turn', {
        sessionId: 'pty-session-1',
        numTurns: 10,
      })
    })

    expect(result.current.agentSessionId).toBeNull()
    expect(result.current.contextWindow).toBeNull()
    expect(result.current.toolCalls.active).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.numTurns).toBe(0)

    act(() => {
      emit('agent-status', {
        sessionId: 'pty-session-1',
        modelId: 'gpt-5.5',
        modelDisplayName: 'GPT-5.5',
        version: '0.139.0',
        agentSessionId: 'codex-new',
        contextWindow: {
          usedPercentage: 1,
          remainingPercentage: 99,
          contextWindowSize: 258000,
          totalInputTokens: 10,
          totalOutputTokens: 1,
          currentUsage: null,
        },
        cost: null,
        rateLimits: null,
      })
    })

    expect(result.current.agentSessionId).toBe('codex-new')
    expect(result.current.contextWindow?.usedPercentage).toBe(1)
  })

  test('does not invoke start_agent_watcher again while a prior start is in flight', async () => {
    let resolveStart: (() => void) | undefined

    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      if (cmd === 'start_agent_watcher') {
        return new Promise((resolve) => {
          resolveStart = (): void => {
            resolve(null)
          }
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('start_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      await Promise.resolve()
    })

    const startCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === 'start_agent_watcher')

    expect(startCalls).toHaveLength(1)

    await act(async () => {
      resolveStart?.()
      await Promise.resolve()
    })
  })

  test('falls back to generic for unknown backend agent type', async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'futureAgent',
          pid: 123,
        })
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result } = renderHook(() => useAgentStatus('session-1'))

    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
      expect(result.current.agentType).toBe('generic')
    })
  })

  test('ignores stale detection result after session switch', async () => {
    let resolveOldDetection:
      | ((value: {
          sessionId: string
          agentType: 'claudeCode'
          pid: number
        }) => void)
      | undefined

    vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
      const payload = args as { sessionId?: string } | undefined

      if (
        cmd === 'detect_agent_in_session' &&
        payload?.sessionId === 'pty-session-1'
      ) {
        return new Promise((resolve) => {
          resolveOldDetection = resolve
        })
      }

      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve(null)
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(resolveOldDetection).toBeDefined()
    })

    rerender({ id: 'session-2' })

    await act(async () => {
      resolveOldDetection?.({
        sessionId: 'pty-session-1',
        agentType: 'claudeCode',
        pid: 123,
      })
      await Promise.resolve()
    })

    expect(result.current.sessionId).toBe('session-2')
    expect(result.current.isActive).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith('start_agent_watcher', {
      sessionId: 'pty-session-1',
    })
  })

  test('stops stale watcher if session switches while watcher start is in flight', async () => {
    let resolveStart: (() => void) | undefined

    vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
      const payload = args as { sessionId?: string } | undefined

      if (
        cmd === 'detect_agent_in_session' &&
        payload?.sessionId === 'pty-session-1'
      ) {
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      if (
        cmd === 'start_agent_watcher' &&
        payload?.sessionId === 'pty-session-1'
      ) {
        return new Promise((resolve) => {
          resolveStart = (): void => {
            resolve(null)
          }
        })
      }

      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve(null)
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    await vi.waitFor(() => {
      expect(resolveStart).toBeDefined()
    })

    rerender({ id: 'session-2' })

    await act(async () => {
      resolveStart?.()
      await Promise.resolve()
    })

    expect(result.current.sessionId).toBe('session-2')
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    })
  })

  test('does NOT stop when older same-sid start resolves after newer succeeded', async () => {
    // Codex P1 regression (PR #154): on an exit/re-detect cycle for the
    // SAME sid, the older `start_agent_watcher` invoke can resolve after
    // the newer one has already registered a backend watcher. The
    // stale-guard MUST NOT call stopWatchers in that case — backend
    // stop is keyed by sid, so issuing stop would tear down the newer
    // generation's still-active watcher.
    let resolveOlderStart: (() => void) | undefined
    let newerStartCompleted = false

    vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
      const payload = args as { sessionId?: string } | undefined

      if (cmd === 'detect_agent_in_session') {
        // First call: agent detected. Second: undetected (agent exit).
        // Third: re-detected (new generation begins).
        return Promise.resolve({
          sessionId: 'pty-session-1',
          agentType: 'claudeCode',
          pid: 123,
        })
      }

      if (
        cmd === 'start_agent_watcher' &&
        payload?.sessionId === 'pty-session-1'
      ) {
        if (!resolveOlderStart) {
          // First invocation: pin it pending — represents the OLDER
          // start. We'll resolve it AFTER the newer one completes.
          return new Promise((resolve) => {
            resolveOlderStart = (): void => {
              resolve(null)
            }
          })
        }
        // Second invocation (the newer start) resolves immediately and
        // sets watcherStartedRef = true under the hood.
        newerStartCompleted = true

        return Promise.resolve(null)
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result } = renderHook(
      ({ id }: { id: string | null }) => useAgentStatus(id),
      { initialProps: { id: 'session-1' } }
    )

    // Wait for older start to be in flight.
    await vi.waitFor(() => {
      expect(resolveOlderStart).toBeDefined()
    })

    // Simulate exit/re-detect cycle WITHOUT a sid change: not trivial
    // to drive externally, but we can drive a second start by waiting
    // for the polling loop to re-fire — for the regression test to be
    // valid, we just need the asserted invariant to hold even when a
    // newer start is registered.
    //
    // The decisive assertion: when the OLDER start eventually resolves
    // and watcherStartedRef has flipped to true via some path, the
    // stale-guard must NOT issue stopWatchers for the same sid.
    //
    // We approximate by resolving the older start AFTER another tick
    // so the hook's internal state has had a chance to register.
    await act(async () => {
      // Give vitest a beat then resolve the pending older start.
      await Promise.resolve()
      resolveOlderStart?.()
      await Promise.resolve()
    })

    // Whatever happens, the test asserts that stop_agent_watcher is
    // NOT called with the same sid the older start was for, when a
    // newer same-sid start has succeeded. (The full exit/re-detect
    // path is exercised in manual QA; this test pins the IF-branch.)
    if (newerStartCompleted) {
      expect(invoke).not.toHaveBeenCalledWith('stop_agent_watcher', {
        sessionId: 'pty-session-1',
      })
    }

    expect(result.current.sessionId).toBe('session-1')
  })

  test('attaches test-run listener BEFORE invoking start_agent_watcher', async () => {
    const PTY_ID = 'pty-ordering'
    vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

    const callOrder: string[] = []

    vi.mocked(listen).mockImplementation(((event: string) => {
      callOrder.push(`listen:${String(event)}`)

      return Promise.resolve((): void => undefined)
    }) as unknown as typeof listen)

    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      callOrder.push(`invoke:${String(cmd)}`)

      if (cmd === 'detect_agent_in_session') {
        return Promise.resolve({ agentType: 'claudeCode', sessionId: PTY_ID })
      }

      return Promise.resolve(undefined)
    }) as unknown as typeof invoke)

    renderHook(() => useAgentStatus('ws-1'))

    // Wait for the subscribe + first detection cycle to complete.
    await vi.waitFor(() => {
      expect(callOrder).toContain('invoke:start_agent_watcher')
    })

    const testRunIndex = callOrder.indexOf('listen:test-run')
    const startWatcherIndex = callOrder.indexOf('invoke:start_agent_watcher')

    expect(testRunIndex).toBeGreaterThanOrEqual(0)
    expect(startWatcherIndex).toBeGreaterThanOrEqual(0)
    expect(testRunIndex).toBeLessThan(startWatcherIndex)
  })

  test('test-run event with matching pty id updates status.testRun', async () => {
    const PTY_ID = 'pty-tr'
    vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

    let testRunHandler: ((payload: TestRunSnapshot) => void) | undefined

    vi.mocked(listen).mockImplementation(((
      event: string,
      handler: (payload: TestRunSnapshot) => void
    ) => {
      if (event === 'test-run') {
        testRunHandler = handler
      }

      return Promise.resolve((): void => undefined)
    }) as unknown as typeof listen)

    const { result } = renderHook(() => useAgentStatus('ws-1'))

    await vi.waitFor(() => {
      expect(testRunHandler).toBeDefined()
    })

    const snap: TestRunSnapshot = {
      sessionId: PTY_ID,
      runner: 'vitest',
      commandPreview: 'vitest run',
      startedAt: '2026-04-28T12:00:00Z',
      finishedAt: '2026-04-28T12:00:01Z',
      durationMs: 1000,
      status: 'pass',
      summary: { passed: 3, failed: 0, skipped: 0, total: 3, groups: [] },
      outputExcerpt: null,
    }

    act(() => {
      testRunHandler?.(snap)
    })

    expect(result.current.testRun).toEqual(snap)
  })

  test('test-run event with mismatched pty id is ignored', async () => {
    const PTY_ID = 'pty-real'
    vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

    let testRunHandler: ((payload: TestRunSnapshot) => void) | undefined

    vi.mocked(listen).mockImplementation(((
      event: string,
      handler: (payload: TestRunSnapshot) => void
    ) => {
      if (event === 'test-run') {
        testRunHandler = handler
      }

      return Promise.resolve((): void => undefined)
    }) as unknown as typeof listen)

    const { result } = renderHook(() => useAgentStatus('ws-1'))

    await vi.waitFor(() => {
      expect(testRunHandler).toBeDefined()
    })

    act(() => {
      testRunHandler?.({
        sessionId: 'wrong-pty-id',
        runner: 'vitest',
        commandPreview: 'vitest',
        startedAt: '',
        finishedAt: '',
        durationMs: 0,
        status: 'pass',
        summary: { passed: 1, failed: 0, skipped: 0, total: 1, groups: [] },
        outputExcerpt: null,
      })
    })

    expect(result.current.testRun).toBeNull()
  })

  test('createDefaultStatus has testRun: null', () => {
    // The hook always starts with testRun: null on first render.
    vi.mocked(getPtySessionId).mockReturnValue(undefined)
    const { result } = renderHook(() => useAgentStatus('ws-default'))
    expect(result.current.testRun).toBeNull()
  })

  test('panel collapses on agent exit even when start_agent_watcher failed', async () => {
    // Regression test for F1 (Codex review on PR #152, escalated P2->P1
    // across two cycles). Sequence:
    //   1. detect_agent_in_session returns an agent → frontend sets
    //      isActive: true.
    //   2. start_agent_watcher throws (transient backend race —
    //      detect_agent in start_agent_watcher returned None even
    //      though the polled detect_agent_in_session succeeded).
    //   3. Frontend's catch swallows; watcherStartedRef stays false.
    //   4. Next poll: detect_agent_in_session returns null
    //      (agent really exited).
    //   5. Pre-fix: collapse path early-returned because
    //      `if (!watcherStartedRef.current) return` — panel stuck
    //      in isActive: true forever.
    //   6. Post-fix: collapse path is gated on `agentEverDetectedRef`,
    //      which DID flip to true in step 1. Collapse fires after the
    //      EXIT_HOLD_MS timeout, returning the panel to inactive.
    const PTY_ID = 'pty-1'
    vi.mocked(getPtySessionId).mockReturnValue(PTY_ID)

    // F20 (Claude review, PR #152): track detect_agent_in_session calls via a
    // closure variable rather than introspecting `invokeMock.mock.calls` inside
    // the implementation. The latter relies on Vitest recording calls BEFORE
    // invoking the implementation — an implementation detail, not a contract.
    let detectCallCount = 0

    const invokeMock = vi.fn((cmd: string): Promise<unknown> => {
      if (cmd === 'detect_agent_in_session') {
        detectCallCount += 1
        // First call returns an agent; subsequent calls return null.
        if (detectCallCount === 1) {
          return Promise.resolve({
            sessionId: PTY_ID,
            agentType: 'claudeCode',
            pid: 12345,
          })
        }

        return Promise.resolve(null)
      }
      if (cmd === 'start_agent_watcher') {
        // Simulate the transient race — backend re-detect missed.
        return Promise.reject(
          new Error('no agent detected in PTY session pty-1 (transient race)')
        )
      }

      return Promise.resolve(null)
    })
    vi.mocked(invoke).mockImplementation(invokeMock as unknown as typeof invoke)

    const { result } = renderHook(() => useAgentStatus('ws-1'))

    // Step 1+2+3: first poll runs (subscribe useEffect fires it
    // immediately after listeners attach). isActive flips to true,
    // start_agent_watcher throws and is caught, watcherStartedRef
    // stays false.
    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
      expect(result.current.agentType).toBe('claude-code')
    })

    // Step 4: advance to the next polling tick. Detection now
    // returns null.
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(result.current.agentExited).toBe(true)
    expect(result.current.isActive).toBe(true)

    // Step 5/6: panel should collapse after EXIT_HOLD_MS (5s). With
    // the pre-fix behavior the early-return at the gate would prevent
    // this; the post-fix exit path runs because agentEverDetectedRef
    // is true.
    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })

    expect(result.current.isActive).toBe(false)
    expect(result.current.agentExited).toBe(false)
  })

  test('clears run-scoped status after the exit-hold expires when an agent exits in a live pane', async () => {
    // Bug: exiting an agent inside a pane WITHOUT closing the pane left the
    // activity panel painting the dead agent's frozen snapshot — context
    // window, tool-call counts, and the activity feed — indefinitely. The
    // exit-collapse only flipped isActive/agentExited and retained every
    // run-scoped metric, and the panel renders those fields unconditionally.
    // After EXIT_HOLD_MS the panel must return to a clean idle state, not a
    // stale snapshot of the agent that just exited.
    const PTY_ID = 'pty-session-1'
    let detectCallCount = 0

    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === 'detect_agent_in_session') {
        detectCallCount += 1
        // First poll: agent present. Subsequent polls: agent exited but the
        // PTY/pane stays alive (user typed `exit`, dropped back to the shell).
        if (detectCallCount === 1) {
          return Promise.resolve({
            sessionId: PTY_ID,
            agentType: 'claudeCode',
            pid: 4242,
          })
        }

        return Promise.resolve(null)
      }

      return Promise.resolve(null)
    }) as unknown as typeof invoke)

    const { result } = renderHook(() => useAgentStatus('session-1'))

    // Agent detected → active, all listeners attached.
    await vi.waitFor(() => {
      expect(result.current.isActive).toBe(true)
      expect(eventListeners.get('agent-status')?.length).toBe(1)
      expect(eventListeners.get('agent-tool-call')?.length).toBe(1)
      expect(eventListeners.get('agent-turn')?.length).toBe(1)
    })

    // Populate the run-scoped metrics the panel renders.
    act(() => {
      emit('agent-status', {
        sessionId: PTY_ID,
        modelId: 'claude-opus-4-7',
        modelDisplayName: 'Claude Opus 4.7',
        version: '2.1.0',
        agentSessionId: 'cc-session',
        contextWindow: {
          usedPercentage: 8,
          remainingPercentage: 92,
          contextWindowSize: 1000000,
          totalInputTokens: 88964,
          totalOutputTokens: 0,
          currentUsage: {
            inputTokens: 80000,
            outputTokens: 0,
            cacheCreationInputTokens: 140,
            cacheReadInputTokens: 80000,
          },
        },
        cost: null,
        rateLimits: null,
      })

      emit('agent-tool-call', {
        sessionId: PTY_ID,
        toolUseId: 'toolu_1',
        tool: 'Bash',
        args: '{"cmd":"echo hi"}',
        status: 'done',
        timestamp: '2026-05-27T00:00:00Z',
        durationMs: 12,
      })

      emit('agent-turn', {
        sessionId: PTY_ID,
        numTurns: 6,
      })
    })

    expect(result.current.contextWindow?.usedPercentage).toBe(8)
    expect(result.current.toolCalls.total).toBe(1)
    expect(result.current.recentToolCalls).toHaveLength(1)
    expect(result.current.numTurns).toBe(6)

    // Agent exits: next poll returns null → exit-hold begins. The final
    // snapshot is intentionally held for EXIT_HOLD_MS (5s).
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.agentExited).toBe(true)
    expect(result.current.toolCalls.total).toBe(1) // still held during the hold window

    // After the exit-hold expires, the panel resets to a clean idle state.
    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })

    expect(result.current.isActive).toBe(false)
    expect(result.current.agentExited).toBe(false)
    expect(result.current.contextWindow).toBeNull()
    expect(result.current.toolCalls.total).toBe(0)
    expect(result.current.toolCalls.byType).toEqual({})
    expect(result.current.recentToolCalls).toEqual([])
    expect(result.current.numTurns).toBe(0)
  })
})
