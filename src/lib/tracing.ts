import type {
  AgentType,
  SetTracingEnabledRequest,
  TraceUserInteractionRequest,
} from '../bindings'
import { createLogger } from './log'

export type TraceInvoke = <T>(
  method: string,
  args?: Record<string, unknown>
) => Promise<T>

export interface UserInteractionTrace {
  correlationId: string
  spanId: string
}

export interface UserInteractionTraceOptions {
  sessionId?: string
  agentType?: AgentType | null
  attributes?: Record<string, string | number | boolean | null | undefined>
}

export const TRACING_ENABLED_STORAGE_KEY = 'vimeflow.tracing.enabled'

const log = createLogger('tracing')
let fallbackSequence = 0

const localStorageOrNull = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

const normalizeAttributes = (
  attributes: UserInteractionTraceOptions['attributes'] = {}
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(attributes)
      .filter((entry): entry is [string, string | number | boolean] => {
        const [, value] = entry

        return value !== null && value !== undefined
      })
      .map(([key, value]) => [key, String(value)])
  )

const randomToken = (): string => {
  const runtimeGlobal = globalThis as { crypto?: Crypto }
  const runtimeCrypto = runtimeGlobal.crypto

  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID()
  }

  if (typeof runtimeCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    runtimeCrypto.getRandomValues(bytes)

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  }

  fallbackSequence += 1

  return `${Date.now().toString(36)}_${String(fallbackSequence)}`
}

const createTraceId = (prefix: string): string =>
  `${prefix}_${randomToken().replace(/[^A-Za-z0-9_-]/g, '_')}`

export const isTracingEnabled = (): boolean =>
  localStorageOrNull()?.getItem(TRACING_ENABLED_STORAGE_KEY) === 'true'

export const setTracingEnabledWithInvoke = async (
  invokeBackend: TraceInvoke,
  enabled: boolean
): Promise<void> => {
  localStorageOrNull()?.setItem(
    TRACING_ENABLED_STORAGE_KEY,
    enabled ? 'true' : 'false'
  )

  await invokeBackend<null>('set_tracing_enabled', {
    enabled,
  } satisfies SetTracingEnabledRequest)
}

export const startUserInteractionTrace = async (
  invokeBackend: TraceInvoke,
  event: string,
  options: UserInteractionTraceOptions = {}
): Promise<UserInteractionTrace | null> => {
  if (!isTracingEnabled()) {
    return null
  }

  const trace = {
    correlationId: createTraceId('vf_corr'),
    spanId: createTraceId('vf_span'),
  } satisfies UserInteractionTrace

  const request = {
    correlationId: trace.correlationId,
    spanId: trace.spanId,
    event,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.agentType ? { agentType: options.agentType } : {}),
    attributes: normalizeAttributes(options.attributes),
  } satisfies TraceUserInteractionRequest

  try {
    await invokeBackend<null>('set_tracing_enabled', {
      enabled: true,
    } satisfies SetTracingEnabledRequest)
    await invokeBackend<null>('trace_user_interaction', request)

    return trace
  } catch (error) {
    log.warn('failed to record user interaction trace', error)

    return null
  }
}
