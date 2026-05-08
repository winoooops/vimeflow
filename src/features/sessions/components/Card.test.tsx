/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Reorder } from 'framer-motion'
import { Card, type CardProps } from './Card'
import type { Session } from '../../workspace/types'

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12345,
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:45:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
      usage: {
        sessionDuration: 0,
        turnCount: 0,
        messages: { sent: 0, limit: 200 },
        tokens: { input: 0, output: 0, total: 0 },
      },
    },
    ...overrides,
  }) as Session

const renderActiveCard = (
  s: Session,
  overrides: Partial<CardProps> = {}
): ReturnType<typeof render> =>
  render(
    <Reorder.Group axis="y" values={[s]} onReorder={vi.fn()}>
      <Card session={s} variant="active" onClick={vi.fn()} {...overrides} />
    </Reorder.Group>
  )

const renderRecentCard = (
  s: Session,
  overrides: Partial<CardProps> = {}
): ReturnType<typeof render> =>
  render(
    <ul>
      <Card session={s} variant="recent" onClick={vi.fn()} {...overrides} />
    </ul>
  )

describe('Card — active variant', () => {
  test('renders inside a Reorder.Item with data-testid="session-row"', () => {
    renderActiveCard(session())
    expect(screen.getByTestId('session-row')).toBeInTheDocument()
  })

  test('renders StatusDot reflecting session.status', () => {
    renderActiveCard(session({ status: 'running' }))
    // StatusDot exposes data-testid="status-dot" (verified at
    // src/features/workspace/components/StatusDot.tsx:40). Asserting
    // its presence guards against Card accidentally dropping the dot
    // — the previous draft of this test only checked session-row
    // existence, which would pass even if Card removed StatusDot
    // entirely.
    expect(screen.getByTestId('status-dot')).toBeInTheDocument()
  })

  test('renders state pill with bright tone class for the status', () => {
    renderActiveCard(session({ status: 'running' }))
    const pill = screen.getByTestId('state-pill')
    expect(pill).toHaveClass('text-success')
    expect(pill).toHaveClass('bg-success/10')
  })

  test('selection bar rendered iff isActive', () => {
    const { rerender } = renderActiveCard(session(), { isActive: true })
    const row = screen.getByTestId('session-row')
    expect(row.querySelector('.bg-primary-container')).not.toBeNull()

    rerender(
      <Reorder.Group axis="y" values={[session()]} onReorder={vi.fn()}>
        <Card session={session()} variant="active" onClick={vi.fn()} />
      </Reorder.Group>
    )

    expect(
      screen
        .queryByTestId('session-row')
        ?.querySelector('.bg-primary-container')
    ).toBeNull()
  })

  test('onClick fires when activation overlay button is clicked', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    await userEvent.click(screen.getByLabelText('auth middleware'))
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('onClick fires when title span is single-clicked (regression guard for pointer-events-auto interception)', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    // The title span carries aria-hidden so getByText still works.
    const title = screen.getByText('auth middleware')
    await userEvent.click(title)
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('renders subtitle below title (full row)', () => {
    renderActiveCard(session({ workingDirectory: '/a/b/projects/X' }))
    expect(screen.getByText('projects/X')).toBeInTheDocument()
  })

  test('renders line-delta only when added or removed > 0', () => {
    renderActiveCard(
      session({
        activity: {
          ...session().activity,
          fileChanges: [
            { path: 'a.ts', linesAdded: 5, linesRemoved: 2 },
          ] as Session['activity']['fileChanges'],
        },
      })
    )
    expect(screen.getByTestId('line-delta')).toBeInTheDocument()
  })

  test('rename: double-click title with onRename enters edit mode; Enter commits', async () => {
    const onRename = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onRename })
    const title = screen.getByText('auth middleware')
    await userEvent.dblClick(title)
    const input = screen.getByRole('textbox', { name: 'Rename session' })
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, 'new name{Enter}')
    expect(onRename).toHaveBeenCalledWith('X', 'new name')
  })

  test('rename: Escape cancels without calling onRename', async () => {
    const onRename = vi.fn()
    renderActiveCard(session(), { onRename })
    const title = screen.getByText('auth middleware')
    await userEvent.dblClick(title)
    const input = screen.getByRole('textbox', { name: 'Rename session' })
    await userEvent.type(input, 'x{Escape}')
    expect(onRename).not.toHaveBeenCalled()
  })

  test('edit/remove buttons hidden when callbacks are omitted', () => {
    renderActiveCard(session())
    expect(
      screen.queryByRole('button', { name: 'Rename session' })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'Remove session' })
    ).not.toBeInTheDocument()
  })

  test('onRemove fires when remove button is clicked', async () => {
    const onRemove = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onRemove })
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove session' })
    )
    expect(onRemove).toHaveBeenCalledWith('X')
  })
})

describe('Card — recent variant', () => {
  test('renders as <li> with data-testid="recent-session-row"', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(screen.getByTestId('recent-session-row').tagName).toBe('LI')
  })

  test('renders state pill with dim tone class', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(screen.getByTestId('state-pill')).toHaveClass(
      'text-success-muted/70'
    )
  })

  test('subtitle inline at right of state-pill row (ml-auto)', () => {
    renderRecentCard(session({ workingDirectory: '/a/projects/X' }))
    const subtitle = screen.getByText('projects/X')
    expect(subtitle).toHaveClass('ml-auto')
  })

  test('inactive title carries dim text class', () => {
    renderRecentCard(session({ status: 'completed' }), { isActive: false })
    const title = screen.getByText('auth middleware')
    expect(title).toHaveClass('text-on-surface-variant/60')
  })

  test('without onRemove, remove button is hidden', () => {
    renderRecentCard(session({ status: 'completed' }))
    expect(
      screen.queryByRole('button', { name: 'Remove session' })
    ).not.toBeInTheDocument()
  })
})
