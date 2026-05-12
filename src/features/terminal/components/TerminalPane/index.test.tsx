import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UseGitBranchReturn } from '../../../diff/hooks/useGitBranch'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import type { Session } from '../../../sessions/types'
import type { BodyHandle, BodyProps } from './Body'
import { TerminalPane } from './index'

const bodyPropsSpy = vi.hoisted(() => vi.fn())
const focusTerminalSpy = vi.hoisted(() => vi.fn())

vi.mock('./Body', async () => {
  const React = await import('react')

  const Body = React.forwardRef<BodyHandle, BodyProps>(
    function MockBody(props, ref): React.ReactElement {
      bodyPropsSpy(props)
      React.useImperativeHandle(ref, () => ({
        focusTerminal: focusTerminalSpy,
      }))

      return React.createElement('div', {
        'data-testid': 'body-mock',
        'data-defer-fit': props.deferFit ? 'true' : 'false',
      })
    }
  )

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
  layout: 'single',
  panes: [
    {
      id: 'p0',
      ptyId: 'pty-s1',
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

const baseProps = {
  service: {} as never,
  session,
  pane: session.panes[0],
  isActive: true,
}

describe('TerminalPane index', () => {
  beforeEach(() => {
    bodyPropsSpy.mockClear()
    focusTerminalSpy.mockClear()
  })

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
    const completedSession: Session = {
      ...session,
      status: 'completed',
      panes: [{ ...session.panes[0], status: 'completed' }],
    }

    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={completedSession}
        pane={completedSession.panes[0]}
      />
    )

    expect(screen.queryByTestId('body-mock')).not.toBeInTheDocument()
    expect(screen.getByText('Session exited.')).toBeInTheDocument()
  })

  test('Header shows agent chip resolved from pane.agentType', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByText('CLAUDE')).toBeInTheDocument()
  })

  test('chrome reflects pane.agentType directly (no override prop)', () => {
    render(
      <TerminalPane
        {...baseProps}
        session={{ ...session, agentType: 'generic' }}
        pane={{ ...baseProps.pane, agentType: 'codex', active: false }}
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
        pane={{ ...baseProps.pane, agentType: 'generic', active: false }}
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

  test('forwards pane.ptyId to Body as sessionId', () => {
    render(<TerminalPane {...baseProps} />)

    expect(bodyPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'pty-s1' })
    )
  })

  test('data-focused mirrors pane.active=true', () => {
    render(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(screen.getByTestId('terminal-pane-wrapper')).toHaveAttribute(
      'data-focused',
      'true'
    )
  })

  test('data-focused absent when pane.active=false', () => {
    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    expect(screen.getByTestId('terminal-pane-wrapper')).not.toHaveAttribute(
      'data-focused'
    )
  })

  test('renders focus ring overlay above scrollable terminal body', () => {
    render(<TerminalPane {...baseProps} />)

    const focusRing = screen.getByTestId('terminal-pane-focus-ring')

    expect(focusRing).toHaveClass('absolute')
    expect(focusRing).toHaveClass('z-30')
    expect(focusRing).toHaveClass('pointer-events-none')
  })

  test('Footer placeholder uses awaiting-restart override', () => {
    const completedSession: Session = {
      ...session,
      status: 'completed',
      panes: [{ ...session.panes[0], status: 'completed' }],
    }

    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={completedSession}
        pane={completedSession.panes[0]}
      />
    )

    expect(
      screen.getByText(/session ended — restart to resume claude/i)
    ).toBeInTheDocument()
  })

  test('inactive pane renders dimmed', () => {
    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    expect(screen.getByTestId('terminal-pane-wrapper')).toHaveStyle({
      opacity: '0.78',
    })
  })

  test('active pane renders at full opacity', () => {
    render(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(screen.getByTestId('terminal-pane-wrapper')).toHaveStyle({
      opacity: '1',
    })
  })

  test('does not focus on initial mount with pane.active=true', () => {
    render(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(focusTerminalSpy).not.toHaveBeenCalled()
  })

  test('focuses when pane.active flips false to true', () => {
    const { rerender } = render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )
    expect(focusTerminalSpy).not.toHaveBeenCalled()

    rerender(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(focusTerminalSpy).toHaveBeenCalledOnce()
  })

  test('does not re-focus when pane.active stays true across renders', () => {
    const { rerender } = render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    rerender(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    rerender(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(focusTerminalSpy).toHaveBeenCalledOnce()
  })

  test('focuses on second rising edge after going false again', () => {
    const { rerender } = render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    rerender(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    rerender(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    rerender(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(focusTerminalSpy).toHaveBeenCalledTimes(2)
  })
})
