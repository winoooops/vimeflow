import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Session } from '@/features/sessions/types'
import { SessionIslandIndicator } from '@/features/sessions/components/SessionIslandIndicator'

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  projectId: 'project-1',
  name: 'Session 1',
  open: true,
  status: 'running',
  workingDirectory: '/tmp/session-1',
  agentType: 'generic',
  layout: 'single',
  activityPanelCollapsed: false,
  panes: [
    {
      id: 'p0',
      ptyId: 'pty-1',
      cwd: '/tmp/session-1',
      agentType: 'generic',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-07-20T00:00:00Z',
  lastActivityAt: '2026-07-20T00:00:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 1, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 1 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
  ...overrides,
})

describe('SessionIslandIndicator', () => {
  test('delegates selection and exposes the session name through a tooltip', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SessionIslandIndicator
        session={session()}
        index={0}
        activeIndex={0}
        active
        displayMode="dots"
        onSelect={onSelect}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Switch to session 1: Session 1',
    })

    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Session 1')

    await user.click(button)
    expect(onSelect).toHaveBeenCalledWith('session-1')
  })

  test('renders number and active-label display modes', () => {
    const namedSession = session({
      name: 'A very long session name that must be truncated in the island',
    })

    const { rerender } = render(
      <SessionIslandIndicator
        session={namedSession}
        index={2}
        activeIndex={2}
        active
        displayMode="numbers"
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button')).toHaveTextContent('3')

    rerender(
      <SessionIslandIndicator
        session={namedSession}
        index={2}
        activeIndex={2}
        active
        displayMode="labels"
        onSelect={vi.fn()}
      />
    )

    const active = screen.getByRole('button')
    expect(active).toHaveTextContent(namedSession.name)
    expect(active).toHaveStyle({ width: '160px' })
    expect(within(active).getByText(namedSession.name)).toHaveClass('truncate')
  })

  test('uses positional semantic colors around the active indicator', () => {
    const inactive = false

    const { rerender } = render(
      <SessionIslandIndicator
        session={session()}
        index={1}
        activeIndex={2}
        active={inactive}
        displayMode="dots"
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button')).toHaveClass('bg-secondary')

    rerender(
      <SessionIslandIndicator
        session={session()}
        index={2}
        activeIndex={2}
        active
        displayMode="dots"
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button')).toHaveClass('bg-primary', 'w-[48px]')

    rerender(
      <SessionIslandIndicator
        session={session()}
        index={3}
        activeIndex={2}
        active={inactive}
        displayMode="dots"
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button')).toHaveClass('bg-secondary/55')
  })
})
