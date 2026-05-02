import { describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrchestratorPanel } from './OrchestratorPanel'
import type { OrchestratorService } from '../services/orchestratorService'
import type {
  DispatchBatch,
  OrchestratorEvent,
  OrchestratorSnapshot,
} from '../types'

const baseSnapshot: OrchestratorSnapshot = {
  paused: false,
  queue: [
    {
      issue: {
        id: 'issue-1',
        identifier: 'VIM-108',
        title: 'Add orchestration UI',
        description: null,
        state: 'Ready',
        url: 'https://example.test/issues/VIM-108',
        labels: ['enhancement'],
        priority: 1,
        updatedAt: '2026-05-02T07:00:00Z',
      },
      status: 'queued',
      runId: null,
      attemptNumber: null,
      nextRetryAt: null,
      lastError: null,
    },
  ],
  running: [
    {
      runId: 'run-1234567890',
      processId: 1234,
      issueId: 'issue-2',
      issueIdentifier: 'VIM-109',
      attemptNumber: 2,
      status: 'running',
      workspacePath: '/tmp/vimeflow/VIM-109',
      stdoutLogPath: '/tmp/vimeflow/VIM-109/stdout.log',
      stderrLogPath: '/tmp/vimeflow/VIM-109/stderr.log',
      startedAt: '2026-05-02T07:05:00Z',
      lastEvent: 'Agent started',
    },
  ],
  retryQueue: [
    {
      issueId: 'issue-3',
      issueIdentifier: 'VIM-110',
      attemptNumber: 3,
      nextRetryAt: '2026-05-02T07:10:00Z',
      lastError: 'Network timeout',
    },
  ],
}

const dispatchEvent: OrchestratorEvent = {
  timestamp: '2026-05-02T07:06:00Z',
  workflowPath: '/repo/WORKFLOW.md',
  issueId: 'issue-2',
  issueIdentifier: 'VIM-109',
  runId: 'run-1234567890',
  attemptNumber: 2,
  status: 'running',
  workspacePath: '/tmp/vimeflow/VIM-109',
  message: 'Agent running',
  error: null,
}

const createService = (
  snapshot: OrchestratorSnapshot = baseSnapshot
): OrchestratorService & {
  emit: (event: OrchestratorEvent) => void
  cleanup: ReturnType<typeof vi.fn>
} => {
  const callbacks: ((event: OrchestratorEvent) => void)[] = []
  const cleanup = vi.fn()

  return {
    loadWorkflow: vi.fn(
      (): Promise<OrchestratorSnapshot> => Promise.resolve(snapshot)
    ),
    refreshSnapshot: vi.fn(
      (): Promise<{
        snapshot: OrchestratorSnapshot
        events: OrchestratorEvent[]
      }> => Promise.resolve({ snapshot, events: [] })
    ),
    setPaused: vi.fn(
      (
        paused: boolean
      ): Promise<{
        snapshot: OrchestratorSnapshot
        events: OrchestratorEvent[]
      }> => Promise.resolve({ snapshot: { ...snapshot, paused }, events: [] })
    ),
    dispatchOnce: vi.fn(
      (): Promise<DispatchBatch> =>
        Promise.resolve({
          snapshot,
          claimed: [],
          started: [],
          failed: [],
          events: [dispatchEvent],
        })
    ),
    stopRun: vi.fn(
      (): Promise<{
        snapshot: OrchestratorSnapshot
        events: OrchestratorEvent[]
      }> =>
        Promise.resolve({
          snapshot: {
            ...snapshot,
            running: [],
            queue: snapshot.queue.map((entry) =>
              entry.issue.id === 'issue-2'
                ? { ...entry, status: 'stopped' }
                : entry
            ),
          },
          events: [{ ...dispatchEvent, status: 'stopped' }],
        })
    ),
    retryIssue: vi.fn(
      (): Promise<DispatchBatch> =>
        Promise.resolve({
          snapshot: { ...snapshot, retryQueue: [] },
          claimed: [],
          started: [],
          failed: [],
          events: [{ ...dispatchEvent, status: 'claimed' }],
        })
    ),
    onEvent: vi.fn(
      (callback: (event: OrchestratorEvent) => void): Promise<() => void> => {
        callbacks.push(callback)

        return Promise.resolve(cleanup)
      }
    ),
    emit: (event: OrchestratorEvent): void => {
      callbacks.forEach((callback) => callback(event))
    },
    cleanup,
  }
}

