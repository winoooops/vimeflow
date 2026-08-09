import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotificationRecord } from '../hooks/useNotificationCenter'
import type { Pane, Session } from '../types'
import { AgentRows } from './AgentRows'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'p0',
  ptyId: 'pty-0',
  cwd: '/tmp/project',
  agentType: 'kimi',
  status: 'running',
  agentPhase: 'running',
  active: true,
  ...overrides,
})

const session = (panes: Pane[]): Session =>
  ({
    id: 'sess-1',
    name: 'vimeflow',
    panes,
  }) as Session

const record = (
  overrides: Partial<NotificationRecord> = {}
): NotificationRecord => ({
  id: 'n1',
  sessionId: 'sess-1',
  ptyId: 'pty-0',
  reason: 'turn-complete',
  title: 'Kimi finished',
  occurredAt: 1_000,
  read: false,
  ...overrides,
})

describe('AgentRows', () => {
  test('renders one row per coding-agent pane with the state in the accessible name', () => {
    render(
      <AgentRows
        session={session([
          pane({ id: 'p0', agentType: 'kimi' }),
          pane({ id: 'p1', ptyId: 'pty-1', agentType: 'generic' }),
          pane({
            id: 'p2',
            ptyId: 'pty-2',
            agentType: 'codex',
            status: 'awaiting',
          }),
        ])}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(
      screen.getByRole('list', { name: 'Agents in vimeflow' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /kimi.*running.*working on project/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /codex.*needs you/i })
    ).toBeInTheDocument()
  })

  test('renders nothing when the session has no coding-agent panes', () => {
    const { container } = render(
      <AgentRows
        session={session([pane({ agentType: 'generic' })])}
        onFocusPane={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('row click reports the session and pane ids', async () => {
    const onFocusPane = vi.fn()

    render(
      <AgentRows
        session={session([pane({ id: 'p3', ptyId: 'pty-3' })])}
        onFocusPane={onFocusPane}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /kimi/i }))

    expect(onFocusPane).toHaveBeenCalledWith('sess-1', 'p3')
  })

  test('message precedence: record body, then title, then pane label', () => {
    render(
      <AgentRows
        session={session([
          pane({ id: 'p0', ptyId: 'pty-0' }),
          pane({ id: 'p1', ptyId: 'pty-1' }),
          pane({ id: 'p2', ptyId: 'pty-2', userLabel: 'watcher pane' }),
        ])}
        records={[
          record({ id: 'n1', ptyId: 'pty-0', body: 'wrote 3 files' }),
          record({ id: 'n2', ptyId: 'pty-1', body: undefined }),
        ]}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getByText('wrote 3 files')).toBeInTheDocument()
    expect(screen.getByText('Kimi finished')).toBeInTheDocument()
    expect(screen.getByText('watcher pane')).toBeInTheDocument()
  })

  test('idle pane with active OSC progress renders as running (Decision 9 union)', async () => {
    render(
      <AgentRows
        session={session([pane({ status: 'idle' })])}
        service={{
          getProgress: () => ({ state: 'indeterminate', value: null }),
          onProgress: (): Promise<() => void> =>
            Promise.resolve(() => undefined),
        }}
        onFocusPane={vi.fn()}
      />
    )

    expect(
      await screen.findByRole('button', { name: /kimi.*running/i })
    ).toBeInTheDocument()
  })

  test('restored pane with running status but no agent phase renders idle', () => {
    render(
      <AgentRows
        session={session([pane({ agentPhase: undefined })])}
        onFocusPane={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /kimi.*idle/i })
    ).toBeInTheDocument()
  })

  test('idle pane without a progress source stays idle', () => {
    render(
      <AgentRows
        session={session([pane({ status: 'idle' })])}
        onFocusPane={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /kimi.*idle/i })
    ).toBeInTheDocument()
  })

  test('completed chip shows the done glyph, running chip spins with motion-reduce escape', () => {
    render(
      <AgentRows
        session={session([
          pane({ id: 'p0', ptyId: 'pty-0', status: 'completed' }),
          pane({ id: 'p1', ptyId: 'pty-1', status: 'running' }),
        ])}
        onFocusPane={vi.fn()}
      />
    )

    expect(screen.getByText('✓')).toBeInTheDocument()

    const runningRow = screen.getByRole('button', { name: /kimi.*running/i })
    // eslint-disable-next-line testing-library/no-node-access -- verifying the aria-hidden chip wrapper
    const chip = runningRow.querySelector('[aria-hidden="true"]')

    expect(chip).toBeInTheDocument()

    // eslint-disable-next-line testing-library/no-node-access -- verifying spinner styling classes
    const ring = runningRow.querySelector('.animate-spin')

    expect(ring).toBeInTheDocument()
    expect(ring?.className).toContain('motion-reduce:animate-none')
  })
})
