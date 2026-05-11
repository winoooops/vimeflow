import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import type { Session } from '../../../sessions/types'
import { Header } from './Header'

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

const baseProps = {
  agent: AGENTS.claude,
  session,
  pipStatus: 'running' as const,
  branch: 'feat/jose-auth',
  added: 48,
  removed: 12,
  isFocused: true,
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
}

describe('Header', () => {
  test('renders agent chip with short name and glyph', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('CLAUDE')).toBeInTheDocument()
    expect(screen.getByText('∴')).toBeInTheDocument()
  })

  test('renders pane title from session.name', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('auth refactor')).toBeInTheDocument()
  })

  test('expanded header shows branch, added, and removed counts', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('feat/jose-auth')).toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
  })

  test('collapsed header hides branch, counts, and relative-time', () => {
    render(<Header {...baseProps} isCollapsed />)

    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
    expect(screen.queryByText('+48')).not.toBeInTheDocument()
    expect(screen.queryByText('−12')).not.toBeInTheDocument()
  })

  test('null branch omits the branch segment', () => {
    render(<Header {...baseProps} branch={null} />)

    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
  })

  test('collapse button fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()

    render(<Header {...baseProps} onToggleCollapse={onToggleCollapse} />)
    fireEvent.click(screen.getByRole('button', { name: /collapse status/i }))

    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  test('close button renders only when onClose is defined', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Header {...baseProps} />)

    expect(screen.queryByRole('button', { name: /close pane/i })).toBeNull()

    rerender(<Header {...baseProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close pane/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('focused state applies header gradient marker', () => {
    render(<Header {...baseProps} isFocused />)

    expect(screen.getByTestId('terminal-pane-header')).toHaveAttribute(
      'data-focused',
      'true'
    )
  })
})
