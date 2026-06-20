import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { invoke, listen } from '../../../lib/backend'
import { getPtySessionId } from '../../terminal/ptySessionMap'
import { useAgentReattach } from './useAgentReattach'
import type { AgentStatusEvent } from '../types'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('../../terminal/ptySessionMap', () => ({
  getPtySessionId: vi.fn(),
}))

type Listener = (payload: unknown) => void

const listeners = new Map<string, Listener[]>()

const emit = (event: string, payload: unknown): void => {
  for (const cb of listeners.get(event) ?? []) {
    cb(payload)
  }
}

const makeEvent = (overrides: Partial<AgentStatusEvent>): AgentStatusEvent => ({
  sessionId: 'pty-session-1',
  agentSessionId: null,
  modelId: null,
  modelDisplayName: null,
  version: null,
  contextWindow: null,
  cost: null,
  rateLimits: null,
  usageFetched: false,
  ...overrides,
})

const makeContextWindow = (
  total: number
): AgentStatusEvent['contextWindow'] => ({
  usedPercentage: 0,
  remainingPercentage: 100,
  contextWindowSize: BigInt(200000),
  totalInputTokens: BigInt(total),
  totalOutputTokens: BigInt(0),
  currentUsage: {
    inputTokens: BigInt(0),
    outputTokens: BigInt(0),
    cacheCreationInputTokens: BigInt(0),
    cacheReadInputTokens: BigInt(0),
  },
})

