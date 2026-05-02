import { describe, expect, test } from 'vitest'
import { ORCHESTRATOR_RUN_STATUSES, type OrchestratorSnapshot } from './index'

describe('orchestrator types', () => {
  test('exports the backend run statuses in wire format', () => {
    expect(ORCHESTRATOR_RUN_STATUSES).toEqual([
      'queued',
      'claimed',
      'preparing_workspace',
      'rendering_prompt',
      'running',
      'retry_scheduled',
      'succeeded',
      'failed',
      'stopped',
      'released',
    ])
  })

  test('snapshot type matches the backend queue shape', () => {
    const snapshot: OrchestratorSnapshot = {
      paused: false,
      queue: [
        {
          issue: {
            id: 'github:owner/repo#108',
            identifier: '#108',
            title: 'Build orchestrator',
            description: null,
            state: 'open',
            url: 'https://example.test/repo/issues/108',
            labels: ['enhancement'],
            priority: null,
            updatedAt: '2026-05-02T08:00:00Z',
          },
          status: 'running',
          runId: 'run-108',
          attemptNumber: 1,
          nextRetryAt: null,
          lastError: null,
        },
      ],
      running: [],
      retryQueue: [],
    }

    expect(snapshot.queue[0].status).toBe('running')
  })
})
