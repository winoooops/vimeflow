import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { UseGitBranchReturn } from '../../../diff/hooks/useGitBranch'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import type { Session } from '../../../sessions/types'
import { TerminalPane } from './index'

vi.mock('./Body', async () => {
  const React = await import('react')

  const Body = React.forwardRef<
    { focusTerminal: () => void },
    { deferFit: boolean }
  >(function MockBody({ deferFit }, ref): React.ReactElement {
    React.useImperativeHandle(ref, () => ({
      focusTerminal: vi.fn(),
    }))

    return React.createElement('div', {
      'data-testid': 'body-mock',
      'data-defer-fit': deferFit ? 'true' : 'false',
    })
  })

  return {
    Body,
    terminalCache: new Map(),
    clearTerminalCache: vi.fn(),
    disposeTerminalSession: vi.fn(),
  }
})

vi.mock('../../../diff/hooks/useGitBranch', () => ({
  useGitBranch: (): UseGitBranchReturn => ({
    branch: 'main',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

vi.mock('../../../diff/hooks/useGitStatus', () => ({
  useGitStatus: (): UseGitStatusReturn => ({
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 10,
        deletions: 3,
        staged: false,
      },
    ],
    filesCwd: '/home/user/repo',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/home/user/repo',
  agentType: 'claude-code',
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

const baseProps = {
  sessionId: 's1',
  cwd: '/home/user/repo',
  service: {} as never,
  session,
  isActive: true,
}

describe('TerminalPane index', () => {
  test('renders Body when mode is spawn', () => {
    render(<TerminalPane {...baseProps} mode="spawn" />)

    expect(screen.getByTestId('body-mock')).toBeInTheDocument()
    expect(screen.queryByText('Session exited.')).not.toBeInTheDocument()
  })

  test('renders Body when mode is attach', () => {
    render(<TerminalPane {...baseProps} mode="attach" />)

    expect(screen.getByTestId('body-mock')).toBeInTheDocument()
  })

  test('forwards deferred fit state to Body', () => {
    render(<TerminalPane {...baseProps} deferFit />)

    expect(screen.getByTestId('body-mock')).toHaveAttribute(
      'data-defer-fit',
      'true'
    )
  })

  test('renders RestartAffordance when mode is awaiting-restart', () => {
    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={{ ...session, status: 'completed' }}
      />
    )

    expect(screen.queryByTestId('body-mock')).not.toBeInTheDocument()
    expect(screen.getByText('Session exited.')).toBeInTheDocument()
  })

  test('Header shows agent chip resolved from session.agentType', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByText('CLAUDE')).toBeInTheDocument()
  })

  test('chrome reflects session.agentType directly (no override prop)', () => {
    // The activeAgentType prop chain was retired; chrome reads
    // agentForSession(session) so detection writes flow through
    // Session.agentType (single source of truth).
    render(
      <TerminalPane
        {...baseProps}
        session={{ ...session, agentType: 'codex' }}
      />
    )

    expect(screen.getByText('CODEX')).toBeInTheDocument()
    expect(screen.getByText(/click to focus codex/i)).toBeInTheDocument()
  })

  test('generic sessions render shell footer copy', () => {
    render(
      <TerminalPane
        {...baseProps}
        session={{ ...session, agentType: 'generic' }}
      />
    )

    expect(screen.getByText('SHELL')).toBeInTheDocument()
    expect(screen.getByText(/click to focus shell/i)).toBeInTheDocument()
  })

  test('Header shows line changes from git status files', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
  })

  test('clicking the container flips focused state', () => {
    render(<TerminalPane {...baseProps} />)

    const wrapper = screen.getByTestId('terminal-pane-wrapper')
    fireEvent.click(wrapper)

    expect(wrapper).toHaveAttribute('data-focused', 'true')
  })

  test('renders focus ring overlay above scrollable terminal body', () => {
    render(<TerminalPane {...baseProps} />)

    const focusRing = screen.getByTestId('terminal-pane-focus-ring')

    expect(focusRing).toHaveClass('absolute')
    expect(focusRing).toHaveClass('z-30')
    expect(focusRing).toHaveClass('pointer-events-none')
  })

  test('Footer placeholder uses awaiting-restart override', () => {
    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={{ ...session, status: 'completed' }}
      />
    )

    expect(
      screen.getByText(/session ended — restart to resume claude/i)
    ).toBeInTheDocument()
  })
})
