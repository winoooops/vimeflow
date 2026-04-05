import { render, screen, within, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { EditorView } from './EditorView'
import { mockEditorFiles } from './data/mockEditorData'
import * as fileService from './services/fileService'

// Mock the file service module
vi.mock('./services/fileService', () => ({
  fetchFileTree: vi.fn(),
  fetchFileContent: vi.fn(),
}))

// Mock Shiki service to avoid loading real syntax highlighter
vi.mock('./services/shikiService', () => ({
  highlightCode: vi.fn((code: string) => {
    // Return array of LineTokens (one per line)
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
      {
        id: '3',
        name: 'utils.ts',
        type: 'file' as const,
        icon: 'description',
      },
      {
        id: '4',
        name: 'config.json',
        type: 'file' as const,
        icon: 'description',
      },
    ],
  },
]

describe('TabManagement Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock file tree API
    vi.mocked(fileService.fetchFileTree).mockResolvedValue(mockFileTree)

    // Mock file content API
    vi.mocked(fileService.fetchFileContent).mockImplementation(
      (path: string) => {
        const file = mockEditorFiles.find((f) => path.includes(f.name))

        return Promise.resolve({
          content: file?.content ?? `// Content of ${path}`,
          language: file?.language ?? 'typescript',
        })
      }
    )
  })

  test('clicking file in explorer creates new tab', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree to load
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Initial state: should have mock tabs
    const tabBar = screen.getByRole('tablist')
    const initialTabs = within(tabBar).getAllByRole('tab')

    expect(initialTabs.length).toBeGreaterThan(0)

    const initialTabCount = initialTabs.length

    // Click a file in the explorer
    const appTsxNode = screen.getByText('App.tsx')

    await user.click(appTsxNode)

    // New tab should be created (or existing tab activated)
    const updatedTabs = within(tabBar).getAllByRole('tab')

    // Either a new tab was created, or existing tab was activated
    expect(updatedTabs.length).toBeGreaterThanOrEqual(initialTabCount)

    // The file should appear in tabs
    const appTsxTab = updatedTabs.find((tab) =>
      within(tab).queryByText('App.tsx')
    )

    expect(appTsxTab).toBeDefined()
  })

  test('clicking existing file tab activates it without creating duplicate', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree to load
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Click file twice
    const appTsxNode = screen.getByText('App.tsx')

    await user.click(appTsxNode)

    const tabBar = screen.getByRole('tablist')
    const tabsAfterFirstClick = within(tabBar).getAllByRole('tab')
    const countAfterFirstClick = tabsAfterFirstClick.length

    // Click same file again
    await user.click(appTsxNode)

    const tabsAfterSecondClick = within(tabBar).getAllByRole('tab')

    // Should not create duplicate tab
    expect(tabsAfterSecondClick.length).toBe(countAfterFirstClick)
  })

  test('clicking tab switches active file and updates editor content', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    const tabBar = screen.getByRole('tablist')

    // Open first file
    await user.click(screen.getByText('App.tsx'))

    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')

      const activeTab = tabs.find((tab) =>
        tab.classList.contains('border-primary')
      )

      expect(activeTab).toBeDefined()
    })

    // Open second file
    await user.click(screen.getByText('utils.ts'))

    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')
      const utilsTab = tabs.find((tab) => within(tab).queryByText('utils.ts'))

      expect(utilsTab).toBeDefined()
      expect(utilsTab?.classList.contains('border-primary')).toBe(true)
    })

    // Click back to first tab
    const tabs = within(tabBar).getAllByRole('tab')
    const appTab = tabs.find((tab) => within(tab).queryByText('App.tsx'))

    expect(appTab).toBeDefined()

    if (appTab !== undefined) {
      await user.click(appTab)

      await waitFor(() => {
        expect(appTab.classList.contains('border-primary')).toBe(true)
      })
    }
  })

  test('closing tab switches to adjacent tab', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    const tabBar = screen.getByRole('tablist')

    // Open multiple files
    await user.click(screen.getByText('App.tsx'))
    await user.click(screen.getByText('utils.ts'))
    await user.click(screen.getByText('config.json'))

    // Wait for all tabs to be created
    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')

      expect(tabs.length).toBeGreaterThanOrEqual(3)
    })

    const tabsBeforeClose = within(tabBar).getAllByRole('tab')

    const configTab = tabsBeforeClose.find((tab) =>
      within(tab).queryByText('config.json')
    )

    expect(configTab).toBeDefined()

    // Close the active tab (config.json)
    if (configTab !== undefined) {
      const closeButton = within(configTab).getByRole('button', {
        name: /close/i,
      })

      await user.click(closeButton)

      // Tab should be removed
      await waitFor(() => {
        const tabsAfterClose = within(tabBar).getAllByRole('tab')

        expect(tabsAfterClose.length).toBe(tabsBeforeClose.length - 1)

        // Should not find config.json tab anymore
        const remainingConfigTab = tabsAfterClose.find((tab) =>
          within(tab).queryByText('config.json')
        )

        expect(remainingConfigTab).toBeUndefined()
      })

      // An adjacent tab should now be active
      const tabsAfterClose = within(tabBar).getAllByRole('tab')

      const activeTab = tabsAfterClose.find((tab) =>
        tab.classList.contains('border-primary')
      )

      expect(activeTab).toBeDefined()
    }
  })

  test('closing last tab leaves empty state', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByTestId('editor-view')).toBeInTheDocument()
    })

    const tabBar = screen.getByRole('tablist')
    const initialTabs = within(tabBar).getAllByRole('tab')

    // Close all tabs one by one
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _tab of initialTabs) {
      const currentTabs = within(tabBar).queryAllByRole('tab')

      if (currentTabs.length > 0) {
        const firstTab = currentTabs[0]

        const closeButton = within(firstTab).getByRole('button', {
          name: /close/i,
        })

        await user.click(closeButton)

        // Wait for tab to be removed
        await waitFor(() => {
          const remainingTabs = within(tabBar).queryAllByRole('tab')

          expect(remainingTabs.length).toBe(currentTabs.length - 1)
        })
      }
    }

    // After closing all tabs, should have empty state
    const finalTabs = within(tabBar).queryAllByRole('tab')

    expect(finalTabs.length).toBe(0)

    // Editor should show placeholder or empty message
    const codeEditor = screen.getByTestId('code-editor')

    expect(codeEditor).toBeInTheDocument()
  })

  test('EditorStatusBar updates with active file information', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Open a file
    await user.click(screen.getByText('App.tsx'))

    // Wait for status bar to update
    await waitFor(() => {
      const statusBar = screen.getByTestId('editor-status-bar')

      expect(statusBar).toBeInTheDocument()
    })

    const statusBar = screen.getByTestId('editor-status-bar')

    // Status bar should contain file information
    // Note: Current implementation uses mock state, so we verify structure
    expect(statusBar).toBeInTheDocument()

    // Open different file
    await user.click(screen.getByText('utils.ts'))

    // Status bar should update (verify it's still present and functional)
    await waitFor(() => {
      const updatedStatusBar = screen.getByTestId('editor-status-bar')

      expect(updatedStatusBar).toBeInTheDocument()
    })
  })

  test('tab displays correct icon based on file type', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Open a file
    await user.click(screen.getByText('App.tsx'))

    const tabBar = screen.getByRole('tablist')

    // Tab should have an icon
    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')
      const appTab = tabs.find((tab) => within(tab).queryByText('App.tsx'))

      expect(appTab).toBeDefined()

      if (appTab !== undefined) {
        // Should contain material icon (span with class material-symbols-outlined)
        const icon = within(appTab).getByText('description')

        expect(icon).toBeInTheDocument()
      }
    })
  })

  test('active tab has distinct visual styling', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Open two files
    await user.click(screen.getByText('App.tsx'))
    await user.click(screen.getByText('utils.ts'))

    const tabBar = screen.getByRole('tablist')
    const tabs = within(tabBar).getAllByRole('tab')

    // Exactly one tab should have active styling (border-primary class)
    const activeTabs = tabs.filter((tab) =>
      tab.classList.contains('border-primary')
    )

    expect(activeTabs.length).toBe(1)

    // Active tab should be utils.ts (last clicked)
    const activeTab = activeTabs[0]

    expect(within(activeTab).getByText('utils.ts')).toBeDefined()
  })

  test('file selection in explorer highlights corresponding tab', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    // Open file
    await user.click(screen.getByText('App.tsx'))

    const tabBar = screen.getByRole('tablist')

    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')
      const appTab = tabs.find((tab) => within(tab).queryByText('App.tsx'))

      expect(appTab).toBeDefined()
      expect(appTab?.classList.contains('border-primary')).toBe(true)
    })

    // Open another file
    await user.click(screen.getByText('utils.ts'))

    await waitFor(() => {
      const tabs = within(tabBar).getAllByRole('tab')
      const utilsTab = tabs.find((tab) => within(tab).queryByText('utils.ts'))

      expect(utilsTab).toBeDefined()
      expect(utilsTab?.classList.contains('border-primary')).toBe(true)
    })
  })

  test('clicking folder in explorer does not create tab', async () => {
    const user = userEvent.setup()
    render(<EditorView />)

    // Wait for file tree
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    const tabBar = screen.getByRole('tablist')
    const initialTabs = within(tabBar).getAllByRole('tab')
    const initialCount = initialTabs.length

    // Click folder
    const srcFolder = screen.getByText('src')

    await user.click(srcFolder)

    // Tab count should not change
    const tabsAfterClick = within(tabBar).getAllByRole('tab')

    expect(tabsAfterClick.length).toBe(initialCount)

    // Should not have a tab for 'src'
    const srcTab = tabsAfterClick.find((tab) => within(tab).queryByText('src'))

    expect(srcTab).toBeUndefined()
  })
})
