import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { EditorView } from './EditorView'
import * as fileService from './services/fileService'

// Mock the file service module
vi.mock('./services/fileService', () => ({
  fetchFileTree: vi.fn(),
  fetchFileContent: vi.fn(),
}))

// Mock Shiki service to avoid loading real syntax highlighter
vi.mock('./services/shikiService', () => ({
  highlightCode: vi.fn((code: string) => {
    const lines = code.split('\n')

    return Promise.resolve(
      lines.map((lineContent) => ({
        tokens: [{ content: lineContent, color: '#cdd6f4' }],
      }))
    )
  }),
  detectLanguage: vi.fn((fileName: string) => {
    if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) {
      return 'typescript'
    }

    if (fileName.endsWith('.json')) {
      return 'json'
    }

    return 'plaintext'
  }),
}))

const mockFileTree = [
  {
    id: '1',
    name: 'src',
    type: 'folder' as const,
    defaultExpanded: true,
    children: [
      {
        id: '2',
        name: 'App.tsx',
        type: 'file' as const,
        icon: 'description',
      },
    ],
  },
]

describe('Panel Collapse Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock fetchFileTree to return test data
    vi.mocked(fileService.fetchFileTree).mockResolvedValue(mockFileTree)

    // Mock fetchFileContent
    vi.mocked(fileService.fetchFileContent).mockResolvedValue({
      content: 'export const App = () => <div>Hello</div>',
      language: 'typescript',
    })
  })

  test('clicking explorer collapse button toggles explorer pane visibility', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for file tree to load
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    // Find explorer pane (should be visible initially)
    const explorerPane = screen.getByTestId('explorer-pane')
    expect(explorerPane).toBeVisible()
    expect(explorerPane).not.toHaveClass('w-0')

    // Find and click the collapse button
    const collapseButton = screen.getByRole('button', {
      name: /collapse explorer/i,
    })
    await user.click(collapseButton)

    // Explorer pane should now be hidden (w-0 class)
    await waitFor(() => {
      expect(explorerPane).toHaveClass('w-0')
    })

    // Click again to expand
    const expandButton = screen.getByRole('button', {
      name: /expand explorer/i,
    })
    await user.click(expandButton)

    // Explorer pane should be visible again
    await waitFor(() => {
      expect(explorerPane).not.toHaveClass('w-0')
    })
  })

  test('clicking context panel dock button toggles context panel visibility', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    })

    // Find the dock toggle button in ContextPanel
    const dockButton = screen.getByRole('button', { name: /dock to right/i })
    await user.click(dockButton)

    // Verify the toggle callback was called
    expect(mockOnToggleContextPanel).toHaveBeenCalledTimes(1)
  })

  test('clicking collapse panel footer button toggles context panel visibility', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    })

    // Find the collapse panel button in footer
    const collapseButton = screen.getByRole('button', {
      name: /collapse panel/i,
    })
    await user.click(collapseButton)

    // Verify the toggle callback was called
    expect(mockOnToggleContextPanel).toHaveBeenCalledTimes(1)
  })

  test('context panel applies correct transform when collapsed', async () => {
    const mockOnToggleContextPanel = vi.fn()

    // Render with panel closed
    /* eslint-disable react/jsx-boolean-value */
    const { rerender } = render(
      <EditorView
        isContextPanelOpen={false}
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )
    /* eslint-enable react/jsx-boolean-value */

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    })

    const contextPanel = screen.getByTestId('context-panel')

    // When collapsed, panel should have translate-x-full class
    expect(contextPanel).toHaveClass('translate-x-full')

    // Re-render with panel open
    rerender(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // When open, panel should NOT have translate-x-full class
    await waitFor(() => {
      expect(contextPanel).not.toHaveClass('translate-x-full')
    })
  })

  test('main content area adjusts right margin when context panel toggles', async () => {
    const mockOnToggleContextPanel = vi.fn()

    // Render with panel open
    const { rerender } = render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('editor-main-content')).toBeInTheDocument()
    })

    const mainContent = screen.getByTestId('editor-main-content')

    // When panel is open, main content should have mr-[280px] class
    expect(mainContent).toHaveClass('mr-[280px]')

    // Re-render with panel closed
    /* eslint-disable react/jsx-boolean-value */
    rerender(
      <EditorView
        isContextPanelOpen={false}
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )
    /* eslint-enable react/jsx-boolean-value */

    // When panel is closed, main content should have mr-0 class
    await waitFor(() => {
      expect(mainContent).toHaveClass('mr-0')
    })
  })

  test('editor status bar adjusts right position when context panel toggles', async () => {
    const mockOnToggleContextPanel = vi.fn()

    // Render with panel open
    const { rerender } = render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('editor-status-bar')).toBeInTheDocument()
    })

    const statusBar = screen.getByTestId('editor-status-bar')

    // When panel is open, status bar should have right-[280px] class
    expect(statusBar).toHaveClass('right-[280px]')

    // Re-render with panel closed
    /* eslint-disable react/jsx-boolean-value */
    rerender(
      <EditorView
        isContextPanelOpen={false}
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )
    /* eslint-enable react/jsx-boolean-value */

    // When panel is closed, status bar should have right-0 class
    await waitFor(() => {
      expect(statusBar).toHaveClass('right-0')
    })
  })

  test('transitions have correct duration class (300ms)', async () => {
    const mockOnToggleContextPanel = vi.fn()

    render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for components to render
    await waitFor(() => {
      expect(screen.getByTestId('editor-main-content')).toBeInTheDocument()
    })

    const mainContent = screen.getByTestId('editor-main-content')
    const statusBar = screen.getByTestId('editor-status-bar')
    const contextPanel = screen.getByTestId('context-panel')
    const explorerPane = screen.getByTestId('explorer-pane')

    expect(statusBar).toBeInTheDocument()
    expect(contextPanel).toBeInTheDocument()
    expect(explorerPane).toBeInTheDocument()

    // Verify all animated elements have transition-all and duration-300
    expect(mainContent).toHaveClass('transition-all')
    expect(mainContent).toHaveClass('duration-300')

    expect(statusBar).toHaveClass('transition-all')
    expect(statusBar).toHaveClass('duration-300')

    expect(contextPanel).toHaveClass('transition-all')
    expect(contextPanel).toHaveClass('duration-300')

    expect(explorerPane).toHaveClass('transition-all')
    expect(explorerPane).toHaveClass('duration-300')
  })

  test('explorer pane collapse state persists independently of context panel state', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('explorer-pane')).toBeInTheDocument()
    })

    const explorerPane = screen.getByTestId('explorer-pane')

    // Collapse explorer pane
    const collapseButton = screen.getByRole('button', {
      name: /collapse explorer/i,
    })
    await user.click(collapseButton)

    await waitFor(() => {
      expect(explorerPane).toHaveClass('w-0')
    })

    // Toggle context panel (should not affect explorer state)
    const dockButton = screen.getByRole('button', { name: /dock to right/i })
    await user.click(dockButton)

    // Explorer should still be collapsed
    expect(explorerPane).toHaveClass('w-0')
  })

  test('context panel collapse state is controlled by parent props', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    // Render with panel open
    const { rerender } = render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('context-panel')).toBeInTheDocument()
    })

    const contextPanel = screen.getByTestId('context-panel')

    // Panel should be visible (no translate-x-full)
    expect(contextPanel).not.toHaveClass('translate-x-full')

    // Click dock button
    const dockButton = screen.getByRole('button', { name: /dock to right/i })
    await user.click(dockButton)

    // Callback should be called
    expect(mockOnToggleContextPanel).toHaveBeenCalledTimes(1)

    // Panel state doesn't change until parent re-renders with new props
    expect(contextPanel).not.toHaveClass('translate-x-full')

    // Parent updates props
    /* eslint-disable react/jsx-boolean-value */
    rerender(
      <EditorView
        isContextPanelOpen={false}
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )
    /* eslint-enable react/jsx-boolean-value */

    // Now panel should be collapsed
    await waitFor(() => {
      expect(contextPanel).toHaveClass('translate-x-full')
    })
  })

  test('all panel transitions occur smoothly without layout shift', async () => {
    const user = userEvent.setup()
    const mockOnToggleContextPanel = vi.fn()

    const { rerender } = render(
      <EditorView
        isContextPanelOpen
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('explorer-pane')).toBeInTheDocument()
    })

    const explorerPane = screen.getByTestId('explorer-pane')
    const contextPanel = screen.getByTestId('context-panel')
    const mainContent = screen.getByTestId('editor-main-content')
    const statusBar = screen.getByTestId('editor-status-bar')

    expect(contextPanel).toBeInTheDocument()
    expect(mainContent).toBeInTheDocument()
    expect(statusBar).toBeInTheDocument()

    // Verify overflow-hidden on explorer (prevents layout shift)
    expect(explorerPane).toHaveClass('overflow-hidden')

    // Collapse explorer pane
    const collapseButton = screen.getByRole('button', {
      name: /collapse explorer/i,
    })
    await user.click(collapseButton)

    // Verify smooth transition classes remain applied
    await waitFor(() => {
      expect(explorerPane).toHaveClass('transition-all')
    })
    expect(explorerPane).toHaveClass('w-0')
    expect(explorerPane).toHaveClass('duration-300')

    // Toggle context panel
    /* eslint-disable react/jsx-boolean-value */
    rerender(
      <EditorView
        isContextPanelOpen={false}
        onToggleContextPanel={mockOnToggleContextPanel}
      />
    )
    /* eslint-enable react/jsx-boolean-value */

    // Verify smooth transition classes remain applied
    await waitFor(() => {
      expect(contextPanel).toHaveClass('translate-x-full')
    })

    expect(contextPanel).toHaveClass('transition-all')
    expect(contextPanel).toHaveClass('duration-300')
    expect(mainContent).toHaveClass('transition-all')
    expect(statusBar).toHaveClass('transition-all')
  })
})
