import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangedFile } from '../../diff/types'
import { FilesChanged } from './FilesChanged'

const mockFiles: ChangedFile[] = [
  {
    path: 'src/components/App.tsx',
    status: 'added',
    insertions: 45,
    deletions: 0,
    staged: true,
  },
  {
    path: 'src/utils/helpers.ts',
    status: 'modified',
    insertions: 12,
    deletions: 3,
    staged: false,
  },
  {
    path: 'src/old/legacy.ts',
    status: 'deleted',
    insertions: 0,
    deletions: 18,
    staged: false,
  },
]

describe('FilesChanged', () => {
  describe('empty states', () => {
    test('shows "No uncommitted changes" when empty and not loading', (): void => {
      render(
        <FilesChanged
          files={[]}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('No uncommitted changes')).toBeInTheDocument()
    })

    test('shows "Loading..." when empty and loading', (): void => {
      render(
        <FilesChanged
          files={[]}
          loading
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    test('shows error message and retry button when empty with error', async (): Promise<void> => {
      const onRetry = vi.fn()
      const user = userEvent.setup()
      const error = new Error('Git command failed')

      render(
        <FilesChanged
          files={[]}
          error={error}
          onRetry={onRetry}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('Failed to load git status')).toBeInTheDocument()

      const retryButton = screen.getByRole('button', { name: /retry/i })
      expect(retryButton).toBeInTheDocument()

      await user.click(retryButton)
      expect(onRetry).toHaveBeenCalledOnce()
    })
  })

  describe('populated states', () => {
    test('renders file list when loading is true but files exist (stale data)', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          loading
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // Section starts expanded (defaultExpanded)
      expect(screen.getByText('src/components/App.tsx')).toBeInTheDocument()
      expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument()
      expect(screen.getByText('src/old/legacy.ts')).toBeInTheDocument()

      // No need to click to expand (already expanded)
      // Count is shown
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    test('shows error banner when error is set but files exist', (): void => {
      const error = new Error('Refresh failed')

      render(
        <FilesChanged
          files={mockFiles}
          error={error}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      const banner = screen.getByRole('alert')
      expect(banner).toBeInTheDocument()
      expect(banner).toHaveTextContent('Stale data — refresh failed')
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

      // Files are still shown
      expect(screen.getByText('src/components/App.tsx')).toBeInTheDocument()
    })

    test('retry button in banner calls onRetry', async (): Promise<void> => {
      const onRetry = vi.fn()
      const user = userEvent.setup()
      const error = new Error('Failed')

      render(
        <FilesChanged
          files={mockFiles}
          error={error}
          onRetry={onRetry}
          onSelect={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /retry/i }))
      expect(onRetry).toHaveBeenCalledOnce()
    })
  })

  describe('file row rendering', () => {
    test('clicking a file row calls onSelect with the ChangedFile', async (): Promise<void> => {
      const onSelect = vi.fn()
      const user = userEvent.setup()

      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={onSelect}
        />
      )

      await user.click(screen.getByText('src/utils/helpers.ts'))

      expect(onSelect).toHaveBeenCalledOnce()
      expect(onSelect).toHaveBeenCalledWith(mockFiles[1])
    })

    test('renders correct prefix symbols for each status', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // added → +
      expect(screen.getByText('+')).toBeInTheDocument()
      // modified → ~
      expect(screen.getByText('~')).toBeInTheDocument()
      // deleted → -
      expect(screen.getByText('-')).toBeInTheDocument()
    })

    test('renders correct badges for each status', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('NEW')).toBeInTheDocument()
      expect(screen.getByText('EDIT')).toBeInTheDocument()
      expect(screen.getByText('DEL')).toBeInTheDocument()
    })

    test('renders +N / -N when both insertions and deletions are numbers', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('+45 / -0')).toBeInTheDocument()
      expect(screen.getByText('+12 / -3')).toBeInTheDocument()
      expect(screen.getByText('+0 / -18')).toBeInTheDocument()
    })

    test('does not render +N / -N when insertions or deletions are undefined', (): void => {
      // cspell:disable-next-line -- numstat is a git term
      const filesWithoutNumstat: ChangedFile[] = [
        {
          path: 'binary-file.png',
          status: 'modified',
          staged: false,
          // No insertions/deletions (binary file)
        },
      ]

      render(
        <FilesChanged
          // cspell:disable-next-line -- numstat is a git term
          files={filesWithoutNumstat}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // Should not render +N / -N
      expect(screen.queryByText(/\+\d+ \/ -\d+/)).not.toBeInTheDocument()
    })

    test('renders STAGED label for staged files', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // Only one file is staged (App.tsx)
      expect(screen.getByText('STAGED')).toBeInTheDocument()

      // Count of STAGED labels should be 1
      const stagedLabels = screen.getAllByText('STAGED')
      expect(stagedLabels).toHaveLength(1)
    })

    test('does not render STAGED label for unstaged files', (): void => {
      const unstagedFiles: ChangedFile[] = [
        {
          path: 'src/test.ts',
          status: 'modified',
          insertions: 5,
          deletions: 2,
          staged: false,
        },
      ]

      render(
        <FilesChanged
          files={unstagedFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.queryByText('STAGED')).not.toBeInTheDocument()
    })
  })

  describe('MM/AM disambiguation', () => {
    test('renders two rows for files with same path but different staged flags', async (): Promise<void> => {
      const mmFiles: ChangedFile[] = [
        {
          path: 'src/both.ts',
          status: 'modified',
          insertions: 10,
          deletions: 5,
          staged: true,
        },
        {
          path: 'src/both.ts',
          status: 'modified',
          insertions: 3,
          deletions: 1,
          staged: false,
        },
      ]

      const onSelect = vi.fn()
      const user = userEvent.setup()

      render(
        <FilesChanged
          files={mmFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={onSelect}
        />
      )

      // Two rows with the same path
      const pathElements = screen.getAllByText('src/both.ts')
      expect(pathElements).toHaveLength(2)

      // One has STAGED label
      expect(screen.getByText('STAGED')).toBeInTheDocument()

      // Clicking each row calls onSelect with the correct file
      await user.click(pathElements[0])
      expect(onSelect).toHaveBeenCalledWith(mmFiles[0])

      await user.click(pathElements[1])
      expect(onSelect).toHaveBeenCalledWith(mmFiles[1])
    })

    test('uses unique row keys for MM/AM files', (): void => {
      const mmFiles: ChangedFile[] = [
        {
          path: 'src/both.ts',
          status: 'modified',
          insertions: 10,
          deletions: 5,
          staged: true,
        },
        {
          path: 'src/both.ts',
          status: 'modified',
          insertions: 3,
          deletions: 1,
          staged: false,
        },
      ]

      render(
        <FilesChanged
          files={mmFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // Both rows should render (no key collision)
      // Verify by checking that both path elements are present
      const pathElements = screen.getAllByText('src/both.ts')
      expect(pathElements).toHaveLength(2)
    })
  })

  describe('default expanded', () => {
    test('section is expanded by default', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      // Files are visible without needing to click
      expect(screen.getByText('src/components/App.tsx')).toBeInTheDocument()
      expect(screen.getByText('src/utils/helpers.ts')).toBeInTheDocument()
      expect(screen.getByText('src/old/legacy.ts')).toBeInTheDocument()
    })
  })

  describe('file count', () => {
    test('shows file count in section header', (): void => {
      render(
        <FilesChanged
          files={mockFiles}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('3')).toBeInTheDocument()
    })

    test('shows 0 count when no files', (): void => {
      render(
        <FilesChanged
          files={[]}
          error={null}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
        />
      )

      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })
})
