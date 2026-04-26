/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalZone } from './TerminalZone'
import { mockSessions } from '../data/mockSessions'

// Mock TerminalPane to avoid xterm.js issues in tests
vi.mock('../../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(({ sessionId, cwd, restoredFrom }) => (
    <div
      data-testid="terminal-pane-mock"
      data-session-id={sessionId}
      data-cwd={cwd}
      data-restored={restoredFrom ? 'true' : 'false'}
    >
      Mocked TerminalPane
    </div>
  )),
}))

describe('TerminalZone', () => {
  const mockOnSessionChange = vi.fn()
  const mockOnNewTab = vi.fn()

  beforeEach(() => {
    mockOnSessionChange.mockClear()
    mockOnNewTab.mockClear()
  })

  const defaultProps = {
    sessions: mockSessions.slice(0, 2), // First two sessions
    activeSessionId: 'sess-1',
    onSessionChange: mockOnSessionChange,
    onNewTab: mockOnNewTab,
  }

  test('renders tab bar with agent session tabs', () => {
    render(<TerminalZone {...defaultProps} />)

    // Check that both session tabs render
    expect(screen.getByText('🤖 auth middleware')).toBeInTheDocument()
    expect(screen.getByText('🤖 fix: login bug')).toBeInTheDocument()
  })

  test('renders + new tab button', () => {
    render(<TerminalZone {...defaultProps} />)

    const newTabButton = screen.getByRole('button', { name: /new tab/i })

    expect(newTabButton).toBeInTheDocument()
    expect(newTabButton).toHaveTextContent('+')
  })

  test('applies active tab styling to selected session', () => {
    render(<TerminalZone {...defaultProps} />)

    const activeTab = screen.getByRole('button', {
      name: /🤖 auth middleware/i,
    })

    const inactiveTab = screen.getByRole('button', {
      name: /🤖 fix: login bug/i,
    })

    // Styling classes are on the parent div wrapper
    const activeWrapper = activeTab.parentElement!
    const inactiveWrapper = inactiveTab.parentElement!

    // Active tab should have primary text color
    expect(activeWrapper).toHaveClass('text-primary')
    // Active tab should have purple bottom border
    expect(activeWrapper).toHaveClass('border-b-primary')

    // Inactive tab should have muted text
    expect(inactiveWrapper).toHaveClass('text-on-surface/60')
    // Inactive tab should have transparent border
    expect(inactiveWrapper).toHaveClass('border-b-transparent')
  })

  test('calls onSessionChange when clicking inactive tab', async () => {
    const user = userEvent.setup()

    render(<TerminalZone {...defaultProps} />)

    const inactiveTab = screen.getByRole('button', {
      name: /🤖 fix: login bug/i,
    })

    await user.click(inactiveTab)

    expect(mockOnSessionChange).toHaveBeenCalledWith('sess-2')
    expect(mockOnSessionChange).toHaveBeenCalledTimes(1)
  })

  test('does not call onSessionChange when clicking active tab', async () => {
    const user = userEvent.setup()

    render(<TerminalZone {...defaultProps} />)

    const activeTab = screen.getByRole('button', {
      name: /🤖 auth middleware/i,
    })

    await user.click(activeTab)

    expect(mockOnSessionChange).not.toHaveBeenCalled()
  })

  test('calls onNewTab when clicking + button', async () => {
    const user = userEvent.setup()

    render(<TerminalZone {...defaultProps} />)

    const newTabButton = screen.getByRole('button', { name: /new tab/i })

    await user.click(newTabButton)

    expect(mockOnNewTab).toHaveBeenCalledTimes(1)
  })

  test('renders terminal content area with TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalContent = screen.getByTestId('terminal-content')

    expect(terminalContent).toBeInTheDocument()
    // Dark background matching design spec (#121221)
    expect(terminalContent).toHaveClass('bg-surface')
    // Should have TerminalPanes (mocked) - one for each session
    expect(screen.getAllByTestId('terminal-pane-mock')).toHaveLength(2)
  })

  test('renders with empty sessions array', () => {
    render(<TerminalZone {...defaultProps} sessions={[]} />)

    // Should still render tab bar
    expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
    // Should still render new tab button
    expect(screen.getByRole('button', { name: /new tab/i })).toBeInTheDocument()
    // Terminal content should still render
    expect(screen.getByTestId('terminal-content')).toBeInTheDocument()
  })

  test('applies correct design tokens to tab bar', () => {
    render(<TerminalZone {...defaultProps} />)

    const tabBar = screen.getByTestId('tab-bar')

    // Background color from design tokens - deepest recessed areas per spec
    expect(tabBar).toHaveClass('bg-surface-container-lowest')
    // Proper spacing
    expect(tabBar).toHaveClass('px-2')
    expect(tabBar).toHaveClass('gap-1')
  })

  test('applies hover state to inactive tabs', () => {
    render(<TerminalZone {...defaultProps} />)

    const inactiveTab = screen.getByRole('button', {
      name: /🤖 fix: login bug/i,
    })

    // Hover classes are on the parent div wrapper
    const wrapper = inactiveTab.parentElement!
    expect(wrapper).toHaveClass('hover:bg-surface-container/50')
    expect(wrapper).toHaveClass('hover:text-on-surface')
  })

  test('renders flex-1 for terminal content to fill available space', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalContent = screen.getByTestId('terminal-content')

    expect(terminalContent).toHaveClass('flex-1')
  })

  test('renders tab bar with proper flex layout', () => {
    render(<TerminalZone {...defaultProps} />)

    const tabBar = screen.getByTestId('tab-bar')

    expect(tabBar).toHaveClass('flex')
    expect(tabBar).toHaveClass('items-center')
  })

  test('renders tabs with font-label class', () => {
    render(<TerminalZone {...defaultProps} />)

    const tab = screen.getByRole('button', { name: /🤖 auth middleware/i })

    expect(tab).toHaveClass('font-label')
  })

  test('renders new tab button with correct styling', () => {
    render(<TerminalZone {...defaultProps} />)

    const newTabButton = screen.getByRole('button', { name: /new tab/i })

    expect(newTabButton).toHaveClass('text-on-surface/60')
    expect(newTabButton).toHaveClass('hover:text-on-surface')
    expect(newTabButton).toHaveClass('hover:bg-surface-container/50')
  })

  test('component has flex column layout', () => {
    render(<TerminalZone {...defaultProps} />)

    const rootElement = screen.getByTestId('terminal-zone')

    expect(rootElement).toHaveClass('flex')
    expect(rootElement).toHaveClass('flex-col')
    expect(rootElement).toHaveClass('flex-1')
    expect(rootElement).toHaveClass('min-h-0')
  })

  // TerminalPane integration tests (Feature #30)
  test('renders TerminalPane when active session exists', () => {
    render(<TerminalZone {...defaultProps} />)

    // TerminalPane wrappers should be rendered for all sessions
    const terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // Mocked TerminalPane components should be present
    expect(screen.getAllByTestId('terminal-pane-mock')).toHaveLength(2)
  })

  test('passes active session id to TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalPanes = screen.getAllByTestId('terminal-pane')

    // Find the active session's pane
    const activePane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    expect(activePane).toBeInTheDocument()
    expect(activePane).toHaveAttribute('data-session-id', 'sess-1')

    // Mocked component should also have the correct sessionId
    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const activeMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )
    expect(activeMockPane).toHaveAttribute('data-session-id', 'sess-1')
  })

  test('passes active session working directory to TerminalPane', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalPanes = screen.getAllByTestId('terminal-pane')

    // Find the active session's pane
    const activePane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    expect(activePane).toHaveAttribute('data-cwd', '~')

    // Mocked component should also receive it
    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const activeMockPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )
    expect(activeMockPane).toHaveAttribute('data-cwd', '~')
  })

  test('does not render TerminalPane when no sessions exist', () => {
    render(
      <TerminalZone {...defaultProps} sessions={[]} activeSessionId={null} />
    )

    // TerminalPane should not be rendered when there are no sessions
    expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-pane-mock')).not.toBeInTheDocument()

    // Should show placeholder instead
    expect(
      screen.getByText(/no active session.*click \+ to create a new terminal/i)
    ).toBeInTheDocument()
  })

  test('updates TerminalPane when active session changes', () => {
    const { rerender } = render(<TerminalZone {...defaultProps} />)

    // Both sessions are rendered, but only sess-1 is visible initially
    let terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    const session1Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const session2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(session1Pane).toHaveAttribute('data-session-id', 'sess-1')
    expect(session2Pane).toHaveAttribute('data-session-id', 'sess-2')

    // Change to second session
    rerender(<TerminalZone {...defaultProps} activeSessionId="sess-2" />)

    // Both should still be rendered
    terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // Verify session 2 pane has correct attributes
    const updatedSession2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )
    expect(updatedSession2Pane).toHaveAttribute('data-session-id', 'sess-2')
    expect(updatedSession2Pane).toHaveAttribute('data-cwd', '~')
  })

  // P2 Codex Finding: Keep terminal sessions alive when switching tabs
  test('keeps all terminal sessions mounted when switching tabs', () => {
    const { rerender } = render(<TerminalZone {...defaultProps} />)

    // Both sessions should have TerminalPanes rendered
    const terminalPanes = screen.getAllByTestId('terminal-pane')
    expect(terminalPanes).toHaveLength(2)

    // First session should be visible (active)
    const session1Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const session2Pane = terminalPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(session1Pane).toBeInTheDocument()
    expect(session2Pane).toBeInTheDocument()

    // Active session should be visible, inactive should be hidden
    expect(session1Pane).not.toHaveClass('hidden')
    expect(session2Pane).toHaveClass('hidden')

    // Switch to second session
    rerender(<TerminalZone {...defaultProps} activeSessionId="sess-2" />)

    // Both TerminalPanes should still be mounted (not unmounted)
    const updatedPanes = screen.getAllByTestId('terminal-pane')
    expect(updatedPanes).toHaveLength(2)

    // Visibility should swap
    const updatedSession1Pane = updatedPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const updatedSession2Pane = updatedPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(updatedSession1Pane).toHaveClass('hidden')
    expect(updatedSession2Pane).not.toHaveClass('hidden')
  })

  // Feature #14: Restore protocol tests
  test('shows loading state when loading=true', () => {
    render(<TerminalZone {...defaultProps} loading />)

    expect(screen.getByText(/restoring sessions/i)).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-pane-mock')).not.toBeInTheDocument()
  })

  test('passes restoreData to TerminalPane for each session', () => {
    const restoreData = new Map([
      [
        'sess-1',
        {
          sessionId: 'sess-1',
          cwd: '/tmp',
          pid: 123,
          replayData: 'AAA',
          replayEndOffset: 3,
          bufferedEvents: [],
        },
      ],
    ])

    render(<TerminalZone {...defaultProps} restoreData={restoreData} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    const restoredPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-1'
    )

    const normalPane = mockPanes.find(
      (pane) => pane.getAttribute('data-session-id') === 'sess-2'
    )

    expect(restoredPane).toHaveAttribute('data-restored', 'true')
    expect(normalPane).toHaveAttribute('data-restored', 'false')
  })

  test('does not pass restoreData when not provided', () => {
    render(<TerminalZone {...defaultProps} />)

    const mockPanes = screen.getAllByTestId('terminal-pane-mock')

    mockPanes.forEach((pane) => {
      expect(pane).toHaveAttribute('data-restored', 'false')
    })
  })
})
