import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Session } from '../types'

const mockSessions: Session[] = [
  {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'auth middleware',
    status: 'running',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12345,
    createdAt: '2026-04-07T03:45:00Z',
    lastActivityAt: '2026-04-07T03:47:34Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: {
        used: 5000,
        total: 200000,
        percentage: 2.5,
        emoji: '😊',
      },
      usage: {
        sessionDuration: 300,
        turnCount: 5,
        messages: { sent: 5, limit: 200 },
        tokens: { input: 2000, output: 3000, total: 5000 },
      },
    },
  },
  {
    id: 'sess-2',
    projectId: 'proj-1',
    name: 'fix: login bug',
    status: 'paused',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    terminalPid: 12346,
    createdAt: '2026-04-07T03:30:00Z',
    lastActivityAt: '2026-04-07T03:32:15Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: { used: 10000, total: 200000, percentage: 5, emoji: '😊' },
      usage: {
        sessionDuration: 135,
        turnCount: 3,
        messages: { sent: 3, limit: 200 },
        tokens: { input: 5000, output: 5000, total: 10000 },
      },
    },
  },
  {
    id: 'sess-3',
    projectId: 'proj-1',
    name: 'refactor: api layer',
    status: 'completed',
    workingDirectory: '/home/user/projects/Vimeflow',
    agentType: 'claude-code',
    createdAt: '2026-04-07T02:00:00Z',
    lastActivityAt: '2026-04-07T02:45:00Z',
    activity: {
      fileChanges: [],
      toolCalls: [],
      testResults: [],
      contextWindow: {
        used: 150000,
        total: 200000,
        percentage: 75,
        emoji: '😟',
      },
      usage: {
        sessionDuration: 2700,
        turnCount: 20,
        messages: { sent: 20, limit: 200 },
        tokens: { input: 75000, output: 75000, total: 150000 },
      },
    },
  },
]

