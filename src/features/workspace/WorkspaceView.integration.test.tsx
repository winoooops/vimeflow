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

// Mock useAgentStatus so AgentStatusPanel renders predictably
vi.mock('../agent-status/hooks/useAgentStatus', () => ({
  useAgentStatus: vi.fn(() => ({
    isActive: true,
    agentType: 'claude-code',
    modelId: null,
    modelDisplayName: null,
    version: null,
    sessionId: null,
    agentSessionId: null,
    contextWindow: null,
    cost: null,
    rateLimits: null,
    toolCalls: { total: 0, byType: {}, active: null },
    recentToolCalls: [],
  })),
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

    test('clicking session updates agent status panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')

      // Get all session buttons from session list
      const sessionList = within(sidebar).getByTestId('session-list')
      const sessionButtons = within(sessionList).getAllByRole('button')

      expect(sessionButtons.length).toBeGreaterThan(1)

      // Click second session button
      await user.click(sessionButtons[1])

      // Agent Status Panel should be present (content comes in sub-specs 5-7)
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
    })

    test('session switch synchronizes terminal and status panel', async (): Promise<void> => {
      const user = userEvent.setup()
      render(<WorkspaceView />)

      const sidebar = screen.getByTestId('sidebar')
      const terminalZone = screen.getByTestId('terminal-zone')

      // Click a session
      const sessionList = within(sidebar).getByTestId('session-list')
      const sessionButtons = within(sessionList).getAllByRole('button')

      await user.click(sessionButtons[0])

      // Terminal should update
      const tabBar = within(terminalZone).getByTestId('tab-bar')

      const sessionTabs = within(tabBar).getAllByRole('button', {
        name: /^🤖/,
      })

      expect(sessionTabs.length).toBeGreaterThan(0)

      // Agent Status Panel should be present
      expect(screen.getByTestId('agent-status-panel')).toBeInTheDocument()
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

  describe('Agent Status Panel shell', () => {
    test('panel renders as empty shell (child sections in sub-specs 5-7)', () => {
      render(<WorkspaceView />)

      const panel = screen.getByTestId('agent-status-panel')

      expect(panel).toBeInTheDocument()
      // Panel is a shell — collapsible sections will be added in sub-specs 5-7
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
