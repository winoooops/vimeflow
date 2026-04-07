/* eslint-disable testing-library/no-node-access */
import { describe, test, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'
import { mockProjects } from './data/mockProjects'
import { mockSessions } from './data/mockSessions'

/**
 * Integration tests for WorkspaceView
 *
 * These tests verify full user workflows and interactions between components:
 * - Project switching updates sidebar sessions
 * - Session switching updates terminal and activity panels
 * - Context panel switching in sidebar
 * - Collapsible sections expand/collapse in Agent Activity
 */
describe('WorkspaceView Integration Tests', () => {
  describe('Project switching updates sidebar', () => {
    test('switching projects updates sidebar session list', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const iconRail = screen.getByTestId('icon-rail')
      const sidebar = screen.getByTestId('sidebar')

      // Get all project buttons (excluding settings/new project buttons)
      // Match full project names: "Vimeflow", "My Portfolio", "API Gateway", "Empty Project"
      const allButtons = within(iconRail).getAllByRole('button')

      const projectButtons = allButtons.filter(
        (btn) =>
          !btn.getAttribute('aria-label')?.includes('New project') &&
          !btn.getAttribute('aria-label')?.includes('Settings')
      )

      // Initially, should show sessions from first project (proj-1)
      const proj1Sessions = mockSessions.filter((s) => s.projectId === 'proj-1')
      const initialSessionList = within(sidebar).getByTestId('session-list')

      // Verify initial project sessions are shown
      proj1Sessions.forEach((session) => {
        expect(
          within(initialSessionList).getByText(session.name)
        ).toBeInTheDocument()
      })

      // Click second project button (proj-2 "Agent Dashboard")
      await user.click(projectButtons[1])

      // After switching, sidebar should show different sessions
      const proj2Sessions = mockSessions.filter((s) => s.projectId === 'proj-2')
      const updatedSessionList = within(sidebar).getByTestId('session-list')

      // Verify proj-2 sessions are now shown
      proj2Sessions.forEach((session) => {
        expect(
          within(updatedSessionList).getByText(session.name)
        ).toBeInTheDocument()
      })

      // Verify proj-1 sessions are no longer shown
      const allSessionText = updatedSessionList.textContent || ''
      proj1Sessions.forEach((session) => {
        expect(allSessionText).not.toContain(session.name)
      })
    })

    test('switching to empty project shows "No sessions" in sidebar', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const iconRail = screen.getByTestId('icon-rail')
      const sidebar = screen.getByTestId('sidebar')

      // Find project buttons
      const projectButtons = within(iconRail).getAllByRole('button')

      // Find the Empty Project button (proj-4)
      const emptyProject = mockProjects.find((p) => p.name === 'Empty Project')
      expect(emptyProject).toBeDefined()

      // Click the 4th project (Empty Project at index 3)
      await user.click(projectButtons[3])

      // Sidebar should show "No sessions" message
      expect(within(sidebar).getByText('No sessions')).toBeInTheDocument()
    })

    test('switching back to original project restores its sessions', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const iconRail = screen.getByTestId('icon-rail')
      const sidebar = screen.getByTestId('sidebar')
      const allButtons = within(iconRail).getAllByRole('button')

      const projectButtons = allButtons.filter(
        (btn) =>
          !btn.getAttribute('aria-label')?.includes('New project') &&
          !btn.getAttribute('aria-label')?.includes('Settings')
      )

      // Remember initial project sessions
      const proj1Sessions = mockSessions.filter((s) => s.projectId === 'proj-1')

      // Switch to second project
      await user.click(projectButtons[1])

      // Switch back to first project
      await user.click(projectButtons[0])

      // Original sessions should be restored
      const sessionList = within(sidebar).getByTestId('session-list')
      proj1Sessions.forEach((session) => {
        expect(within(sessionList).getByText(session.name)).toBeInTheDocument()
      })
    })
  })

  describe('Session switching updates terminal and activity', () => {
    test('clicking session updates terminal zone tabs', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const terminalZone = screen.getByTestId('terminal-zone')

      // Get session buttons from sidebar (session list contains buttons)
      const sessionList = within(sidebar).getByTestId('session-list')
      const sessionButtons = within(sessionList).getAllByRole('button')

      expect(sessionButtons.length).toBeGreaterThan(1)

      // Click second session
      const secondSession = sessionButtons[1]
      await user.click(secondSession)

      // Terminal zone should update its active session
      const tabBar = within(terminalZone).getByTestId('tab-bar')

      // The active session tab should have visual indicator
      const sessionTabs = within(tabBar).getAllByRole('button', {
        name: /^🤖/,
      })

      // At least one tab should have the active styling
      const hasActiveTab = sessionTabs.some((tab) =>
        tab.classList.contains('border-b-primary')
      )

      expect(hasActiveTab).toBe(true)
    })

    test('clicking session updates agent activity panel content', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const agentActivity = screen.getByTestId('agent-activity')

      // Get first project's first session name
      const firstSession = mockSessions.find((s) => s.projectId === 'proj-1')
      expect(firstSession).toBeDefined()

      // Get all session buttons from session list
      const sessionList = within(sidebar).getByTestId('session-list')
      const sessionButtons = within(sessionList).getAllByRole('button')

      expect(sessionButtons.length).toBeGreaterThan(1)

      // Click second session button
      await user.click(sessionButtons[1])

      // Agent Activity should update to show new session data
      // Verify StatusCard shows session name
      const statusCard = within(agentActivity).getByTestId('status-card')
      expect(statusCard).toBeInTheDocument()

      // The status card should contain agent name "Claude Code"
      expect(within(statusCard).getByText('Claude Code')).toBeInTheDocument()

      // Verify PinnedMetrics are shown
      expect(
        within(agentActivity).getByTestId('pinned-metrics')
      ).toBeInTheDocument()
    })

    test('session switch synchronizes terminal and activity panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const terminalZone = screen.getByTestId('terminal-zone')
      const agentActivity = screen.getByTestId('agent-activity')

      // Click a session
      const sessionList = within(sidebar).getByTestId('session-list')
      const sessionButtons = within(sessionList).getAllByRole('button')

      await user.click(sessionButtons[0])

      // Both terminal and activity should reference the same session
      const tabBar = within(terminalZone).getByTestId('tab-bar')

      const sessionTabs = within(tabBar).getAllByRole('button', {
        name: /^🤖/,
      })

      // Terminal should have at least one session tab
      expect(sessionTabs.length).toBeGreaterThan(0)

      // Agent Activity should have session data
      const statusCard = within(agentActivity).getByTestId('status-card')
      expect(statusCard).toBeInTheDocument()
    })
  })

  describe('Context panel switching in sidebar', () => {
    test('clicking Files tab shows FilesPanel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const contextSwitcher = within(sidebar).getByTestId('context-switcher')

      // Files should be active by default
      const filesPanel = within(sidebar).queryByTestId('files-panel')
      expect(filesPanel).toBeInTheDocument()

      // Click Files tab explicitly to verify it works
      const filesTab = within(contextSwitcher).getByText('Files')
      await user.click(filesTab)

      // FilesPanel should still be visible
      expect(within(sidebar).getByTestId('files-panel')).toBeInTheDocument()
    })

    test('clicking Editor tab shows EditorPanel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const contextSwitcher = within(sidebar).getByTestId('context-switcher')

      // Click Editor tab
      const editorTab = within(contextSwitcher).getByText('Editor')
      await user.click(editorTab)

      // EditorPanel should be visible
      expect(within(sidebar).getByTestId('editor-panel')).toBeInTheDocument()

      // FilesPanel should not be visible
      expect(
        within(sidebar).queryByTestId('files-panel')
      ).not.toBeInTheDocument()
    })

    test('clicking Diff tab shows DiffPanel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const contextSwitcher = within(sidebar).getByTestId('context-switcher')

      // Click Diff tab
      const diffTab = within(contextSwitcher).getByText('Diff')
      await user.click(diffTab)

      // DiffPanel should be visible
      expect(within(sidebar).getByTestId('diff-panel')).toBeInTheDocument()

      // Other panels should not be visible
      expect(
        within(sidebar).queryByTestId('files-panel')
      ).not.toBeInTheDocument()

      expect(
        within(sidebar).queryByTestId('editor-panel')
      ).not.toBeInTheDocument()
    })

    test('context panel switches preserve session list visibility', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const contextSwitcher = within(sidebar).getByTestId('context-switcher')

      // Session list should always be visible regardless of context panel
      const sessionList = within(sidebar).getByTestId('session-list')
      expect(sessionList).toBeInTheDocument()

      // Switch to Editor
      await user.click(within(contextSwitcher).getByText('Editor'))
      expect(within(sidebar).getByTestId('session-list')).toBeInTheDocument()

      // Switch to Diff
      await user.click(within(contextSwitcher).getByText('Diff'))
      expect(within(sidebar).getByTestId('session-list')).toBeInTheDocument()

      // Switch back to Files
      await user.click(within(contextSwitcher).getByText('Files'))
      expect(within(sidebar).getByTestId('session-list')).toBeInTheDocument()
    })

    test('active context tab has correct visual styling', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const contextSwitcher = within(sidebar).getByTestId('context-switcher')

      const editorTab = within(contextSwitcher).getByText('Editor')

      // Click Editor tab
      await user.click(editorTab)

      // Editor tab should have active styling
      const editorButton = editorTab.closest('button')
      expect(editorButton).toHaveClass('text-primary')
    })
  })

  describe('Collapsible sections expand/collapse in Agent Activity', () => {
    test('clicking Files Changed header toggles section visibility', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const agentActivity = screen.getByTestId('agent-activity')

      // Find Files Changed button
      const toggleButton = within(agentActivity).getByRole('button', {
        name: /Files Changed/,
      })

      expect(toggleButton).toBeInTheDocument()

      // Files Changed should be expanded by default (showing files-list)
      const initialFilesList = within(agentActivity).queryByTestId('files-list')
      const isInitiallyExpanded = initialFilesList !== null

      // Click to collapse
      await user.click(toggleButton)

      // Content should toggle visibility
      const afterClickFilesList =
        within(agentActivity).queryByTestId('files-list')
      const isAfterClickExpanded = afterClickFilesList !== null

      expect(isAfterClickExpanded).toBe(!isInitiallyExpanded)
    })

    test('clicking Tool Calls header toggles section visibility', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const agentActivity = screen.getByTestId('agent-activity')

      // Find Tool Calls button
      const toggleButton = within(agentActivity).getByRole('button', {
        name: /Tool Calls/,
      })

      expect(toggleButton).toBeInTheDocument()

      // Check initial state - should be collapsed (no tool-calls-list)
      const initialContent =
        within(agentActivity).queryByTestId('tool-calls-list')
      const isInitiallyExpanded = initialContent !== null

      // Click to expand/collapse
      await user.click(toggleButton)

      // Content should toggle
      const afterClickContent =
        within(agentActivity).queryByTestId('tool-calls-list')
      const isAfterClickExpanded = afterClickContent !== null

      expect(isAfterClickExpanded).toBe(!isInitiallyExpanded)
    })

    test('clicking Tests header toggles section visibility', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const agentActivity = screen.getByTestId('agent-activity')

      // Find Tests button (not confused with Tool Calls)
      const allButtons = within(agentActivity).getAllByRole('button')

      const toggleButton = allButtons.find(
        (btn) =>
          btn.textContent?.includes('Tests') &&
          !btn.textContent?.includes('Tool Calls')
      )

      expect(toggleButton).toBeDefined()

      // Check initial state - should be collapsed (no tests-list)
      const initialContent = within(agentActivity).queryByTestId('tests-list')
      const isInitiallyExpanded = initialContent !== null

      // Click to expand/collapse
      await user.click(toggleButton!)

      // Content should toggle
      const afterClickContent =
        within(agentActivity).queryByTestId('tests-list')
      const isAfterClickExpanded = afterClickContent !== null

      expect(isAfterClickExpanded).toBe(!isInitiallyExpanded)
    })

    test('collapsible sections work independently', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const agentActivity = screen.getByTestId('agent-activity')

      // Find Files Changed and Tool Calls buttons
      const filesToggle = within(agentActivity).getByRole('button', {
        name: /Files Changed/,
      })

      const toolCallsToggle = within(agentActivity).getByRole('button', {
        name: /Tool Calls/,
      })

      // Collapse Files Changed (initially expanded)
      await user.click(filesToggle)

      // Expand Tool Calls (initially collapsed)
      await user.click(toolCallsToggle)

      // Files Changed should now be collapsed (no files-list)
      const filesContent = within(agentActivity).queryByTestId('files-list')

      // Tool Calls should be expanded (tool-calls-list exists)
      const toolCallsContent =
        within(agentActivity).queryByTestId('tool-calls-list')

      // They should have opposite states
      expect(filesContent).toBeNull()
      expect(toolCallsContent).not.toBeNull()
    })

    test('chevron icon rotates when section expands/collapses', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const agentActivity = screen.getByTestId('agent-activity')

      // Find Files Changed button
      const toggleButton = within(agentActivity).getByRole('button', {
        name: /Files Changed/,
      })

      // Get chevron element (first span in button)
      const chevron = toggleButton.querySelector('span')
      expect(chevron).toBeInTheDocument()

      const initialChevron = chevron?.textContent

      // Click to toggle
      await user.click(toggleButton)

      // Chevron should change (▾ ↔ ▸)
      const afterClickChevron = chevron?.textContent

      // One should be ▾ and the other ▸
      const validChevrons = ['▾', '▸']
      expect(validChevrons).toContain(initialChevron)
      expect(validChevrons).toContain(afterClickChevron)
      expect(initialChevron).not.toBe(afterClickChevron)
    })
  })
})
