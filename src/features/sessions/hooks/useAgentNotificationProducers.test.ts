import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentLifecycleEvent, AgentNotificationEvent } from '@/bindings'
import type { AgentStatusEvent } from '@/features/agent-status/types'
import { __resetBackendEventSubscriptions } from '@/lib/backend'
import { emitTerminalAttention } from '@/features/terminal/notifications'
import type { Session } from '../types'
import { useAgentNotificationProducers } from './useAgentNotificationProducers'

// cspell:ignore Ghostty

const session = (
  id: string,
  ptyId: string,
  overrides: Partial<Session['panes'][number]> = {}
): Session => ({
  id,
  projectId: `project-${id}`,
  name: id,
  open: true,
  status: 'running',
  workingDirectory: `/tmp/${id}`,
  agentType: overrides.agentType ?? 'generic',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId,
      cwd: `/tmp/${id}`,
      agentType: 'generic',
      agentSessionId: `agent-${id}`,
      status: 'running',
      active: true,
      ...overrides,
    },
  ],
  createdAt: '2026-07-31T00:00:00Z',
  lastActivityAt: '2026-07-31T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 1, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 1 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
})

const listeners = new Map<string, (payload: unknown) => void>()

afterEach(() => {
  __resetBackendEventSubscriptions()
  listeners.clear()
  delete window.vimeflow
  vi.useRealTimers()
})

const installBridge = (): void => {
  window.vimeflow = {
    invoke: <T>(): Promise<T> => Promise.resolve(null as T),
    listen: <T>(
      event: string,
      callback: (payload: T) => void
    ): Promise<() => void> => {
      listeners.set(event, callback as (payload: unknown) => void)

      return Promise.resolve(vi.fn())
    },
  }
}

const emit = <T>(event: string, payload: T): void => {
  listeners.get(event)?.(payload)
}

const semanticAttentionAgentTypes = [
  'claude-code',
  'codex',
  'opencode',
] as const

