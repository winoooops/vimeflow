// cspell:ignore worktree
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
      activityPanelCollapsed: null,
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
        worktreeName={null}
        branch="feat/jose-auth"
        added={48}
        removed={12}
        session={session}
      />
    )

    expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent(
      'feat/jose-auth'
    )
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
    expect(
      screen.queryByTestId('git-ref-chip-wt-label')
    ).not.toBeInTheDocument()
  })

  test('omits branch segment when branch is null', () => {
    render(
      <HeaderMetadata
        worktreeName={null}
        branch={null}
        added={48}
        removed={12}
        session={session}
      />
    )

    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  test('omits delta segment and leading separator when deltas are zero', () => {
    const { container } = render(
      <HeaderMetadata
        worktreeName={null}
        branch={null}
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
    expect(container).not.toHaveTextContent('·')
  })

  test('renders worktree chip with basename before the branch chip', () => {
    const { container } = render(
      <HeaderMetadata
        worktreeName="agent-sidebar"
        branch="fix/agent-sidebar"
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent(
      'agent-sidebar'
    )

    expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent(
      'fix/agent-sidebar'
    )

    // Visual order: chip text must appear before the branch label in the
    // rendered output. Comparing textContent positions avoids reaching into
    // sibling DOM nodes directly (testing-library/no-node-access).
    const text = container.textContent ?? ''
    const chipIndex = text.indexOf('agent-sidebar')
    const branchIndex = text.indexOf('fix/agent-sidebar')
    expect(chipIndex).toBeGreaterThan(-1)
    expect(branchIndex).toBeGreaterThan(-1)
    expect(chipIndex).toBeLessThan(branchIndex)
  })

  test('hides worktree chip when worktreeName is null', () => {
    render(
      <HeaderMetadata
        worktreeName={null}
        branch="main"
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(
      screen.queryByTestId('git-ref-chip-wt-label')
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('git-ref-chip-br-label')).toHaveTextContent(
      'main'
    )
  })

  test('suppresses chip + leading dot when worktreeName is set but branch is null', () => {
    render(
      <HeaderMetadata
        worktreeName="feat-jose"
        branch={null}
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.queryByTestId('git-ref-chip')).toBeNull()
    // The relative-time label still renders (last span in the JSX).
    expect(screen.getByText(/ago|now|just/i)).toBeInTheDocument()
    // No leading middle-dot because hasLeadingMetadata is false.
    expect(screen.queryByText('·')).toBeNull()
  })

  test('treats branch="" the same as branch=null (chip + leading dot suppressed)', () => {
    render(
      <HeaderMetadata
        worktreeName="feat-jose"
        branch=""
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.queryByTestId('git-ref-chip')).toBeNull()
    expect(screen.queryByText('·')).toBeNull()
  })
})
