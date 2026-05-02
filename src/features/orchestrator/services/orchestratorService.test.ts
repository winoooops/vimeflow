import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { TauriOrchestratorService } from './orchestratorService'
import type { OrchestratorEvent, OrchestratorSnapshot } from '../types'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

type EventCallback = (event: { payload: unknown }) => void
const eventListeners = new Map<string, EventCallback[]>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    (eventName: string, callback: EventCallback): Promise<() => void> => {
      const existing = eventListeners.get(eventName) ?? []
      existing.push(callback)
      eventListeners.set(eventName, existing)

      return Promise.resolve(() => {
        const callbacks = eventListeners.get(eventName) ?? []
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
      })
    }
  ),
}))

const { invoke } = await import('@tauri-apps/api/core')
const { listen } = await import('@tauri-apps/api/event')

const snapshot: OrchestratorSnapshot = {
  paused: false,
  queue: [],
  running: [],
  retryQueue: [],
}

const event: OrchestratorEvent = {
  timestamp: '2026-05-02T08:00:00Z',
  workflowPath: '/repo/WORKFLOW.md',
  issueId: 'github:owner/repo#108',
  issueIdentifier: '#108',
  runId: 'run-108',
  attemptNumber: 1,
  status: 'running',
  workspacePath: '/tmp/workspace',
  message: 'agent run started',
  error: null,
}

const emitTauriEvent = (eventName: string, payload: unknown): void => {
  const callbacks = eventListeners.get(eventName) ?? []
  callbacks.forEach((callback) => callback({ payload }))
}

describe('TauriOrchestratorService', () => {
  let service: TauriOrchestratorService

  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    service = new TauriOrchestratorService()
  })

  test('loadWorkflow invokes load_orchestrator_workflow with workflowPath request', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(snapshot)

    const result = await service.loadWorkflow('/repo/WORKFLOW.md')

    expect(invoke).toHaveBeenCalledWith('load_orchestrator_workflow', {
      request: { workflowPath: '/repo/WORKFLOW.md' },
    })
    expect(result).toBe(snapshot)
  })

  test('refreshSnapshot invokes refresh_orchestrator_snapshot', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(snapshot)

    const result = await service.refreshSnapshot()

    expect(invoke).toHaveBeenCalledWith('refresh_orchestrator_snapshot')
    expect(result).toBe(snapshot)
  })

  test('setPaused invokes set_orchestrator_paused with paused request', async () => {
    ;(invoke as Mock).mockResolvedValueOnce({ ...snapshot, paused: true })

    const result = await service.setPaused(true)

    expect(invoke).toHaveBeenCalledWith('set_orchestrator_paused', {
      request: { paused: true },
    })
    expect(result.paused).toBe(true)
  })

  test('dispatchOnce invokes dispatch_orchestrator_once', async () => {
    const batch = { snapshot, claimed: [], started: [], failed: [], events: [] }
    ;(invoke as Mock).mockResolvedValueOnce(batch)

    const result = await service.dispatchOnce()

    expect(invoke).toHaveBeenCalledWith('dispatch_orchestrator_once')
    expect(result).toBe(batch)
  })

  test('onEvent subscribes to orchestrator:event and returns unlisten', async () => {
    const callback = vi.fn()

    const unlisten = await service.onEvent(callback)
    emitTauriEvent('orchestrator:event', event)
    unlisten()
    emitTauriEvent('orchestrator:event', { ...event, status: 'failed' })

    expect(listen).toHaveBeenCalledWith(
      'orchestrator:event',
      expect.any(Function)
    )
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(event)
  })

  test('loadWorkflow wraps Tauri string errors with command context', async () => {
    ;(invoke as Mock).mockRejectedValueOnce('tracker unavailable')

    await expect(service.loadWorkflow('/repo/WORKFLOW.md')).rejects.toThrow(
      'Failed to load orchestrator workflow: tracker unavailable'
    )
  })
})