describe('OrchestratorPanel', () => {
  test('loads a workflow and renders queue, running, and retry rows', async (): Promise<void> => {
    const service = createService()
    const user = userEvent.setup()

    render(<OrchestratorPanel service={service} />)

    await user.type(
      screen.getByRole('textbox', { name: /workflow path/i }),
      '/repo/WORKFLOW.md'
    )
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await screen.findByText('Add orchestration UI')

    expect(service.loadWorkflow).toHaveBeenCalledWith('/repo/WORKFLOW.md')
    expect(screen.getByText('/repo/WORKFLOW.md')).toBeInTheDocument()
    expect(screen.getByText('VIM-108')).toBeInTheDocument()
    expect(screen.getByText('VIM-109')).toBeInTheDocument()
    expect(screen.getByText('VIM-110')).toBeInTheDocument()
    expect(screen.getByText('/tmp/vimeflow/VIM-109')).toBeInTheDocument()
    expect(screen.getByText('Network timeout')).toBeInTheDocument()
  })

  test('shows a validation error when loading without a path', async (): Promise<void> => {
    const service = createService()
    const user = userEvent.setup()

    render(<OrchestratorPanel service={service} />)

    await user.click(screen.getByRole('button', { name: 'Load' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Workflow path is required'
    )
    expect(service.loadWorkflow).not.toHaveBeenCalled()
  })

  test('refreshes and toggles paused state through the service', async (): Promise<void> => {
    const service = createService()
    const user = userEvent.setup()

    render(<OrchestratorPanel service={service} />)

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Add orchestration UI')

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await screen.findByText('Paused')

    expect(service.refreshSnapshot).toHaveBeenCalledOnce()
    expect(service.setPaused).toHaveBeenCalledWith(true)
  })

  test('dispatches once and prepends batch events to the event feed', async (): Promise<void> => {
    const service = createService()
    const user = userEvent.setup()

    render(<OrchestratorPanel service={service} />)

    await user.click(screen.getByRole('button', { name: 'Dispatch' }))

    await screen.findByText('Agent running')
    expect(service.dispatchOnce).toHaveBeenCalledOnce()
  })

  test('stops running work and retries scheduled work from row actions', async (): Promise<void> => {
    const service = createService()
    const user = userEvent.setup()

    render(<OrchestratorPanel service={service} />)

    await user.type(
      screen.getByRole('textbox', { name: /workflow path/i }),
      '/repo/WORKFLOW.md'
    )
    await user.click(screen.getByRole('button', { name: 'Load' }))

    await user.click(screen.getByRole('button', { name: 'Stop VIM-109' }))
    await user.click(screen.getByRole('button', { name: 'Retry VIM-110' }))

    expect(service.stopRun).toHaveBeenCalledWith('issue-2')
    expect(service.retryIssue).toHaveBeenCalledWith('issue-3')
  })

  test('subscribes to orchestrator events and cleans up on unmount', async (): Promise<void> => {
    const service = createService()
    const { unmount } = render(<OrchestratorPanel service={service} />)

    await waitFor(() => expect(service.onEvent).toHaveBeenCalledOnce())

    act(() => {
      service.emit(dispatchEvent)
    })

    expect(screen.getByText('Agent running')).toBeInTheDocument()

    unmount()

    expect(service.cleanup).toHaveBeenCalledOnce()
  })
})
