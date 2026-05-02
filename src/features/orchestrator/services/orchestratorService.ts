import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  ControlBatch,
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
  refreshSnapshot(): Promise<ControlBatch>
  setPaused(paused: boolean): Promise<ControlBatch>
  dispatchOnce(): Promise<DispatchBatch>
  stopRun(issueId: string): Promise<ControlBatch>
  retryIssue(issueId: string): Promise<DispatchBatch>
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

  async refreshSnapshot(): Promise<ControlBatch> {
    try {
      return await invoke<ControlBatch>('refresh_orchestrator_snapshot')
    } catch (error) {
      throw commandError('refresh orchestrator snapshot', error)
    }
  }

  async setPaused(paused: boolean): Promise<ControlBatch> {
    try {
      return await invoke<ControlBatch>('set_orchestrator_paused', {
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

  async stopRun(issueId: string): Promise<ControlBatch> {
    try {
      return await invoke<ControlBatch>('stop_orchestrator_run', {
        request: { issueId },
      })
    } catch (error) {
      throw commandError('stop orchestrator run', error)
    }
  }

  async retryIssue(issueId: string): Promise<DispatchBatch> {
    try {
      return await invoke<DispatchBatch>('retry_orchestrator_issue', {
        request: { issueId },
      })
    } catch (error) {
      throw commandError('retry orchestrator issue', error)
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

  refreshSnapshot(): Promise<ControlBatch> {
    return Promise.resolve({
      snapshot: this.snapshot,
      events: [],
    })
  }

  setPaused(paused: boolean): Promise<ControlBatch> {
    this.snapshot = { ...this.snapshot, paused }

    return Promise.resolve({
      snapshot: this.snapshot,
      events: [],
    })
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

  stopRun(issueId: string): Promise<ControlBatch> {
    const running = this.snapshot.running.filter(
      (run) => run.issueId !== issueId
    )

    const queue = this.snapshot.queue.map((entry) =>
      entry.issue.id === issueId
        ? { ...entry, status: 'stopped' as const }
        : entry
    )

    this.snapshot = { ...this.snapshot, queue, running }

    return Promise.resolve({
      snapshot: this.snapshot,
      events: [],
    })
  }

  retryIssue(issueId: string): Promise<DispatchBatch> {
    const queue = this.snapshot.queue.map((entry) =>
      entry.issue.id === issueId
        ? {
            ...entry,
            status: 'claimed' as const,
            attemptNumber: (entry.attemptNumber ?? 0) + 1,
            nextRetryAt: null,
          }
        : entry
    )

    this.snapshot = {
      ...this.snapshot,
      queue,
      retryQueue: this.snapshot.retryQueue.filter(
        (entry) => entry.issueId !== issueId
      ),
    }

    return this.dispatchOnce()
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
