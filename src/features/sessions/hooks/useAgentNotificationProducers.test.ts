import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentAttentionEvent, AgentLifecycleEvent } from '@/bindings'
import { __resetBackendEventSubscriptions } from '@/lib/backend'
import { emitTerminalAttention } from '@/features/terminal/notifications'
import type { Session } from '../types'
import { useAgentNotificationProducers } from './useAgentNotificationProducers'

// cspell:ignore Ghostty

const session = (id: string, ptyId: string): Session => ({
  id,
  projectId: `project-${id}`,
  name: id,
  open: true,
  status: 'running',
  workingDirectory: `/tmp/${id}`,
  agentType: 'claude-code',
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [
    {
      id: 'p0',
      ptyId,
      cwd: `/tmp/${id}`,
      agentType: 'claude-code',
      agentSessionId: `agent-${id}`,
      status: 'running',
      active: true,
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

describe('useAgentNotificationProducers', () => {
  test('publishes only a live running-to-idle transition in a background pane', async () => {
    installBridge()
    const publish = vi.fn()
    const background = session('background', 'pty-background')

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [session('active', 'pty-active'), background],
        activeSessionId: 'active',
        publish,
      })
    )

    await waitFor(() => expect(listeners.has('agent-lifecycle')).toBe(true))

    act(() => {
      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'running',
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
      })
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'background',
        ptyId: 'pty-background',
        reason: 'turn-complete',
        title: 'Claude Code finished',
      })
    )
  })

  test('routes bounded semantic attention and ignores the active pane', async () => {
    installBridge()
    const publish = vi.fn()

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [
          session('active', 'pty-active'),
          session('background', 'pty-background'),
        ],
        activeSessionId: 'active',
        publish,
      })
    )

    await waitFor(() => expect(listeners.has('agent-attention')).toBe(true))

    const attention = (ptyId: string): AgentAttentionEvent => ({
      ptyId,
      reason: 'approval-requested',
      title: 'Claude needs approval',
      body: 'Edit WorkspaceView.tsx',
      occurredAt: BigInt(42),
      dedupeKey: 'permission-42',
    })

    act(() => {
      emit('agent-attention', attention('pty-active'))
      emit('agent-attention', attention('pty-background'))
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith({
      sessionId: 'background',
      ptyId: 'pty-background',
      reason: 'approval-requested',
      title: 'Claude needs approval',
      body: 'Edit WorkspaceView.tsx',
      occurredAt: 42,
      dedupeKey: 'permission-42',
    })
  })

  test('publishes an error without a completion for the same failed turn', async () => {
    installBridge()
    const publish = vi.fn()
    const background = session('background', 'pty-background')

    renderHook(() =>
      useAgentNotificationProducers({
        sessions: [session('active', 'pty-active'), background],
        activeSessionId: 'active',
        publish,
      })
    )

    await waitFor(() => {
      expect(listeners.has('agent-lifecycle')).toBe(true)
      expect(listeners.has('agent-attention')).toBe(true)
    })

    act(() => {
      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'running',
      })

      emit<AgentAttentionEvent>('agent-attention', {
        ptyId: 'pty-background',
        reason: 'agent-error',
        title: 'OpenCode failed',
        body: 'Model stopped responding',
        occurredAt: BigInt(42),
        dedupeKey: 'error-42',
      })

      emit<AgentLifecycleEvent>('agent-lifecycle', {
        sessionId: 'pty-background',
        agentSessionId: 'agent-background',
        phase: 'idle',
      })
    })

    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'agent-error',
        title: 'OpenCode failed',
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
})
