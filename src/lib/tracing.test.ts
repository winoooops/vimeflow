import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TRACING_ENABLED_STORAGE_KEY,
  isTracingEnabled,
  setTracingEnabledWithInvoke,
  startUserInteractionTrace,
  type TraceInvoke,
} from './tracing'

describe('tracing', () => {
  type InvokeSpy = (
    method: string,
    args?: Record<string, unknown>
  ) => Promise<unknown>

  let invokeBackend: TraceInvoke
  let invokeSpy: ReturnType<typeof vi.fn<InvokeSpy>>

  beforeEach(() => {
    window.localStorage.clear()
    invokeSpy = vi.fn<InvokeSpy>().mockResolvedValue(null)
    invokeBackend = async <T>(
      method: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      const result = await invokeSpy(method, args)

      return result as T
    }
  })

  test('isTracingEnabled reads the local setting', () => {
    expect(isTracingEnabled()).toBe(false)

    window.localStorage.setItem(TRACING_ENABLED_STORAGE_KEY, 'true')

    expect(isTracingEnabled()).toBe(true)
  })

  test('setTracingEnabledWithInvoke persists the setting and calls backend', async () => {
    await setTracingEnabledWithInvoke(invokeBackend, true)

    expect(window.localStorage.getItem(TRACING_ENABLED_STORAGE_KEY)).toBe(
      'true'
    )

    expect(invokeSpy).toHaveBeenCalledWith('set_tracing_enabled', {
      enabled: true,
    })
  })

  test('startUserInteractionTrace does nothing while disabled', async () => {
    const trace = await startUserInteractionTrace(
      invokeBackend,
      'pane.rename',
      {
        sessionId: 'pty-1',
      }
    )

    expect(trace).toBeNull()
    expect(invokeSpy).not.toHaveBeenCalled()
  })

  test('startUserInteractionTrace writes frontend metadata with correlation ids', async () => {
    window.localStorage.setItem(TRACING_ENABLED_STORAGE_KEY, 'true')

    const trace = await startUserInteractionTrace(
      invokeBackend,
      'pane.rename',
      {
        sessionId: 'pty-1',
        agentType: 'codex',
        attributes: {
          titleLength: 7,
          ignored: null,
        },
      }
    )

    expect(trace).not.toBeNull()
    expect(invokeSpy).toHaveBeenNthCalledWith(1, 'set_tracing_enabled', {
      enabled: true,
    })

    const traceRequest = invokeSpy.mock.calls[1]?.[1]
    expect(invokeSpy.mock.calls[1]?.[0]).toBe('trace_user_interaction')
    expect(traceRequest).toMatchObject({
      correlationId: trace?.correlationId,
      spanId: trace?.spanId,
      event: 'pane.rename',
      sessionId: 'pty-1',
      agentType: 'codex',
      attributes: {
        titleLength: '7',
      },
    })
    expect(traceRequest).not.toHaveProperty('attributes.ignored')
  })
})
