import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Session } from '../../../sessions/types'
import { HeaderMetadata } from './HeaderMetadata'

const fixedNow = new Date('2026-05-08T12:00:00Z')

const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/home/user/repo',
  agentType: 'claude-code',
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: 's1',
      cwd: '/home/user/repo',
      agentType: 'claude-code',
      status: 'running',
      active: true,
    },
  ],
  createdAt: '2026-05-08T10:00:00Z',
  lastActivityAt: '2026-05-08T11:55:00Z',
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
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(fixedNow)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HeaderMetadata', () => {
  test('renders branch, added count, removed count, and relative time', () => {
    render(
      <HeaderMetadata
        branch="feat/jose-auth"
        added={48}
        removed={12}
        session={session}
      />
    )

    expect(screen.getByText('feat/jose-auth')).toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  test('omits branch segment when branch is null', () => {
    render(
      <HeaderMetadata branch={null} added={48} removed={12} session={session} />
    )

    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  test('omits delta segment and leading separator when deltas are zero', () => {
    const { container } = render(
      <HeaderMetadata branch={null} added={0} removed={0} session={session} />
    )

    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
    expect(container).not.toHaveTextContent('·')
  })
})
