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
  isActive: true,
  isCollapsed: false,
  ptyId: 's1',
  onToggleCollapse: vi.fn(),
}

describe('Header', () => {
  test('renders compact glyph-only agent chip', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByTestId('agent-glyph-label')).toHaveTextContent('CLAUDE')
    expect(screen.getByTestId('agent-glyph-label')).toHaveClass('hidden')

    const glyphChip = screen.getByTestId('agent-glyph-chip')
    expect(glyphChip).toHaveClass('h-[22px]')
    expect(glyphChip).toHaveClass('w-[22px]')
    expect(glyphChip).toHaveClass('justify-center')
    // eslint-disable-next-line testing-library/no-node-access -- claude renders an svg brand mark
    const brandMark = glyphChip.querySelector('svg')

    expect(brandMark).toBeInTheDocument()
  })

  test('header uses compact spacing by default', () => {
    render(<Header {...baseProps} />)

    const header = screen.getByTestId('terminal-pane-header')
    expect(header).toHaveClass('gap-1.5')
    expect(header).toHaveClass('px-2')
    expect(header).toHaveClass('py-1')
  })

  test('collapsed status does not change the compact header', () => {
    render(<Header {...baseProps} isCollapsed />)

    const header = screen.getByTestId('terminal-pane-header')
    expect(header).toHaveClass('gap-1.5')
    expect(header).toHaveClass('px-2')
    expect(header).toHaveClass('py-1')

    const glyphChip = screen.getByTestId('agent-glyph-chip')
    expect(glyphChip).toHaveClass('h-[22px]')
    expect(glyphChip).toHaveClass('w-[22px]')
    expect(glyphChip).toHaveClass('justify-center')
    expect(screen.getByTestId('agent-glyph-label')).toHaveClass('hidden')
  })

  test('renders pane title from session.name', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByText('auth refactor')).toBeInTheDocument()
  })

  test('uses the theme active surface tone', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-header')).toHaveClass(
      'bg-primary-container/15'
    )
  })

  test('does not tint inactive pane headers', () => {
    const inactiveProps = { ...baseProps, isActive: false }

    render(<Header {...inactiveProps} />)

    expect(screen.getByTestId('terminal-pane-header')).not.toHaveClass(
      'bg-primary-container/15'
    )
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

  test('does not render git metadata (it lives in the status bar)', () => {
    render(<Header {...baseProps} />)

    expect(screen.queryByTestId('git-ref-chip')).not.toBeInTheDocument()
    expect(screen.queryByText('+48')).not.toBeInTheDocument()
  })

  test('collapse button fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()

    render(<Header {...baseProps} onToggleCollapse={onToggleCollapse} />)
    fireEvent.click(screen.getByRole('button', { name: /collapse status/i }))

    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  test('hides collapse button when the status bar cannot render', () => {
    render(<Header {...baseProps} hideCollapseToggle />)

    expect(
      screen.queryByRole('button', { name: /collapse status|expand status/i })
    ).toBeNull()
  })

  test('close button renders only when onClose is defined', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Header {...baseProps} />)

    expect(screen.queryByRole('button', { name: /close pane/i })).toBeNull()

    rerender(<Header {...baseProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close pane/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('keeps action buttons rendered alongside a long pane title', () => {
    render(
      <Header
        {...baseProps}
        paneUserLabel="a-very-long-pane-title-that-would-otherwise-push-the-controls-off"
        onClose={vi.fn()}
        onBurner={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /open burner terminal/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /close pane/i })
    ).toBeInTheDocument()
  })

  test('is not draggable by default', () => {
    render(<Header {...baseProps} />)

    expect(screen.getByTestId('terminal-pane-drag-handle')).not.toHaveAttribute(
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

    const handle = screen.getByTestId('terminal-pane-drag-handle')
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(handle).toHaveAttribute('data-drag-handle', 'true')

    fireEvent.dragStart(handle)
    expect(onHeaderDragStart).toHaveBeenCalledTimes(1)

    fireEvent.dragEnd(handle)
    expect(onHeaderDragEnd).toHaveBeenCalledTimes(1)
  })

  test('rounds all corners during the drag so the snapshot reads as a pill', () => {
    render(<Header {...baseProps} draggable onHeaderDragStart={vi.fn()} />)

    const handle = screen.getByTestId('terminal-pane-drag-handle')
    expect(handle).toHaveClass('overflow-hidden')
    expect(handle).toHaveClass('rounded-[10px]')
    expect(handle).toHaveClass('bg-primary-container/15')
    expect(handle.style.borderRadius).toBe('')

    fireEvent.dragStart(handle)
    expect(handle.style.borderRadius).toBe('10px')

    fireEvent.dragEnd(handle)
    expect(handle.style.borderRadius).toBe('')
  })

  test('action area is not part of the drag handle', () => {
    render(
      <Header
        {...baseProps}
        draggable
        onClose={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    )

    const header = screen.getByTestId('terminal-pane-header')
    expect(header).not.toHaveAttribute('draggable', 'true')
    expect(header).not.toHaveAttribute('data-drag-handle', 'true')

    const actions = screen.getByTestId('terminal-pane-header-actions')
    expect(actions).not.toHaveAttribute('draggable', 'true')
    expect(actions).not.toHaveAttribute('data-drag-handle', 'true')
  })

  test('header action buttons keep their pointer cursor affordance', () => {
    render(<Header {...baseProps} onClose={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /collapse status/i })
    ).toHaveClass('cursor-pointer')

    expect(screen.getByRole('button', { name: /close pane/i })).toHaveClass(
      'cursor-pointer'
    )
  })
})
