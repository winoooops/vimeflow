import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UseGitBranchReturn } from '../../../diff/hooks/useGitBranch'
import type { UseGitStatusReturn } from '../../../diff/hooks/useGitStatus'
import type { Session } from '../../../sessions/types'
import type { BodyHandle, BodyProps } from './Body'
import { TerminalPane, type TerminalPaneHandle } from './index'
import { usePaneWidth } from './usePaneWidth'

vi.mock('./usePaneWidth', () => ({ usePaneWidth: vi.fn(() => null) }))

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
  activityPanelCollapsed: false,
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
    vi.mocked(usePaneWidth).mockReturnValue(null)
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

  test('forwards submitted terminal command callback to Body', () => {
    const onCommandSubmit = vi.fn()

    render(<TerminalPane {...baseProps} onCommandSubmit={onCommandSubmit} />)

    expect(bodyPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ onCommandSubmit })
    )
  })

  test('the burner button activates its pane (spec §8) then toggles its burner', async () => {
    const onBurner = vi.fn()
    const onRequestActive = vi.fn()
    const user = userEvent.setup()

    render(
      <TerminalPane
        {...baseProps}
        onBurner={onBurner}
        onRequestActive={onRequestActive}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /open burner terminal/i })
    )

    // Focuses THIS pane (so the active-pane state tracks the popup), then
    // toggles its own pane's burner with its identity + live cwd.
    expect(onRequestActive).toHaveBeenCalledWith('s1', 'p0')
    expect(onBurner).toHaveBeenCalledWith({
      sessionId: 's1',
      paneId: 'p0',
      cwd: '/home/user/repo',
    })
  })

  test('clicking an inactive terminal body requests pane activation', async () => {
    const onRequestActive = vi.fn()
    const user = userEvent.setup()

    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
        onRequestActive={onRequestActive}
      />
    )

    await user.click(screen.getByTestId('body-mock'))

    expect(onRequestActive).toHaveBeenCalledOnce()
    expect(onRequestActive).toHaveBeenCalledWith('s1', 'p0')
  })

  test('clicking an inactive terminal header requests pane activation', async () => {
    const onRequestActive = vi.fn()
    const user = userEvent.setup()

    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
        onRequestActive={onRequestActive}
      />
    )

    await user.click(screen.getByTestId('terminal-pane-header'))

    expect(onRequestActive).toHaveBeenCalledOnce()
    expect(onRequestActive).toHaveBeenCalledWith('s1', 'p0')
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
    expect(
      screen.queryByTestId('terminal-pane-status-bar')
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /collapse status|expand status/i })
    ).toBeNull()
  })

  test('Header shows agent chip resolved from pane.agentType', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByTestId('agent-glyph-label')).toHaveTextContent('CLAUDE')
    expect(screen.getByTestId('agent-glyph-label')).toHaveClass('hidden')
  })

  test('chrome reflects pane.agentType directly (no override prop)', () => {
    render(
      <TerminalPane
        {...baseProps}
        session={{ ...session, agentType: 'generic' }}
        pane={{ ...baseProps.pane, agentType: 'codex', active: false }}
      />
    )

    expect(screen.getByTestId('agent-glyph-label')).toHaveTextContent('CODEX')
  })

  test('generic sessions render the SHELL agent chip', () => {
    render(
      <TerminalPane
        {...baseProps}
        session={{ ...session, agentType: 'generic' }}
        pane={{ ...baseProps.pane, agentType: 'generic', active: false }}
      />
    )

    expect(screen.getByTestId('agent-glyph-label')).toHaveTextContent('SHELL')
  })

  test('status bar shows line changes from git status files', () => {
    render(<TerminalPane {...baseProps} />)

    const statusBar = screen.getByTestId('terminal-pane-status-bar')

    expect(statusBar).toHaveTextContent('+10')
    expect(statusBar).toHaveTextContent('−3')
  })

  test('the pane wrapper is a size container for responsive chrome', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-wrapper')).toHaveClass(
      '@container/pane'
    )
  })

  test('collapsing the pane hides the status bar', async () => {
    const user = userEvent.setup()
    render(<TerminalPane {...baseProps} />)

    const header = screen.getByTestId('terminal-pane-header')
    expect(header).toHaveClass('gap-1.5')
    expect(header).toHaveClass('px-2')
    expect(header).toHaveClass('py-1')
    expect(screen.getByTestId('terminal-pane-status-bar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /collapse status/i }))

    expect(
      screen.queryByTestId('terminal-pane-status-bar')
    ).not.toBeInTheDocument()
    expect(header).toHaveClass('gap-1.5')
    expect(header).toHaveClass('px-2')
    expect(header).toHaveClass('py-1')
  })

  test('auto-collapses the status bar when the pane is narrower than the floor', () => {
    vi.mocked(usePaneWidth).mockReturnValue(180)

    render(<TerminalPane {...baseProps} />)

    expect(
      screen.queryByTestId('terminal-pane-status-bar')
    ).not.toBeInTheDocument()

    expect(screen.getByTestId('terminal-pane-header')).toHaveClass('gap-1.5')

    // The collapse toggle is hidden too — it can't expand a too-narrow pane.
    expect(
      screen.queryByRole('button', { name: /collapse status|expand status/i })
    ).toBeNull()
  })

  test('stays expanded when the pane is wide and not manually collapsed', () => {
    vi.mocked(usePaneWidth).mockReturnValue(600)

    render(<TerminalPane {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-status-bar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane-header')).toHaveClass('gap-1.5')
  })

  test('forwards pane.ptyId to Body as sessionId', () => {
    render(<TerminalPane {...baseProps} />)

    expect(bodyPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'pty-s1' })
    )
  })

  test('clicking close calls onClose with session id and pane id', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<TerminalPane {...baseProps} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'close pane' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith('s1', 'p0')
  })

  test('active pane keeps semantic active marker without focus marker', () => {
    render(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    const wrapper = screen.getByTestId('terminal-pane-wrapper')
    expect(wrapper).toHaveAttribute('data-pane-active', 'true')
    expect(wrapper).not.toHaveAttribute('data-focused')
  })

  test('inactive pane has no active marker or focus marker', () => {
    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    const wrapper = screen.getByTestId('terminal-pane-wrapper')
    expect(wrapper).not.toHaveAttribute('data-pane-active')
    expect(wrapper).not.toHaveAttribute('data-focused')
  })

  test('renders neutral border overlay above scrollable terminal body', () => {
    render(<TerminalPane {...baseProps} />)

    const wrapper = screen.getByTestId('terminal-pane-wrapper')
    const border = screen.getByTestId('terminal-pane-border')

    expect(wrapper).toHaveClass('isolate')
    expect(border).toHaveClass('absolute')
    expect(border).toHaveClass('z-30')
    expect(border).toHaveClass('pointer-events-none')
    expect(border).toHaveClass('border-outline-variant/[0.22]')
  })

  test('does not render a message-input footer banner', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.queryByTestId('terminal-pane-footer')).not.toBeInTheDocument()
    expect(screen.queryByText(/message claude/i)).not.toBeInTheDocument()
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

  test('active pane uses the neutral border while staying full opacity', () => {
    render(<TerminalPane {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-wrapper')).not.toHaveAttribute(
      'data-focused'
    )

    expect(screen.getByTestId('terminal-pane-wrapper')).toHaveStyle({
      opacity: '1',
    })

    expect(screen.getByTestId('terminal-pane-border')).toHaveClass(
      'border-outline-variant/[0.22]'
    )
  })

  test('focuses on initial mount when pane.active=true', () => {
    // A freshly-created pane (createSession, addPane, restored active pane on
    // app launch) mounts already active and never transitions false→true. The
    // rising-edge effect must therefore treat the first run as a focus event,
    // otherwise the active terminal stays unfocused until the user clicks it.
    render(
      <TerminalPane {...baseProps} pane={{ ...baseProps.pane, active: true }} />
    )

    expect(focusTerminalSpy).toHaveBeenCalledOnce()
  })

  test('does not focus on initial mount when pane.active=false', () => {
    render(
      <TerminalPane
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
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

  test('ref handle focuses terminal body when ready', () => {
    const ref = createRef<TerminalPaneHandle>()

    // Render inactive so the mount-time auto-focus path does not fire — this
    // test isolates the imperative ref handle from the rising-edge effect.
    render(
      <TerminalPane
        ref={ref}
        {...baseProps}
        pane={{ ...baseProps.pane, active: false }}
      />
    )

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusTerminal()).toBe(true)
    expect(focusTerminalSpy).toHaveBeenCalledOnce()
  })

  test('ref handle returns false when terminal body is not mounted', () => {
    const ref = createRef<TerminalPaneHandle>()

    const completedSession: Session = {
      ...session,
      status: 'completed',
      panes: [{ ...session.panes[0], status: 'completed' }],
    }

    render(
      <TerminalPane
        ref={ref}
        {...baseProps}
        mode="awaiting-restart"
        session={completedSession}
        pane={completedSession.panes[0]}
      />
    )

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusTerminal()).toBe(false)
  })
})
