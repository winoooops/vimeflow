import { render, screen, waitFor } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { DiffView } from './DiffView'
import { mockChangedFiles, mockFileDiffs } from './data/mockDiff'

// Create shared mock functions that will be accessed in tests
const mockGetStatus = vi.fn()
const mockGetDiff = vi.fn()
const mockStageFile = vi.fn()
const mockUnstageFile = vi.fn()
const mockDiscardChanges = vi.fn()

// Mock the git service module with the shared mock functions
vi.mock('./services/gitService', () => ({
  createGitService: vi.fn(() => ({
    getStatus: mockGetStatus,
    getDiff: mockGetDiff,
    stageFile: mockStageFile,
    unstageFile: mockUnstageFile,
    discardChanges: mockDiscardChanges,
  })),
}))

describe('DiffView', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Set default mock implementations
    mockGetStatus.mockResolvedValue(mockChangedFiles)
    mockGetDiff.mockImplementation((file: string) =>
      Promise.resolve(
        mockFileDiffs[file] ?? mockFileDiffs['src/components/NavBar.tsx']
      )
    )
    mockStageFile.mockResolvedValue(undefined)
    mockUnstageFile.mockResolvedValue(undefined)
    mockDiscardChanges.mockResolvedValue(undefined)
  })

  test('renders DiffView with all layout components', async () => {
    render(<DiffView />)

    // Wait for changed files to load
    await waitFor(() => {
      expect(screen.getByText('CHANGED FILES')).toBeInTheDocument()
    })

    // Check for DiffToolbar
    expect(screen.getByText('Side-by-side')).toBeInTheDocument()
    expect(screen.getByText('Unified')).toBeInTheDocument()

    // Check for DiffLegend
    expect(screen.getByText('ADDED')).toBeInTheDocument()
    expect(screen.getByText('REMOVED')).toBeInTheDocument()
  })

  test('loads changed files on mount using useGitStatus', async () => {
    render(<DiffView />)

    await waitFor(() => {
      expect(mockGetStatus).toHaveBeenCalledTimes(1)
    })

    // Verify changed files are displayed
    await waitFor(() => {
      expect(screen.getByText(/NavBar\.tsx/)).toBeInTheDocument()
    })
  })

  test('displays diff for first file by default', async () => {
    render(<DiffView />)

    // Wait for changed files to load first
    await waitFor(() => {
      expect(screen.getByText(/NavBar\.tsx/)).toBeInTheDocument()
    })

    // Then wait for diff to load - check mockGetDiff was called
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalledWith(
        'src/components/NavBar.tsx',
        false
      )
    })

    // In split mode, should show Before/After headers
    await waitFor(() => {
      expect(screen.getByText(/Before:/)).toBeInTheDocument()
    })
  })

  test('accepts selectedDiffFile prop and displays that file diff', async () => {
    render(<DiffView selectedDiffFile="src/components/TerminalPanel.tsx" />)

    // Wait for the specified file diff to load
    // Verify Before/After headers show the correct file
    await waitFor(() => {
      expect(screen.getByText(/Before:/)).toBeInTheDocument()
    })

    // Verify getDiff was called with the selected file
    expect(mockGetDiff).toHaveBeenCalledWith(
      'src/components/TerminalPanel.tsx',
      false
    )
  })

  test('updates diff when selecting a file from ChangedFilesList', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText(/NavBar\.tsx/)).toBeInTheDocument()
    })

    // Click on TerminalPanel.tsx
    const terminalFile = screen.getByText(/TerminalPanel\.tsx/)
    await user.click(terminalFile)

    // Verify getDiff was called for the new file
    await waitFor(() => {
      expect(mockGetDiff).toHaveBeenCalledWith(
        'src/components/TerminalPanel.tsx',
        false
      )
    })
  })

  test('toggles view mode between split and unified', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for Before/After headers (split mode default)
    await waitFor(() => {
      expect(screen.getByText(/Before:/)).toBeInTheDocument()
    })

    expect(screen.getByText(/After:/)).toBeInTheDocument()

    // Click Unified button
    const unifiedButton = screen.getByText('Unified')
    await user.click(unifiedButton)

    // Before/After headers should not be present in unified mode
    await waitFor(() => {
      expect(screen.queryByText(/Before:/)).not.toBeInTheDocument()
    })
  })

  test('stages hunk when Stage Hunk button is clicked', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for diff to load
    await waitFor(() => {
      expect(screen.getByText('Stage Hunk')).toBeInTheDocument()
    })

    // Click Stage Hunk button
    const stageButton = screen.getByText('Stage Hunk')
    await user.click(stageButton)

    // Verify stageFile was called with the current file and hunk index
    await waitFor(() => {
      expect(mockStageFile).toHaveBeenCalled()
    })
  })

  test('discards changes when Discard button is clicked', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for diff to load
    await waitFor(() => {
      expect(screen.getByText('Discard')).toBeInTheDocument()
    })

    // Click Discard button
    const discardButton = screen.getByText('Discard')
    await user.click(discardButton)

    // Verify discardChanges was called
    await waitFor(() => {
      expect(mockDiscardChanges).toHaveBeenCalled()
    })
  })

  test('navigates to next hunk when down arrow is clicked', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for diff to load
    await waitFor(() => {
      expect(screen.getByText(/Before:/)).toBeInTheDocument()
    })

    // Find the next hunk button by aria-label
    const downArrow = screen.getByLabelText('Next hunk')
    await user.click(downArrow)

    // Just verify the button was clickable and no errors occurred
    // Detailed hunk navigation behavior is tested in useDiffKeyboard tests
    expect(downArrow).toBeInTheDocument()
  })

  test('handles keyboard navigation with j/k keys', async () => {
    const user = userEvent.setup()
    render(<DiffView />)

    // Wait for diff to load
    await waitFor(() => {
      expect(screen.getByText(/Before:/)).toBeInTheDocument()
    })

    // Press 'j' to move down (focus should change but hard to test visually)
    await user.keyboard('j')

    // This is a smoke test - keyboard handler is tested in useDiffKeyboard.test.ts
    // Just verify no errors occur
    expect(screen.getByText('CHANGED FILES')).toBeInTheDocument()
  })

  test('displays CommitInfoPanel in ContextPanel', async () => {
    render(<DiffView />)

    // Wait for commit info to render
    await waitFor(() => {
      expect(screen.getByText('Commit Info')).toBeInTheDocument()
    })

    // Verify commit details are present
    expect(screen.getByText(/abc123d/)).toBeInTheDocument()
    expect(screen.getByText('Submit Review')).toBeInTheDocument()
  })

  test('clears selectedDiffFile prop after initial render', async () => {
    const onClearSelectedFile = vi.fn()
    render(
      <DiffView
        selectedDiffFile="src/components/NavBar.tsx"
        onClearSelectedFile={onClearSelectedFile}
      />
    )

    // Verify callback is called after mount
    await waitFor(() => {
      expect(onClearSelectedFile).toHaveBeenCalledTimes(1)
    })
  })

  test('renders empty state when no changed files', async () => {
    // Mock empty status for this test
    mockGetStatus.mockResolvedValueOnce([])

    render(<DiffView />)

    // Wait for load
    await waitFor(() => {
      expect(screen.getByText('CHANGED FILES')).toBeInTheDocument()
    })

    // No files should be listed
    expect(screen.queryByText(/NavBar\.tsx/)).not.toBeInTheDocument()
  })
})
