// cspell:ignore worktree
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Session } from '../../../sessions/types'
import { PaneStatusBar } from './PaneStatusBar'

const fixedNow = new Date('2026-05-08T12:00:00Z')

const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/home/user/repo',
  agentType: 'claude-code',
  layout: 'single',
  activityPanelCollapsed: false,
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

describe('PaneStatusBar', () => {
  test('renders branch, added count, removed count, and relative time', () => {
    render(
      <PaneStatusBar
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

  test('omits the git ref chip when branch is null but keeps deltas and time', () => {
    render(
      <PaneStatusBar
        worktreeName={null}
        branch={null}
        added={48}
        removed={12}
        session={session}
      />
    )

    expect(screen.queryByTestId('git-ref-chip')).not.toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  test('omits the delta segment when deltas are zero', () => {
    render(
      <PaneStatusBar
        worktreeName={null}
        branch="main"
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.queryByText('+0')).not.toBeInTheDocument()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  test('renders the worktree chip before the branch chip', () => {
    const { container } = render(
      <PaneStatusBar
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

    const text = container.textContent ?? ''
    expect(text.indexOf('agent-sidebar')).toBeLessThan(
      text.indexOf('fix/agent-sidebar')
    )
  })

  test('always exposes the status-bar test id', () => {
    render(
      <PaneStatusBar
        worktreeName={null}
        branch={null}
        added={0}
        removed={0}
        session={session}
      />
    )

    expect(screen.getByTestId('terminal-pane-status-bar')).toBeInTheDocument()
  })

  test('clips the git ref while keeping the deltas and time pinned', () => {
    render(
      <PaneStatusBar
        worktreeName="a-long-worktree-name"
        branch="feat/a-very-long-branch-that-would-otherwise-collide"
        added={89}
        removed={493}
        session={session}
      />
    )

    expect(screen.getByTestId('terminal-pane-status-bar-ref')).toHaveClass(
      'min-w-0',
      'flex-1',
      'overflow-hidden'
    )

    expect(screen.getByTestId('terminal-pane-status-bar-meta')).toHaveClass(
      'shrink-0'
    )
    expect(screen.getByText('+89')).toBeInTheDocument()
    expect(screen.getByText('−493')).toBeInTheDocument()
  })

  test('sheds metadata in steps as the bar narrows (container queries)', () => {
    render(
      <PaneStatusBar
        worktreeName="agent-sidebar"
        branch="main"
        added={89}
        removed={493}
        session={session}
      />
    )

    expect(screen.getByTestId('terminal-pane-status-bar')).toHaveClass(
      '[container-type:inline-size]'
    )

    // Step 1 (<512px): LOC deltas drop.
    expect(screen.getByTestId('terminal-pane-status-bar-loc')).toHaveClass(
      '@max-[512px]:hidden'
    )
    // Step 2 (<384px): last-activity time drops.
    expect(screen.getByText('5m ago')).toHaveClass('@max-[384px]:hidden')
    // Step 3 (<280px): git card collapses to branch-only.
    expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveClass(
      '@max-[280px]:hidden'
    )

    // The bar must NOT self-hide on pane width — its visibility is coupled to
    // the pane's collapsed state by the parent (index.tsx gates on !isCollapsed),
    // so a narrow-but-expanded pane keeps its (shrunken) status bar.
    expect(screen.getByTestId('terminal-pane-status-bar')).not.toHaveClass(
      '@max-[220px]/pane:hidden'
    )
  })
})
