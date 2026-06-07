/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Reorder } from 'framer-motion'
import { Card, type CardProps } from './Card'
import type { Session } from '../types'

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    layout: 'single',
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

  test('row is a role=button named after the session', () => {
    renderActiveCard(session())
    const row = screen.getByRole('button', { name: 'auth middleware' })
    expect(row).toBe(screen.getByTestId('session-row'))
    expect(row).toHaveAttribute('id', 'sidebar-activate-sess-1')
  })

  test('drops the old chrome: no status dot, state pill, line delta, or accent bar', () => {
    renderActiveCard(session({ status: 'running' }), { isActive: true })
    expect(screen.queryByTestId('status-dot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('state-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('line-delta')).not.toBeInTheDocument()
    const row = screen.getByTestId('session-row')
    expect(row.querySelector('.bg-primary-container')).toBeNull()
  })

  test('renders status as plain colored text', () => {
    renderActiveCard(session({ status: 'running' }))
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  test('renders subtitle (row 2)', () => {
    renderActiveCard(session({ workingDirectory: '/a/b/projects/X' }))
    expect(screen.getByText('projects/X')).toBeInTheDocument()
  })

  test('multi-pane session shows the pane-layout glyph; single-pane does not', () => {
    const { rerender } = renderActiveCard(session({ layout: 'vsplit' }))
    expect(screen.getByTestId('session-layout-glyph')).toBeInTheDocument()

    rerender(
      <Reorder.Group axis="y" values={[session()]} onReorder={vi.fn()}>
        <Card
          session={session({ layout: 'single' })}
          variant="active"
          onClick={vi.fn()}
        />
      </Reorder.Group>
    )
    expect(screen.queryByTestId('session-layout-glyph')).not.toBeInTheDocument()
  })

  test('hides the layout glyph for an unknown/stale layout id', () => {
    renderActiveCard(
      session({ layout: 'legacy-grid' as unknown as Session['layout'] })
    )

    expect(screen.queryByTestId('session-layout-glyph')).not.toBeInTheDocument()
  })

  test('clicking the row calls onClick with the session id', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    await userEvent.click(
      screen.getByRole('button', { name: 'auth middleware' })
    )
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('Enter on the focused row activates it', async () => {
    const onClick = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onClick })
    screen.getByRole('button', { name: 'auth middleware' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledWith('X')
  })

  test('kebab opens a Rename/Remove menu', async () => {
    const user = userEvent.setup()
    renderActiveCard(session(), { onRename: vi.fn(), onRemove: vi.fn() })

    await user.click(screen.getByRole('button', { name: 'Session actions' }))

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  test('kebab Remove calls onRemove with the session id', async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()
    renderActiveCard(session({ id: 'X' }), { onRemove })

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onRemove).toHaveBeenCalledWith('X')
  })

  test('kebab Rename enters inline edit; Enter commits via onRename', async () => {
    const onRename = vi.fn()
    const user = userEvent.setup()
    renderActiveCard(session({ id: 'X' }), { onRename })

    await user.click(screen.getByRole('button', { name: 'Session actions' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: 'Rename session' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'new name{Enter}')
    expect(onRename).toHaveBeenCalledWith('X', 'new name')
  })

  test('double-click title also enters edit mode', async () => {
    const onRename = vi.fn()
    renderActiveCard(session({ id: 'X' }), { onRename })
    await userEvent.dblClick(screen.getByText('auth middleware'))
    expect(
      screen.getByRole('textbox', { name: 'Rename session' })
    ).toHaveFocus()
  })

  test('Escape cancels rename without calling onRename', async () => {
    const onRename = vi.fn()
    renderActiveCard(session(), { onRename })
    await userEvent.dblClick(screen.getByText('auth middleware'))
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Rename session' }),
      'x{Escape}'
    )
    expect(onRename).not.toHaveBeenCalled()
  })

  test('no kebab when neither onRename nor onRemove is supplied', () => {
    renderActiveCard(session())
    expect(
      screen.queryByRole('button', { name: 'Session actions' })
    ).not.toBeInTheDocument()
  })
})

describe('Card — recent variant', () => {
  test('renders as <li> with data-testid="recent-session-row" and role=button', () => {
    renderRecentCard(session({ status: 'completed' }))
    const row = screen.getByTestId('recent-session-row')
    expect(row.tagName).toBe('LI')
    expect(row).toHaveAttribute('role', 'button')
  })

  test('renders status text and subtitle', () => {
    renderRecentCard(
      session({ status: 'completed', workingDirectory: '/a/projects/X' })
    )
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('projects/X')).toBeInTheDocument()
  })

  test('multi-pane recent session shows the layout glyph', () => {
    renderRecentCard(session({ status: 'completed', layout: 'quad' }))
    expect(screen.getByTestId('session-layout-glyph')).toBeInTheDocument()
  })
})
