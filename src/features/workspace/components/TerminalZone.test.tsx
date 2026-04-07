import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalZone } from './TerminalZone'
import { mockSessions } from '../data/mockSessions'

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

    // Active tab should have primary text color
    expect(activeTab).toHaveClass('text-primary')
    // Active tab should have purple bottom border
    expect(activeTab).toHaveClass('border-b-primary')

    // Inactive tab should have muted text
    expect(inactiveTab).toHaveClass('text-on-surface/60')
    // Inactive tab should have transparent border
    expect(inactiveTab).toHaveClass('border-b-transparent')
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

  test('renders terminal placeholder content area', () => {
    render(<TerminalZone {...defaultProps} />)

    const terminalContent = screen.getByTestId('terminal-content')

    expect(terminalContent).toBeInTheDocument()
    // Dark background matching design spec (#121221)
    expect(terminalContent).toHaveClass('bg-surface')
    // Should have prompt text
    expect(
      screen.getByText(/Terminal output will appear here/i)
    ).toBeInTheDocument()
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

    // Background color from design tokens
    expect(tabBar).toHaveClass('bg-surface-container-low')
    // Proper spacing
    expect(tabBar).toHaveClass('px-2')
    expect(tabBar).toHaveClass('gap-1')
  })

  test('applies hover state to inactive tabs', () => {
    render(<TerminalZone {...defaultProps} />)

    const inactiveTab = screen.getByRole('button', {
      name: /🤖 fix: login bug/i,
    })

    expect(inactiveTab).toHaveClass('hover:bg-surface-container/50')
    expect(inactiveTab).toHaveClass('hover:text-on-surface')
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
    expect(rootElement).toHaveClass('h-full')
  })
})
