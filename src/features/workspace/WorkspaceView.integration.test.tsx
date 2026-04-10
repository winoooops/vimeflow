/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceView } from './WorkspaceView'
import * as useCodeMirrorModule from '../editor/hooks/useCodeMirror'
import * as useVimModeModule from '../editor/hooks/useVimMode'

// Mock TerminalPane to avoid xterm.js issues in tests
vi.mock('../terminal/components/TerminalPane', () => ({
  TerminalPane: vi.fn(() => (
    <div data-testid="terminal-pane-mock">Mocked TerminalPane</div>
  )),
}))

// Mock CodeMirror hooks for unsaved changes tests
let mockOnChange: ((content: string) => void) | undefined
let mockOnSave: (() => void) | undefined

const mockEditorView = {
  destroy: vi.fn(),
  state: { doc: { toString: (): string => 'test content' } },
}

const createMockUseCodeMirror =
  (): typeof useCodeMirrorModule.useCodeMirror =>
  (options): ReturnType<typeof useCodeMirrorModule.useCodeMirror> => {
    // Store the onChange and onSave callbacks so tests can trigger them
    mockOnChange = options.onChange
    mockOnSave = options.onSave

    return {
      editorView: mockEditorView as never,
      updateContent: vi.fn(),
      setContainer: vi.fn(),
    }
  }

const createMockUseVimMode =
  (): typeof useVimModeModule.useVimMode =>
  (): ReturnType<typeof useVimModeModule.useVimMode> =>
    'NORMAL'

/**
 * Integration tests for WorkspaceView
 *
 * These tests verify full user workflows and interactions between components:
 * - Session switching updates terminal and activity panels
 * - BottomDrawer tab switching (Editor/Diff)
 * - Collapsible sections expand/collapse in Agent Activity
 */