describe('useAgentNotificationProducers', () => {
  test('publishes a notification-only completion without a lifecycle watcher', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', { agentType: 'codex' }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'Codex finished',
        body: 'PR #42 is ready for review',
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith({
      sessionId: 'background',
      ptyId: 'pty-background',
      reason: 'turn-complete',
      title: 'Codex finished',
      body: 'PR #42 is ready for review',
      occurredAt: 42,
      dedupeKey: 'turn:42',
    })
  })

  test('uses observed status identity before pane restoration hydrates', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', {
            agentType: 'codex',
            agentSessionId: undefined,
          }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => {
      expect(listeners.has('agent-status')).toBe(true)
      expect(listeners.has('agent-notification')).toBe(true)
    })
    vi.useFakeTimers()

    act(() => {
      emit<AgentStatusEvent>('agent-status', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        modelId: null,
        modelDisplayName: null,
        version: null,
        contextWindow: null,
        cost: null,
        rateLimits: null,
        usageFetched: false,
      })

      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'Codex finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'turn-complete',
        title: 'Codex finished',
      })
    )
  })

  test('rejects observed identity after authoritative invalidation', async () => {
    installBridge()
    const publish = vi.fn()
    let agentSessionId: string | null | undefined

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', {
            agentType: 'codex',
            agentSessionId: undefined,
          }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => agentSessionId,
      })
    )

    await waitFor(() => {
      expect(listeners.has('agent-status')).toBe(true)
      expect(listeners.has('agent-notification')).toBe(true)
    })

    act(() => {
      emit<AgentStatusEvent>('agent-status', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-old',
        modelId: null,
        modelDisplayName: null,
        version: null,
        contextWindow: null,
        cost: null,
        rateLimits: null,
        usageFetched: false,
      })

      agentSessionId = null
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-old',
        reason: 'agent-error',
        title: 'Old Codex failed',
        body: null,
        occurredAt: BigInt(43),
        dedupeKey: 'error:43',
      })
    })

    expect(publish).not.toHaveBeenCalled()
  })

  test('ignores a stale event after the pane agent is replaced', async () => {
    installBridge()
    const publish = vi.fn()
    let background = session('background', 'pty-background', {
      agentType: 'codex',
      agentSessionId: 'agent-old',
    })

    const { rerender } = renderHook(() =>
      useAgentNotificationProducers({
        sessions: [session('active', 'pty-active'), background],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      background = session('background', 'pty-background', {
        agentType: 'codex',
        agentSessionId: 'agent-new',
      })
      rerender()
    })

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-new',
        reason: 'turn-complete',
        title: 'New Codex finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })

      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-old',
        reason: 'agent-error',
        title: 'Old Codex failed',
        body: null,
        occurredAt: BigInt(43),
        dedupeKey: 'error:43',
      })

      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'turn-complete',
        title: 'New Codex finished',
      })
    )
  })

  test('drops a completion when the pane agent changes during settle', async () => {
    installBridge()
    const publish = vi.fn()
    let background = session('background', 'pty-background', {
      agentType: 'codex',
      agentSessionId: 'agent-old',
    })

    const { rerender } = renderHook(() =>
      useAgentNotificationProducers({
        sessions: [session('active', 'pty-active'), background],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-old',
        reason: 'turn-complete',
        title: 'Old Codex finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
    })

    act(() => {
      background = session('background', 'pty-background', {
        agentType: 'codex',
        agentSessionId: 'agent-new',
      })
      rerender()
    })

    act(() => {
      vi.advanceTimersByTime(750)
    })

    expect(publish).not.toHaveBeenCalled()
  })

  test('rejects a semantic completion older than the latest running lifecycle', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', {
            agentType: 'claude-code',
          }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => {
      expect(listeners.has('agent-lifecycle')).toBe(true)
      expect(listeners.has('agent-notification')).toBe(true)
    })
    vi.useFakeTimers()

    act(() => {
      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'running',
        occurredAt: BigInt(42),
      })

      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'Claude finished',
        body: null,
        occurredAt: BigInt(41),
        dedupeKey: 'turn:41',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).not.toHaveBeenCalled()
  })

  test('does not duplicate a normalized completion from the full watcher', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', { agentType: 'codex' }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => {
      expect(listeners.has('agent-lifecycle')).toBe(true)
      expect(listeners.has('agent-notification')).toBe(true)
    })
    vi.useFakeTimers()

    act(() => {
      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'running',
        occurredAt: BigInt(1),
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
        occurredAt: BigInt(2),
      })
      vi.advanceTimersByTime(750)
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'Codex finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Codex finished' })
    )
  })

  test('does not suppress the next normalized completion after an error', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', {
            agentType: 'opencode',
          }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'agent-error',
        title: 'OpenCode failed',
        body: null,
        occurredAt: BigInt(41),
        dedupeKey: 'error:41',
      })

      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'OpenCode finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: 'turn-complete',
        title: 'OpenCode finished',
      })
    )
  })

  test('cancels a pending completion when the agent reports an error', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', { agentType: 'opencode' }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'turn-complete',
        title: 'OpenCode finished',
        body: null,
        occurredAt: BigInt(41),
        dedupeKey: 'turn:41',
      })

      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-background',
        agentSessionId: 'agent-background',
        reason: 'agent-error',
        title: 'OpenCode failed',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'error:42',
      })
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'agent-error',
        title: 'OpenCode failed',
      })
    )
  })

  test('publishes only a live running-to-idle transition in a background pane', async () => {
    installBridge()
    const publish = vi.fn()
    const background = session('background', 'pty-background')

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [session('active', 'pty-active'), background],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-lifecycle')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
        occurredAt: BigInt(1),
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'running',
        occurredAt: BigInt(2),
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
        occurredAt: BigInt(3),
      })
    })

    expect(publish).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(750)
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'background',
        ptyId: 'pty-background',
        reason: 'turn-complete',
        title: 'Shell finished',
      })
    )
  })

  test('routes xterm and Ghostty attention through the same background rule', () => {
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background'),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    act(() => {
      emitTerminalAttention({ ptyId: 'pty-active' })
      emitTerminalAttention({ ptyId: 'pty-background', body: 'build done' })
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'background',
        ptyId: 'pty-background',
        reason: 'terminal-attention',
        title: 'Terminal requested attention',
        body: 'build done',
      })
    )
  })

  test.each(semanticAttentionAgentTypes)(
    'suppresses terminal attention for %s panes',
    (agentType) => {
      const publish = vi.fn()

      renderHook(() =>
        useAgentNotificationProducers({
          sessions: [
            session('active', 'pty-active'),
            session('background', 'pty-background', { agentType }),
          ],
          activeSessionId: 'active',
          publish,
          getAgentSessionId: () => undefined,
        })
      )

      act(() => {
        emitTerminalAttention({ ptyId: 'pty-background', body: 'approval' })
      })

      expect(publish).not.toHaveBeenCalled()
    }
  )

  test('preserves terminal attention for completion-only Kimi panes', () => {
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background', { agentType: 'kimi' }),
        ],
        activeSessionId: 'active',
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    act(() => {
      emitTerminalAttention({ ptyId: 'pty-background', body: 'approval' })
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        ptyId: 'pty-background',
        reason: 'terminal-attention',
        body: 'approval',
      })
    )
  })

  test('does not publish a foreground completion after navigation during settle', async () => {
    installBridge()
    const publish = vi.fn()
    let activeSessionId = 'active'

    const { rerender } = renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active', { agentType: 'codex' }),
          session('background', 'pty-background'),
        ],
        activeSessionId,
        publish,
        getAgentSessionId: () => undefined,
      })
    )

    await waitFor(() => expect(listeners.has('agent-notification')).toBe(true))
    vi.useFakeTimers()

    act(() => {
      emit<AgentNotificationEvent>('agent-notification', {
        ptyId: 'pty-active',
        agentSessionId: 'agent-active',
        reason: 'turn-complete',
        title: 'Codex finished',
        body: null,
        occurredAt: BigInt(42),
        dedupeKey: 'turn:42',
      })
      activeSessionId = 'background'
      rerender()
      vi.advanceTimersByTime(750)
    })

    expect(publish).not.toHaveBeenCalled()
  })

  test.each(semanticAttentionAgentTypes)(
    'coalesces a %s semantic completion over terminal attention',
    async (agentType) => {
      installBridge()
      const publish = vi.fn()

      renderHook(() =>
        useAgentNotificationProducers({
          sessions: [
            session('active', 'pty-active'),
            session('background', 'pty-background', { agentType }),
          ],
          activeSessionId: 'active',
          publish,
          getAgentSessionId: () => undefined,
        })
      )

      await waitFor(() =>
        expect(listeners.has('agent-notification')).toBe(true)
      )
      vi.useFakeTimers()

      act(() => {
        emitTerminalAttention({ ptyId: 'pty-background', body: 'attention' })
        emit<AgentNotificationEvent>('agent-notification', {
          ptyId: 'pty-background',
          agentSessionId: 'agent-background',
          reason: 'turn-complete',
          title: `${agentType} finished`,
          body: null,
          occurredAt: BigInt(42),
          dedupeKey: 'turn:42',
        })
        vi.advanceTimersByTime(750)
      })

      expect(publish).toHaveBeenCalledOnce()
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'turn-complete',
          title: `${agentType} finished`,
        })
      )
    }
  )

  test.each(semanticAttentionAgentTypes)(
    'suppresses %s terminal attention during semantic watcher recovery',
    async (agentType) => {
      installBridge()
      const publish = vi.fn()

      renderHook(() =>
        useAgentNotificationProducers({
          sessions: [
            session('active', 'pty-active'),
            session('background', 'pty-background', { agentType }),
          ],
          activeSessionId: 'active',
          publish,
          getAgentSessionId: () => undefined,
        })
      )

      await waitFor(() =>
        expect(listeners.has('agent-notification')).toBe(true)
      )
      vi.useFakeTimers()

      act(() => {
        emitTerminalAttention({ ptyId: 'pty-background', body: 'attention' })
        vi.advanceTimersByTime(2_999)
        emit<AgentNotificationEvent>('agent-notification', {
          ptyId: 'pty-background',
          agentSessionId: 'agent-background',
          reason: 'turn-complete',
          title: `${agentType} finished`,
          body: null,
          occurredAt: BigInt(42),
          dedupeKey: 'turn:42',
        })
        vi.advanceTimersByTime(750)
      })

      expect(publish).toHaveBeenCalledOnce()
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'turn-complete' })
      )
    }
  )
})