describe('Sidebar', () => {
  const mockOnSessionClick = vi.fn()
  const mockOnContextTabChange = vi.fn()

  beforeEach(() => {
    mockOnSessionClick.mockClear()
    mockOnContextTabChange.mockClear()
  })

  test('renders with correct width', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const sidebar = screen.getByTestId('sidebar')

    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveClass('w-[260px]')
  })

  test('renders all sessions', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    expect(screen.getByText('auth middleware')).toBeInTheDocument()
    expect(screen.getByText('fix: login bug')).toBeInTheDocument()
    expect(screen.getByText('refactor: api layer')).toBeInTheDocument()
  })

  test('displays status badge for each session', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // Status badges should be visible
    const runningBadge = screen.getByText('running')
    const pausedBadge = screen.getByText('paused')
    const completedBadge = screen.getByText('completed')

    expect(runningBadge).toBeInTheDocument()
    expect(pausedBadge).toBeInTheDocument()
    expect(completedBadge).toBeInTheDocument()
  })

  test('highlights active session with purple border and background', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const activeSession = screen.getByRole('button', {
      name: /auth middleware/i,
    })

    expect(activeSession).toHaveClass('border-l-primary')
    expect(activeSession).toHaveClass('bg-surface-container')
  })

  test('inactive sessions do not have active styling', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const inactiveSession = screen.getByRole('button', {
      name: /fix: login bug/i,
    })

    expect(inactiveSession).not.toHaveClass('border-l-primary')
    expect(inactiveSession).not.toHaveClass('bg-surface-container')
  })

  test('calls onSessionClick with session id when session is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const session = screen.getByRole('button', { name: /fix: login bug/i })

    await user.click(session)

    expect(mockOnSessionClick).toHaveBeenCalledWith('sess-2')
  })

  test('displays timestamps for sessions', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // Timestamps should be displayed (we'll format them as relative time)
    // For now, just check that some time-related text appears
    // The component will use a relative time formatter
    const timestamps = screen.getAllByTestId('session-timestamp')

    expect(timestamps).toHaveLength(3)
  })

  test('uses design tokens for colors and spacing', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const sidebar = screen.getByTestId('sidebar')

    expect(sidebar).toHaveClass('bg-surface-container-low')
  })

  test('renders empty state when no sessions', () => {
    render(
      <Sidebar
        sessions={[]}
        activeSessionId={null}
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    expect(screen.getByText('No sessions')).toBeInTheDocument()
  })

  test('renders ContextSwitcher at the bottom', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // Check that ContextSwitcher is rendered
    expect(screen.getByTestId('context-switcher')).toBeInTheDocument()

    // Check that all tabs are present
    expect(screen.getByRole('button', { name: /files/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /diff/i })).toBeInTheDocument()
  })

  test('ContextSwitcher receives correct activeTab prop', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="editor"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const editorTab = screen.getByRole('button', { name: /editor/i })

    // Active tab should have purple styling
    expect(editorTab).toHaveClass('text-primary')
    expect(editorTab).toHaveClass('border-b-primary')
  })

  test('ContextSwitcher calls onContextTabChange when tab is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const editorTab = screen.getByRole('button', { name: /editor/i })

    await user.click(editorTab)

    expect(mockOnContextTabChange).toHaveBeenCalledWith('editor')
    expect(mockOnContextTabChange).toHaveBeenCalledTimes(1)
  })

  test('session cards have hover state', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const session = screen.getByRole('button', { name: /fix: login bug/i })

    expect(session).toHaveClass('hover:bg-surface-container/50')
  })

  test('status badges use appropriate colors', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const runningBadge = screen.getByText('running')
    const pausedBadge = screen.getByText('paused')
    const completedBadge = screen.getByText('completed')

    // Running: green/primary
    expect(runningBadge).toHaveClass('bg-primary-container')

    // Paused: blue/secondary
    expect(pausedBadge).toHaveClass('bg-secondary-container/20')

    // Completed: neutral
    expect(completedBadge).toHaveClass('bg-surface-container')
  })

  test('session list section has correct layout', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const sidebar = screen.getByTestId('sidebar')

    // Should be flex column
    expect(sidebar).toHaveClass('flex')
    expect(sidebar).toHaveClass('flex-col')
  })

  test('renders session section header', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    expect(screen.getByText('Sessions')).toBeInTheDocument()
  })

  test('session items have consistent spacing', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const sessionList = screen.getByTestId('session-list')

    // Gap between session items
    expect(sessionList).toHaveClass('gap-1')
  })

  test('session name is truncated if too long', () => {
    const longNameSession: Session = {
      ...mockSessions[0],
      name: 'This is a very long session name that should be truncated to fit within the sidebar width',
    }

    render(
      <Sidebar
        sessions={[longNameSession]}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const sessionName = screen.getByText(longNameSession.name)

    // Should have text truncation class
    expect(sessionName).toHaveClass('truncate')
  })

  // Feature 15: Context Panel Integration Tests
  test('renders FilesPanel when activeContextTab is files', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // FilesPanel should be visible
    expect(screen.getByTestId('files-panel')).toBeInTheDocument()

    // Other panels should not be visible
    expect(screen.queryByTestId('editor-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()
  })

  test('renders EditorPanel when activeContextTab is editor', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="editor"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // EditorPanel should be visible
    expect(screen.getByTestId('editor-panel')).toBeInTheDocument()

    // Other panels should not be visible
    expect(screen.queryByTestId('files-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()
  })

  test('renders DiffPanel when activeContextTab is diff', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="diff"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // DiffPanel should be visible
    expect(screen.getByTestId('diff-panel')).toBeInTheDocument()

    // Other panels should not be visible
    expect(screen.queryByTestId('files-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('editor-panel')).not.toBeInTheDocument()
  })

  test('context panel content area has correct layout', () => {
    render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    const filesPanel = screen.getByTestId('files-panel')

    // Panel should fit within 260px sidebar width
    expect(filesPanel).toBeInTheDocument()

    // Panel should be scrollable (flex-1 with overflow)
    const sidebar = screen.getByTestId('sidebar')

    expect(sidebar).toHaveClass('flex-col')
  })

  test('switching tabs changes visible panel', async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="files"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // Initially shows FilesPanel
    expect(screen.getByTestId('files-panel')).toBeInTheDocument()

    // Click Editor tab
    const editorTab = screen.getByRole('button', { name: /editor/i })

    await user.click(editorTab)

    // Simulate parent component updating activeContextTab prop
    rerender(
      <Sidebar
        sessions={mockSessions}
        activeSessionId="sess-1"
        onSessionClick={mockOnSessionClick}
        activeContextTab="editor"
        onContextTabChange={mockOnContextTabChange}
      />
    )

    // Now shows EditorPanel
    expect(screen.getByTestId('editor-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('files-panel')).not.toBeInTheDocument()
  })
})