describe('WorkspaceView Integration Tests', () => {
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

      // At least one tab wrapper should have the active styling (class is on parent div)
      const hasActiveTab = sessionTabs.some((tab) =>
        tab.parentElement?.classList.contains('border-b-primary')
      )

      expect(hasActiveTab).toBe(true)
    })

    test('clicking session updates agent activity panel content', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const agentActivity = screen.getByTestId('agent-activity')

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

  describe('BottomDrawer tab switching', () => {
    test('clicking Editor tab shows Editor panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const bottomDrawer = screen.getByTestId('bottom-drawer')

      // Editor should be active by default
      const editorPanel = within(bottomDrawer).queryByTestId('editor-panel')
      expect(editorPanel).toBeInTheDocument()

      // Click Editor tab explicitly to verify it works
      const editorTab = within(bottomDrawer).getByText('Editor')
      await user.click(editorTab)

      // EditorPanel should still be visible
      expect(
        within(bottomDrawer).getByTestId('editor-panel')
      ).toBeInTheDocument()
    })

    test('clicking Diff Viewer tab shows Diff panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const bottomDrawer = screen.getByTestId('bottom-drawer')

      // Click Diff Viewer tab
      const diffTab = within(bottomDrawer).getByText('Diff Viewer')
      await user.click(diffTab)

      // DiffPanel should be visible
      expect(within(bottomDrawer).getByTestId('diff-panel')).toBeInTheDocument()

      // EditorPanel should not be visible
      expect(
        within(bottomDrawer).queryByTestId('editor-panel')
      ).not.toBeInTheDocument()
    })

    test('switching back to Editor tab hides Diff panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const bottomDrawer = screen.getByTestId('bottom-drawer')

      // Click Diff Viewer tab
      await user.click(within(bottomDrawer).getByText('Diff Viewer'))

      // Verify Diff is shown
      expect(within(bottomDrawer).getByTestId('diff-panel')).toBeInTheDocument()

      // Click Editor tab
      await user.click(within(bottomDrawer).getByText('Editor'))

      // Editor should be shown, Diff should be hidden
      expect(
        within(bottomDrawer).getByTestId('editor-panel')
      ).toBeInTheDocument()

      expect(
        within(bottomDrawer).queryByTestId('diff-panel')
      ).not.toBeInTheDocument()
    })

    test('active tab has correct visual styling', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const diffTab = within(bottomDrawer).getByText('Diff Viewer')

      // Click Diff Viewer tab
      await user.click(diffTab)

      // Diff tab should have active styling
      const diffButton = diffTab.closest('button')
      expect(diffButton).toHaveClass('text-primary')
      expect(diffButton).toHaveClass('border-b-2')
      expect(diffButton).toHaveClass('border-primary')
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

  describe('File open flow integration', () => {
    test('clicking file in FileExplorer loads file content in CodeEditor', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Find and click a file (auth.ts from mock data)
      const fileNode = within(sidebar).getByText('auth.ts')
      await user.click(fileNode)

      // Wait for the file to be loaded
      // The editor should no longer show "No file selected"
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')

          const noFileMessage =
            within(bottomDrawer).queryByText(/no file selected/i)

          expect(noFileMessage).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )
    })

    test('file path state updates when file is clicked', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file (logger.ts from mock data)
      const fileNode = within(sidebar).getByText('logger.ts')
      await user.click(fileNode)

      // The editor should be attempting to load content
      // We can't directly verify the file path without exposing internal state,
      // but we can verify the "no file selected" message is gone
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')

          const noFileMessage =
            within(bottomDrawer).queryByText(/no file selected/i)

          expect(noFileMessage).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )
    })

    test('isDirty starts as false after opening a file', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file (package.json from mock data)
      const fileNode = within(sidebar).getByText('package.json')
      await user.click(fileNode)

      // Wait for file to load
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')

          const noFileMessage =
            within(bottomDrawer).queryByText(/no file selected/i)

          expect(noFileMessage).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      // VimStatusBar should not show the [+] dirty indicator
      // The status bar is in the editor panel
      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')

      // Look for dirty indicator [+] in vim status bar
      const dirtyIndicator = within(editorPanel).queryByText('[+]')

      expect(dirtyIndicator).not.toBeInTheDocument()
    })
  })

  describe('Unsaved changes flow integration', () => {
    beforeEach(() => {
      // Mock CodeMirror hooks to control onChange callback
      vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockImplementation(
        createMockUseCodeMirror()
      )

      vi.spyOn(useVimModeModule, 'useVimMode').mockImplementation(
        createMockUseVimMode()
      )
    })

    test('editing content makes isDirty true and shows dirty indicator', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file to open it
      const fileNode = within(sidebar).getByText('auth.ts')
      await user.click(fileNode)

      // Wait for file to load
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')

          const noFileMessage =
            within(bottomDrawer).queryByText(/no file selected/i)
          expect(noFileMessage).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')

      // Initially no dirty indicator
      expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()

      // Simulate content change by calling the onChange callback
      // that was passed to useCodeMirror
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content')
        }
      })

      // Wait for the dirty indicator to appear
      await waitFor(() => {
        const dirtyIndicator = within(editorPanel).queryByText('[+]')
        expect(dirtyIndicator).toBeInTheDocument()
      })
    })

    test('clicking different file when dirty shows UnsavedChangesDialog', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Open first file
      const firstFile = within(sidebar).getByText('auth.ts')
      await user.click(firstFile)

      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      // Simulate editing content to make isDirty true
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content')
        }
      })

      // Wait for dirty state to update
      await waitFor(() => {
        const bottomDrawer = screen.getByTestId('bottom-drawer')
        const editorPanel = within(bottomDrawer).getByTestId('editor-panel')
        expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
      })

      // Try to click a different file
      const secondFile = within(sidebar).getByText('logger.ts')
      await user.click(secondFile)

      // The UnsavedChangesDialog should now be visible
      await waitFor(() => {
        expect(screen.getByText(/has unsaved changes/i)).toBeInTheDocument()
      })
    })

    test('UnsavedChangesDialog Save button saves file and opens new file', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Open first file
      const firstFile = within(sidebar).getByText('auth.ts')
      await user.click(firstFile)

      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      // Simulate editing to make isDirty true
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content')
        }
      })

      await waitFor(() => {
        const bottomDrawer = screen.getByTestId('bottom-drawer')
        const editorPanel = within(bottomDrawer).getByTestId('editor-panel')
        expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
      })

      // Click different file to trigger dialog
      const secondFile = within(sidebar).getByText('logger.ts')
      await user.click(secondFile)

      // Wait for dialog
      await waitFor(() => {
        expect(screen.getByText(/has unsaved changes/i)).toBeInTheDocument()
      })

      // Click Save button
      const saveButton = screen.getByRole('button', { name: /save/i })
      await user.click(saveButton)

      // Dialog should close
      await waitFor(() => {
        expect(
          screen.queryByText(/has unsaved changes/i)
        ).not.toBeInTheDocument()
      })

      // New file should be opened (no "No file selected" message)
      const bottomDrawer = screen.getByTestId('bottom-drawer')
      expect(
        within(bottomDrawer).queryByText(/no file selected/i)
      ).not.toBeInTheDocument()
    })

    test('UnsavedChangesDialog Discard button opens new file without saving', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Open first file
      const firstFile = within(sidebar).getByText('auth.ts')
      await user.click(firstFile)

      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      // Simulate editing
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content')
        }
      })

      await waitFor(() => {
        const bottomDrawer = screen.getByTestId('bottom-drawer')
        const editorPanel = within(bottomDrawer).getByTestId('editor-panel')
        expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
      })

      // Click different file
      const secondFile = within(sidebar).getByText('logger.ts')
      await user.click(secondFile)

      await waitFor(() => {
        expect(screen.getByText(/has unsaved changes/i)).toBeInTheDocument()
      })

      // Click Discard button
      const discardButton = screen.getByRole('button', { name: /discard/i })
      await user.click(discardButton)

      // Dialog should close
      await waitFor(() => {
        expect(
          screen.queryByText(/has unsaved changes/i)
        ).not.toBeInTheDocument()
      })

      // New file should be opened
      const bottomDrawer = screen.getByTestId('bottom-drawer')
      expect(
        within(bottomDrawer).queryByText(/no file selected/i)
      ).not.toBeInTheDocument()
    })

    test('UnsavedChangesDialog Cancel button stays on current file', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Open first file
      const firstFile = within(sidebar).getByText('auth.ts')
      await user.click(firstFile)

      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      // Simulate editing
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content')
        }
      })

      await waitFor(() => {
        const bottomDrawer = screen.getByTestId('bottom-drawer')
        const editorPanel = within(bottomDrawer).getByTestId('editor-panel')
        expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
      })

      // Click different file
      const secondFile = within(sidebar).getByText('logger.ts')
      await user.click(secondFile)

      await waitFor(() => {
        expect(screen.getByText(/has unsaved changes/i)).toBeInTheDocument()
      })

      // Click Cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      await user.click(cancelButton)

      // Dialog should close
      await waitFor(() => {
        expect(
          screen.queryByText(/has unsaved changes/i)
        ).not.toBeInTheDocument()
      })

      // Should still be on first file (dirty indicator still shown)
      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')
      expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
    })
  })

  describe('Vim save command integration', () => {
    beforeEach(() => {
      // Mock CodeMirror hooks to control onChange and onSave callbacks
      vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockImplementation(
        createMockUseCodeMirror()
      )

      vi.spyOn(useVimModeModule, 'useVimMode').mockImplementation(
        createMockUseVimMode()
      )
    })

    test('vim :w command saves file and clears dirty state', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file to open it
      const fileNode = within(sidebar).getByText('auth.ts')
      await user.click(fileNode)

      // Wait for file to load
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')

          const noFileMessage =
            within(bottomDrawer).queryByText(/no file selected/i)
          expect(noFileMessage).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')

      // Initially no dirty indicator
      expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()

      // Simulate content change by calling the onChange callback
      act(() => {
        if (mockOnChange) {
          mockOnChange('modified content for auth.ts')
        }
      })

      // Wait for the dirty indicator to appear
      await waitFor(() => {
        const dirtyIndicator = within(editorPanel).queryByText('[+]')
        expect(dirtyIndicator).toBeInTheDocument()
      })

      // Simulate vim :w command by calling the onSave callback
      act(() => {
        if (mockOnSave) {
          mockOnSave()
        }
      })

      // Wait for the dirty indicator to be removed
      await waitFor(() => {
        const dirtyIndicator = within(editorPanel).queryByText('[+]')
        expect(dirtyIndicator).not.toBeInTheDocument()
      })
    })

    test('vim :w command after editing updates dirty state correctly', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file to open it
      const fileNode = within(sidebar).getByText('logger.ts')
      await user.click(fileNode)

      // Wait for file to load
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')

      // Initially no dirty indicator
      expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()

      // Simulate content change to make dirty
      act(() => {
        if (mockOnChange) {
          mockOnChange('// Modified logger implementation')
        }
      })

      // Wait for dirty state
      await waitFor(() => {
        expect(within(editorPanel).getByText('[+]')).toBeInTheDocument()
      })

      // Simulate vim :w command
      act(() => {
        if (mockOnSave) {
          mockOnSave()
        }
      })

      // Verify dirty indicator is removed after save
      await waitFor(() => {
        expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()
      })
    })

    test('vim :w command on unmodified file does not change dirty state', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Wait for FileTree to load
      await waitFor(() => {
        expect(
          within(sidebar).getByRole('tree', { name: 'File tree' })
        ).toBeInTheDocument()
      })

      // Click a file to open it
      const fileNode = within(sidebar).getByText('package.json')
      await user.click(fileNode)

      // Wait for file to load
      await waitFor(
        () => {
          const bottomDrawer = screen.getByTestId('bottom-drawer')
          expect(
            within(bottomDrawer).queryByText(/no file selected/i)
          ).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )

      const bottomDrawer = screen.getByTestId('bottom-drawer')
      const editorPanel = within(bottomDrawer).getByTestId('editor-panel')

      // Initially no dirty indicator (file is unmodified)
      expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()

      // Simulate vim :w command on unmodified file
      act(() => {
        if (mockOnSave) {
          mockOnSave()
        }
      })

      // Dirty indicator should still not be present
      expect(within(editorPanel).queryByText('[+]')).not.toBeInTheDocument()
    })
  })
})
