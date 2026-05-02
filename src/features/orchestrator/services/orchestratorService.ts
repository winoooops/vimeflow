import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  DispatchBatch,
  OrchestratorEvent,
  OrchestratorSnapshot,
} from '../types'

const ORCHESTRATOR_EVENT = 'orchestrator:event'

const EMPTY_SNAPSHOT: OrchestratorSnapshot = {
  paused: false,
  queue: [],
  running: [],
  retryQueue: [],
}

export interface OrchestratorService {
  loadWorkflow(workflowPath: string): Promise<OrchestratorSnapshot>
  refreshSnapshot(): Promise<OrchestratorSnapshot>
  setPaused(paused: boolean): Promise<OrchestratorSnapshot>
  dispatchOnce(): Promise<DispatchBatch>
  onEvent(callback: (event: OrchestratorEvent) => void): Promise<() => void>
}

export class TauriOrchestratorService implements OrchestratorService {
  async loadWorkflow(workflowPath: string): Promise<OrchestratorSnapshot> {
    try {
      return await invoke<OrchestratorSnapshot>('load_orchestrator_workflow', {
        request: { workflowPath },
      })
    } catch (error) {
      throw commandError('load orchestrator workflow', error)
    }
  }

  async refreshSnapshot(): Promise<OrchestratorSnapshot> {
    try {
      return await invoke<OrchestratorSnapshot>('refresh_orchestrator_snapshot')
    } catch (error) {
      throw commandError('refresh orchestrator snapshot', error)
    }
  }

  async setPaused(paused: boolean): Promise<OrchestratorSnapshot> {
    try {
      return await invoke<OrchestratorSnapshot>('set_orchestrator_paused', {
        request: { paused },
      })
    } catch (error) {
      throw commandError(
        paused ? 'pause orchestrator' : 'resume orchestrator',
        error
      )
    }
  }

  async dispatchOnce(): Promise<DispatchBatch> {
    try {
      return await invoke<DispatchBatch>('dispatch_orchestrator_once')
    } catch (error) {
      throw commandError('dispatch orchestrator work', error)
    }
  }

  async onEvent(
    callback: (event: OrchestratorEvent) => void
  ): Promise<() => void> {
    try {
      const unlisten = await listen<OrchestratorEvent>(
        ORCHESTRATOR_EVENT,
        (event) => {
          callback(event.payload)
        }
      )

      return unlisten
    } catch (error) {
      throw commandError('listen for orchestrator events', error)
    }
  }
}

export class MockOrchestratorService implements OrchestratorService {
  private snapshot: OrchestratorSnapshot
  private callbacks: ((event: OrchestratorEvent) => void)[] = []

  constructor(snapshot: OrchestratorSnapshot = EMPTY_SNAPSHOT) {
    this.snapshot = snapshot
  }

  loadWorkflow(): Promise<OrchestratorSnapshot> {
    return Promise.resolve(this.snapshot)
  }

  refreshSnapshot(): Promise<OrchestratorSnapshot> {
    return Promise.resolve(this.snapshot)
  }

  setPaused(paused: boolean): Promise<OrchestratorSnapshot> {
    this.snapshot = { ...this.snapshot, paused }

    return Promise.resolve(this.snapshot)
  }

  dispatchOnce(): Promise<DispatchBatch> {
    return Promise.resolve({
      snapshot: this.snapshot,
      claimed: [],
      started: [],
      failed: [],
      events: [],
    })
  }

  onEvent(callback: (event: OrchestratorEvent) => void): Promise<() => void> {
    this.callbacks.push(callback)

    return Promise.resolve(() => {
      const index = this.callbacks.indexOf(callback)
      if (index > -1) {
        this.callbacks.splice(index, 1)
      }
    })
  }

  emitEventForTests(event: OrchestratorEvent): void {
    this.callbacks.forEach((callback) => callback(event))
  }
}

export const createOrchestratorService = (): OrchestratorService => {
  if (import.meta.env.MODE === 'test') {
    return new MockOrchestratorService()
  }

  if ('__TAURI_INTERNALS__' in window) {
    return new TauriOrchestratorService()
  }

  return new MockOrchestratorService()
}

const commandError = (action: string, error: unknown): Error =>
  new Error(`Failed to ${action}: ${String(error)}`)