beforeEach(() => {
  listeners.clear()
  vi.useFakeTimers()
  vi.mocked(getPtySessionId).mockImplementation((id) => `pty-${id}`)
  vi.mocked(invoke).mockResolvedValue(null as never)
  vi.mocked(listen).mockImplementation((event, handler) => {
    const arr = listeners.get(event) ?? []
    arr.push(handler as Listener)
    listeners.set(event, arr)

    return Promise.resolve((): void => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== handler)
      )
    })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('reattach re-invokes start_agent_watcher for the resolved pty', () => {
  const { result } = renderHook(() =>
    useAgentReattach({
      sessionId: 'session-1',
      agentSessionId: null,
      staleGeneration: 0,
    })
  )

  act(() => {
    result.current.reattach()
  })

  expect(invoke).toHaveBeenCalledWith('start_agent_watcher', {
    sessionId: 'pty-session-1',
  })
})

test('reattach is a no-op without a session', () => {
  const { result } = renderHook(() =>
    useAgentReattach({
      sessionId: null,
      agentSessionId: null,
      staleGeneration: 0,
    })
  )

  act(() => {
    result.current.reattach()
  })

  expect(invoke).not.toHaveBeenCalled()
})

test('reattach is single-flight while one is in progress', () => {
  vi.mocked(invoke).mockImplementation(
    () => new Promise<never>(() => undefined) // never resolves
  )

  const { result } = renderHook(() =>
    useAgentReattach({
      sessionId: 'session-1',
      agentSessionId: null,
      staleGeneration: 0,
    })
  )

  act(() => {
    result.current.reattach()
    result.current.reattach()
  })

  expect(invoke).toHaveBeenCalledTimes(1)
})

test('a stale-generation bump marks needsReattach', () => {
  const { result, rerender } = renderHook(
    ({ gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { gen: 0 } }
  )

  expect(result.current.needsReattach).toBe(false)

  act(() => {
    rerender({ gen: 1 })
  })

  expect(result.current.needsReattach).toBe(true)
})

test('stale state triggers a bounded, deferred auto-reattach', async () => {
  const { rerender } = renderHook(
    ({ gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { gen: 0 } }
  )

  act(() => {
    rerender({ gen: 1 })
  })

  // Deferred: nothing fires before the initial delay.
  expect(invoke).not.toHaveBeenCalled()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(invoke).toHaveBeenCalledTimes(1)

  // Bounded: retries cap out (5 issued calls total) and then stop.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700 * 6)
  })
  expect(invoke).toHaveBeenCalledTimes(5)
})

test('auto-reattach stops after bounded no-op rounds when pty is absent', async () => {
  vi.mocked(getPtySessionId).mockReturnValue(undefined)

  const { rerender } = renderHook(
    ({ gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { gen: 0 } }
  )

  act(() => {
    rerender({ gen: 1 })
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400 + 700 * 6)
  })

  expect(invoke).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test('the stale session id is ignored; a new id clears needsReattach', () => {
  const { result, rerender } = renderHook(
    ({ aid, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    {
      initialProps: { aid: 'codex-old' as string | null, gen: 0 },
    }
  )

  // /clear captures the live id ('codex-old') from useAgentStatus.
  act(() => {
    rerender({ aid: 'codex-old', gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  // The OLD watcher keeps emitting the stale id → must NOT clear (P2).
  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-old' }))
  })
  expect(result.current.needsReattach).toBe(true)

  // The relocated watcher emits a NEW id → success.
  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-new' }))
  })
  expect(result.current.needsReattach).toBe(false)
})

test('repeated /clear preserves the original stale identity', () => {
  const { result, rerender } = renderHook(
    ({ aid, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    { initialProps: { aid: 'codex-old' as string | null, gen: 0 } }
  )

  // First /clear captures 'codex-old' from the still-live status.
  act(() => {
    rerender({ aid: 'codex-old', gen: 1 })
  })

  // A second /clear arrives after useAgentStatus has reset the live id to null.
  act(() => {
    rerender({ aid: null, gen: 2 })
  })
  expect(result.current.needsReattach).toBe(true)

  // The OLD watcher (still on the original rollout) keeps emitting 'codex-old'
  // → it must NOT be treated as fresh just because the live id is now null.
  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-old' }))
  })
  expect(result.current.needsReattach).toBe(true)

  // A late success for the first clear must not resolve the newer generation.
  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-new' }))
  })
  expect(result.current.needsReattach).toBe(true)

  // A subsequent fresh event resolves the still-armed second clear.
  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-newer' }))
  })
  expect(result.current.needsReattach).toBe(false)
})

test('a same-session /clear from zero tokens clears on the reset event', () => {
  const { result, rerender } = renderHook(
    ({ aid, tok, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        agentTokenTotal: tok,
        staleGeneration: gen,
      }),
    {
      initialProps: {
        aid: 'codex-1' as string | null,
        tok: 0 as number | null,
        gen: 0,
      },
    }
  )

  // /clear keeps the same id; the pre-clear total was 0, so `< staleTotal` can
  // never hold — the zero-token reset event must still count as fresh.
  act(() => {
    rerender({ aid: 'codex-1', tok: 0, gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    emit(
      'agent-status',
      makeEvent({
        agentSessionId: 'codex-1',
        contextWindow: makeContextWindow(0),
      })
    )
  })
  expect(result.current.needsReattach).toBe(false)
})

test('a same-session /clear with unknown token baseline clears on known tokens', () => {
  const { result, rerender } = renderHook(
    ({ aid, tok, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        agentTokenTotal: tok,
        staleGeneration: gen,
      }),
    {
      initialProps: {
        aid: 'codex-1' as string | null,
        tok: null as number | null,
        gen: 0,
      },
    }
  )

  act(() => {
    rerender({ aid: 'codex-1', tok: null, gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    emit(
      'agent-status',
      makeEvent({
        agentSessionId: 'codex-1',
        contextWindow: makeContextWindow(100),
      })
    )
  })
  expect(result.current.needsReattach).toBe(false)
})

test('a same-session /clear (lower token total) clears needsReattach', () => {
  const { result, rerender } = renderHook(
    ({ aid, tok, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        agentTokenTotal: tok,
        staleGeneration: gen,
      }),
    {
      initialProps: {
        aid: 'codex-1' as string | null,
        tok: 5000 as number | null,
        gen: 0,
      },
    }
  )

  // /clear keeps the same agentSessionId; the pre-clear total was 5000.
  act(() => {
    rerender({ aid: 'codex-1', tok: 5000, gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  // The relocated run reuses the id but reset its tokens (lower) → fresh.
  act(() => {
    emit(
      'agent-status',
      makeEvent({
        agentSessionId: 'codex-1',
        contextWindow: makeContextWindow(100),
      })
    )
  })
  expect(result.current.needsReattach).toBe(false)
})

test('events for other ptys do not clear needsReattach', () => {
  const { result, rerender } = renderHook(
    ({ aid, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    { initialProps: { aid: 'codex-old' as string | null, gen: 0 } }
  )

  act(() => {
    rerender({ aid: 'codex-old', gen: 1 })
  })

  act(() => {
    emit(
      'agent-status',
      makeEvent({ sessionId: 'pty-other', agentSessionId: 'codex-new' })
    )
  })

  expect(result.current.needsReattach).toBe(true)
})

test('reaching the not-stale sentinel clears needsReattach', () => {
  const { result, rerender } = renderHook(
    ({ gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { gen: 0 } }
  )

  act(() => {
    rerender({ gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  // Active pane changed to one with no pending /clear (the `0` sentinel).
  act(() => {
    rerender({ gen: 0 })
  })
  expect(result.current.needsReattach).toBe(false)
})

test('switching to a non-stale pane drops carried-over stale state', () => {
  const { result, rerender } = renderHook(
    ({ sid, gen }) =>
      useAgentReattach({
        sessionId: sid,
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { sid: 'session-1', gen: 0 } }
  )

  act(() => {
    rerender({ sid: 'session-1', gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  // A pane with no pending /clear reports staleGeneration 0 → the red state
  // must not leak onto it.
  act(() => {
    rerender({ sid: 'session-2', gen: 0 })
  })
  expect(result.current.needsReattach).toBe(false)
})

test('switching away from an unresolved stale pane preserves stale identity', () => {
  const { result, rerender } = renderHook(
    ({ sid, aid, gen }) =>
      useAgentReattach({
        sessionId: sid,
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    {
      initialProps: {
        sid: 'session-1',
        aid: 'codex-old' as string | null,
        gen: 0,
      },
    }
  )

  act(() => {
    rerender({ sid: 'session-1', aid: 'codex-old', gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    rerender({ sid: 'session-2', aid: null, gen: 0 })
  })
  expect(result.current.needsReattach).toBe(false)

  act(() => {
    rerender({ sid: 'session-1', aid: null, gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-old' }))
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-new' }))
  })
  expect(result.current.needsReattach).toBe(false)
})

test('a late success event does not resolve a newer stale generation', () => {
  const { result, rerender } = renderHook(
    ({ aid, gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    { initialProps: { aid: 'codex-old' as string | null, gen: 0 } }
  )

  act(() => {
    rerender({ aid: 'codex-old', gen: 1 })
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    rerender({ aid: null, gen: 2 })
  })

  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-new' }))
  })
  expect(result.current.needsReattach).toBe(true)

  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-newer' }))
  })
  expect(result.current.needsReattach).toBe(false)
})

test('auto-reattach keeps retrying after an IPC failure', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('boom'))

  const { rerender } = renderHook(
    ({ gen }) =>
      useAgentReattach({
        sessionId: 'session-1',
        agentSessionId: null,
        staleGeneration: gen,
      }),
    { initialProps: { gen: 0 } }
  )

  act(() => {
    rerender({ gen: 1 })
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(invoke).toHaveBeenCalledTimes(1)

  // A rejecting invoke must not halt the bounded retry loop.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700 * 6)
  })
  expect(invoke).toHaveBeenCalledTimes(5)
})

test('a recovered pane does not re-arm when re-selected', () => {
  const { result, rerender } = renderHook(
    ({ sid, aid, gen }) =>
      useAgentReattach({
        sessionId: sid,
        agentSessionId: aid,
        staleGeneration: gen,
      }),
    {
      initialProps: {
        sid: 'session-1',
        aid: 'codex-old' as string | null,
        gen: 0,
      },
    }
  )

  // /clear on session-1, then the relocate lands (new id) → resolved.
  act(() => {
    rerender({ sid: 'session-1', aid: 'codex-old', gen: 1 })
  })

  act(() => {
    emit('agent-status', makeEvent({ agentSessionId: 'codex-new' }))
  })
  expect(result.current.needsReattach).toBe(false)

  // Switch away, then back: the same (now non-zero) generation reappears, but
  // the key is already resolved → it must NOT flash red again.
  act(() => {
    rerender({ sid: 'session-2', aid: 'codex-new', gen: 0 })
  })

  act(() => {
    rerender({ sid: 'session-1', aid: 'codex-new', gen: 1 })
  })
  expect(result.current.needsReattach).toBe(false)
})
