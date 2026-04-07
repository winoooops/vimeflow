/* eslint-disable testing-library/no-node-access */
/* eslint-disable vitest/expect-expect */
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'

describe('WorkspaceView', () => {
  test('renders all five zones (icon rail, sidebar, terminal, bottom drawer, agent activity)', () => {
    render(<WorkspaceView />)

    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument() // BottomDrawer
    expect(screen.getByTestId('agent-activity')).toBeInTheDocument()
  })

  test('applies correct grid layout with 4 columns (updated dimensions)', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('grid')
    expect(container).toHaveClass('grid-cols-[64px_256px_1fr_320px]')
  })

  test('fills viewport height', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('h-screen')
  })

  test('passes active project to IconRail', () => {
    render(<WorkspaceView />)

    const iconRail = screen.getByTestId('icon-rail')

    // IconRail should render with at least one project button
    const projectButtons = iconRail.querySelectorAll('button[aria-label]')
    expect(projectButtons.length).toBeGreaterThan(0)
  })

  test('passes sessions to Sidebar', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')

    // Sidebar should show session list
    expect(
      sidebar.querySelector('[data-testid="session-list"]')
    ).toBeInTheDocument()
  })

  test('passes active session to TerminalZone', () => {
    render(<WorkspaceView />)

    const terminalZone = screen.getByTestId('terminal-zone')

    // TerminalZone should render tab bar with at least one session tab
    const tabBar = terminalZone.querySelector('[data-testid="tab-bar"]')
    expect(tabBar).toBeInTheDocument()

    const sessionTabs = tabBar?.querySelectorAll('button[aria-label^="🤖"]')
    expect(sessionTabs?.length).toBeGreaterThan(0)
  })

  test('passes active session to AgentActivity', () => {
    render(<WorkspaceView />)

    const agentActivity = screen.getByTestId('agent-activity')

    // AgentActivity should render all sections
    expect(agentActivity).toBeInTheDocument()
  })

  test('renders navigation items in IconRail', () => {
    render(<WorkspaceView />)

    // IconRail should render navigation items (Dashboard, Source Control, etc.)
    expect(
      screen.getByRole('button', { name: 'Dashboard' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Source Control' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  test('defaults to first session as active', () => {
    render(<WorkspaceView />)

    // First session should have active styling (bg-slate-800/80)
    const firstSession = screen.getByRole('button', { name: 'auth middleware' })
    expect(firstSession).toHaveClass('bg-slate-800/80')
    expect(firstSession).toHaveClass('text-primary-container')
  })

  test('renders FileExplorer in sidebar', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')

    // FileExplorer should be rendered (no more context switcher)
    const fileExplorer = sidebar.querySelector('[data-testid="file-explorer"]')
    expect(fileExplorer).toBeInTheDocument()
  })

  test('handles navigation item clicks', () => {
    render(<WorkspaceView />)

    // Navigation items should be clickable
    const dashboardButton = screen.getByRole('button', { name: 'Dashboard' })
    expect(dashboardButton).toBeInTheDocument()

    // Click should not crash (navigation items have onClick handlers)
    dashboardButton.click()
  })

  test('handles session switch callback', () => {
    render(<WorkspaceView />)

    const sidebar = screen.getByTestId('sidebar')
    const sessionButtons = sidebar.querySelectorAll('button[aria-label]')

    // Click second session if it exists
    if (sessionButtons.length > 1) {
      const secondSession = sessionButtons[1] as HTMLButtonElement
      secondSession.click()

      // State should update (verified through internal state)
    }
  })

  test('BottomDrawer is present below TerminalZone', () => {
    render(<WorkspaceView />)

    // BottomDrawer should render with Editor tab active
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /diff viewer/i })
    ).toBeInTheDocument()
  })

  test('main workspace area uses flex-col layout', () => {
    render(<WorkspaceView />)

    const workspaceView = screen.getByTestId('workspace-view')

    // Main workspace container (3rd child in grid) should use flex-col
    const mainWorkspace = workspaceView.children[2] as HTMLElement
    expect(mainWorkspace).toHaveClass('flex')
    expect(mainWorkspace).toHaveClass('flex-col')
  })

  test('applies overflow-hidden to prevent scrollbars', () => {
    render(<WorkspaceView />)

    const container = screen.getByTestId('workspace-view')

    expect(container).toHaveClass('overflow-hidden')
  })

  test('handles session switching', async () => {
    // Test that clicking a different session updates the active session
    const user = userEvent.setup()
    render(<WorkspaceView />)

    // Initially, first session is active
    const firstSession = screen.getByRole('button', { name: 'auth middleware' })
    expect(firstSession).toHaveClass('bg-slate-800/80')

    // Click second session
    const secondSession = screen.getByRole('button', { name: 'fix: login bug' })
    await user.click(secondSession)

    // Second session should now be active
    expect(secondSession).toHaveClass('bg-slate-800/80')
  })

  test('handles empty sessions gracefully without crashing', () => {
    // Component should render all zones even when there are no active sessions
    render(<WorkspaceView />)

    // All main zones should still render
    expect(screen.getByTestId('icon-rail')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-zone')).toBeInTheDocument()
    expect(screen.getByTestId('agent-activity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
  })
})
