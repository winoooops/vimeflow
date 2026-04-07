import { render, screen, within } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import FilesChanged from './FilesChanged'
import type { FileChange } from '../../types'

const mockFileChanges: FileChange[] = [
  {
    id: 'fc-1',
    path: 'src/auth/middleware.ts',
    type: 'new',
    linesAdded: 48,
    linesRemoved: 0,
    timestamp: '2026-04-07T03:46:15Z',
  },
  {
    id: 'fc-2',
    path: 'src/auth/types.ts',
    type: 'modified',
    linesAdded: 12,
    linesRemoved: 3,
    timestamp: '2026-04-07T03:47:02Z',
  },
  {
    id: 'fc-3',
    path: 'test/old-feature.ts',
    type: 'deleted',
    linesAdded: 0,
    linesRemoved: 25,
    timestamp: '2026-04-07T03:47:28Z',
  },
]

describe('FilesChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    test('renders CollapsibleSection with "Files Changed" title', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
    })

    test('shows count of file changes in section header', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('(3)')).toBeInTheDocument()
    })

    test('is expanded by default', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(screen.queryByText('▸')).not.toBeInTheDocument()
    })

    test('renders all file changes when expanded', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('src/auth/middleware.ts')).toBeInTheDocument()
      expect(screen.getByText('src/auth/types.ts')).toBeInTheDocument()
      expect(screen.getByText('test/old-feature.ts')).toBeInTheDocument()
    })

    test('renders empty state with count of 0', () => {
      render(<FilesChanged fileChanges={[]} />)

      expect(screen.getByText('Files Changed')).toBeInTheDocument()
      expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument()
    })
  })

  describe('Change Type Indicators', () => {
    test('renders "+" prefix for new files with green color', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileEntries = screen.getAllByTestId('file-entry')
      const newFileEntry = fileEntries[0]
      const prefix = within(newFileEntry).getByTestId('change-prefix')

      expect(prefix).toHaveTextContent('+')
      expect(prefix).toHaveClass('text-success')
    })

    test('renders "~" prefix for modified files with purple color', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileEntries = screen.getAllByTestId('file-entry')
      const modifiedFileEntry = fileEntries[1]
      const prefix = within(modifiedFileEntry).getByTestId('change-prefix')

      expect(prefix).toHaveTextContent('~')
      expect(prefix).toHaveClass('text-primary')
    })

    test('renders "-" prefix for deleted files with red color', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileEntries = screen.getAllByTestId('file-entry')
      const deletedFileEntry = fileEntries[2]
      const prefix = within(deletedFileEntry).getByTestId('change-prefix')

      expect(prefix).toHaveTextContent('-')
      expect(prefix).toHaveClass('text-error')
    })
  })

  describe('Line Diff Summary', () => {
    test('shows "+X" for new files (only additions)', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('+48')).toBeInTheDocument()
    })

    test('shows "+X -Y" for modified files', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('+12 -3')).toBeInTheDocument()
    })

    test('shows "-Y" for deleted files (only deletions)', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('-25')).toBeInTheDocument()
    })

    test('applies muted text color to line diff summaries', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const diffSummary = screen.getByText('+48')

      expect(diffSummary).toHaveClass('text-on-surface/60')
    })
  })

  describe('Interaction', () => {
    test('toggles collapsed when chevron clicked', async () => {
      const user = userEvent.setup()

      render(<FilesChanged fileChanges={mockFileChanges} />)

      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(screen.getByText('src/auth/middleware.ts')).toBeInTheDocument()

      const sectionHeader = screen.getByRole('button', {
        name: /Files Changed/i,
      })

      await user.click(sectionHeader)

      expect(screen.getByText('▸')).toBeInTheDocument()
      expect(
        screen.queryByText('src/auth/middleware.ts')
      ).not.toBeInTheDocument()
    })

    test('toggles expanded when clicking collapsed section', async () => {
      const user = userEvent.setup()

      render(<FilesChanged fileChanges={mockFileChanges} />)

      const sectionHeader = screen.getByRole('button', {
        name: /Files Changed/i,
      })

      await user.click(sectionHeader)
      expect(screen.getByText('▸')).toBeInTheDocument()

      await user.click(sectionHeader)
      expect(screen.getByText('▾')).toBeInTheDocument()
      expect(screen.getByText('src/auth/middleware.ts')).toBeInTheDocument()
    })
  })

  describe('Layout and Styling', () => {
    test('applies proper spacing between file entries', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileList = screen.getByTestId('files-list')

      expect(fileList).toHaveClass('gap-2')
    })

    test('applies flex layout to file entries', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileList = screen.getByTestId('files-list')

      expect(fileList).toHaveClass('flex')
      expect(fileList).toHaveClass('flex-col')
    })

    test('uses font-label for text', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const fileEntry = screen.getAllByTestId('file-entry')[0]

      expect(fileEntry).toHaveClass('font-label')
    })

    test('applies proper text color to file paths', () => {
      render(<FilesChanged fileChanges={mockFileChanges} />)

      const filePath = screen.getByText('src/auth/middleware.ts')

      expect(filePath).toHaveClass('text-on-surface')
    })
  })

  describe('Edge Cases', () => {
    test('handles single file change', () => {
      const singleChange: FileChange[] = [mockFileChanges[0]]

      render(<FilesChanged fileChanges={singleChange} />)

      expect(screen.getByText('(1)')).toBeInTheDocument()
      expect(screen.getByText('src/auth/middleware.ts')).toBeInTheDocument()
    })

    test('handles file with zero lines changed (edge case)', () => {
      const zeroChange: FileChange[] = [
        {
          id: 'fc-edge',
          path: 'README.md',
          type: 'modified',
          linesAdded: 0,
          linesRemoved: 0,
          timestamp: '2026-04-07T03:48:00Z',
        },
      ]

      render(<FilesChanged fileChanges={zeroChange} />)

      expect(screen.getByText('README.md')).toBeInTheDocument()
      expect(screen.queryByText(/\+0|-0/)).not.toBeInTheDocument()
    })
  })
})
