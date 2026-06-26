// cspell:ignore worktree
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

const baseProps = {
  agent: AGENTS.claude,
  session,
  worktreeName: null,
  branch: 'feat/jose-auth',
  added: 48,
  removed: 12,
  isFocused: true,
  isCollapsed: false,
  ptyId: 's1',
  onToggleCollapse: vi.fn(),
}

describe('Header', () => {
  test('renders agent chip with short name and glyph', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('CLAUDE')).toBeInTheDocument()

    const glyphChip = screen.getByTestId('agent-glyph-chip')
    // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
    const brandMark = glyphChip.querySelector('svg')

    expect(brandMark).toBeInTheDocument()
  })

  test('renders pane title from session.name', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('auth refactor')).toBeInTheDocument()
  })

  test('renders paneAgentTitle when provided', () => {
    render(<Header {...baseProps} paneAgentTitle="My Agent Title" />)

    expect(screen.getByTestId('terminal-pane-header')).toHaveTextContent(
      'My Agent Title'
    )

    expect(screen.getByTestId('terminal-pane-header')).not.toHaveTextContent(
      baseProps.session.name
    )
  })

  test('falls back to session.name when paneAgentTitle is undefined', () => {
    render(<Header {...baseProps} paneAgentTitle={undefined} />)

    expect(screen.getByTestId('terminal-pane-header')).toHaveTextContent(
      baseProps.session.name
    )
  })

  test('paneUserLabel takes precedence over paneAgentTitle and session.name', () => {
    render(
      <Header
        {...baseProps}
        paneAgentTitle="agent-title"
        paneUserLabel="my-label"
      />
    )

    expect(screen.getByTestId('terminal-pane-header')).toHaveTextContent(
      'my-label'
    )

    expect(screen.getByTestId('terminal-pane-header')).not.toHaveTextContent(
      'agent-title'
    )
  })

  test('paneUserLabel wins over session.name when paneAgentTitle is undefined', () => {
    render(<Header {...baseProps} paneUserLabel="my-label" />)

    expect(screen.getByTestId('terminal-pane-header')).toHaveTextContent(
      'my-label'
    )

    expect(screen.getByTestId('terminal-pane-header')).not.toHaveTextContent(
      baseProps.session.name
    )
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

  test('collapsed header hides the git ref chip', () => {
    render(<Header {...baseProps} isCollapsed worktreeName="agent-sidebar" />)

    expect(screen.queryByTestId('git-ref-chip')).not.toBeInTheDocument()
  })

  test('null branch omits the branch segment', () => {
    render(<Header {...baseProps} branch={null} />)

    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
  })

  test('renders git ref chip with worktree label when worktreeName is supplied', () => {
    render(<Header {...baseProps} worktreeName="agent-sidebar" />)

    expect(screen.getByTestId('git-ref-chip-wt-label')).toHaveTextContent(
      'agent-sidebar'
    )
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

  test('is not draggable by default', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-header')).not.toHaveAttribute(
      'draggable',
      'true'
    )
  })

  test('draggable header exposes the drag handle and fires drag callbacks', () => {
    const onHeaderDragStart = vi.fn()
    const onHeaderDragEnd = vi.fn()

    render(
      <Header
        {...baseProps}
        draggable
        onHeaderDragStart={onHeaderDragStart}
        onHeaderDragEnd={onHeaderDragEnd}
      />
    )

    const header = screen.getByTestId('terminal-pane-header')
    expect(header).toHaveAttribute('draggable', 'true')
    expect(header).toHaveAttribute('data-drag-handle', 'true')

    fireEvent.dragStart(header)
    expect(onHeaderDragStart).toHaveBeenCalledTimes(1)

    fireEvent.dragEnd(header)
    expect(onHeaderDragEnd).toHaveBeenCalledTimes(1)
  })

  test('rounds all corners during the drag so the snapshot reads as a pill', () => {
    render(<Header {...baseProps} draggable onHeaderDragStart={vi.fn()} />)

    const header = screen.getByTestId('terminal-pane-header')
    expect(header.style.borderRadius).toBe('')

    fireEvent.dragStart(header)
    expect(header.style.borderRadius).toBe('10px')

    fireEvent.dragEnd(header)
    expect(header.style.borderRadius).toBe('')
  })
})
