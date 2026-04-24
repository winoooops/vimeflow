import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffPanelContent } from './DiffPanelContent'
import * as useGitStatusModule from '../hooks/useGitStatus'
import * as useFileDiffModule from '../hooks/useFileDiff'
import type { ChangedFile, FileDiff } from '../types'

// Mock the hooks
vi.mock('../hooks/useGitStatus')
vi.mock('../hooks/useFileDiff')

describe('DiffPanelContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders loading state while fetching', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      diff: null,
      loading: false,
      error: null,
    })

    render(<DiffPanelContent />)

    expect(screen.getByText('Loading diff…')).toBeInTheDocument()
  })

  test('renders error state when status fetch fails', (): void => {
    const error = new Error('Failed to fetch')

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: null,
      loading: false,
      error,
      refresh: vi.fn(),
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      diff: null,
      loading: false,
      error: null,
    })

    render(<DiffPanelContent />)

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText('Failed to load git status')).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  })

  test('renders empty state when no changes exist', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: '.',
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      diff: null,
      loading: false,
      error: null,
    })

    render(<DiffPanelContent />)

    expect(screen.getByText('No changes to review')).toBeInTheDocument()
    expect(
      screen.getByText('Modified files will appear here')
    ).toBeInTheDocument()

    // Verify centering classes include w-full
    const wrapper = screen.getByTestId('diff-empty-state')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveClass('w-full')
    expect(wrapper).toHaveClass('items-center')
    expect(wrapper).toHaveClass('justify-center')
  })

  test('renders ChangedFilesList and DiffViewer when changes exist', (): void => {
    const mockFiles: ChangedFile[] = [
      {
        path: 'src/App.tsx',
        status: 'modified',
        insertions: 5,
        deletions: 2,
        staged: false,
      },
      {
        path: 'src/lib.ts',
        status: 'added',
        insertions: 10,
        deletions: 0,
        staged: true,
      },
    ]

    const mockDiff: FileDiff = {
      filePath: 'src/App.tsx',
      oldPath: 'src/App.tsx',
      newPath: 'src/App.tsx',
      hunks: [],
    }

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: mockFiles,
      filesCwd: '.',
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      diff: mockDiff,
      loading: false,
      error: null,
    })

    render(<DiffPanelContent />)

    // Verify populated state is rendered
    const layout = screen.getByTestId('diff-populated-state')
    expect(layout).toBeInTheDocument()
    expect(layout).toHaveClass('flex')
    expect(layout).toHaveClass('h-full')
    expect(layout).toHaveClass('min-h-0')
  })

  test('passes cwd to useGitStatus and useFileDiff hooks', (): void => {
    const useGitStatusSpy = vi
      .spyOn(useGitStatusModule, 'useGitStatus')
      .mockReturnValue({
        files: [],
        filesCwd: null,
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

    const useFileDiffSpy = vi
      .spyOn(useFileDiffModule, 'useFileDiff')
      .mockReturnValue({
        diff: null,
        loading: false,
        error: null,
      })

    render(<DiffPanelContent cwd="/home/user/project" />)

    expect(useGitStatusSpy).toHaveBeenCalledWith('/home/user/project', {
      watch: true,
    })

    expect(useFileDiffSpy).toHaveBeenCalledWith(
      null,
      false,
      '/home/user/project'
    )
  })

  describe('Controlled mode', () => {
    test('render-time cwd guard: ignores selection from different cwd', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/App.tsx',
          status: 'modified',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue({
          diff: null,
          loading: false,
          error: null,
        })

      // selectedFile is from /repo/a but current cwd is /repo/b
      render(
        <DiffPanelContent
          cwd="/repo/b"
          selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '/repo/a' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // useFileDiff should be called with null (selection ignored)
      expect(useFileDiffSpy).toHaveBeenCalledWith(null, false, '/repo/b')
    })

    test('auto-select gated on filesCwd: only fires when filesCwd matches cwd', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/App.tsx',
          status: 'modified',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo/a', // Fresh data
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        diff: null,
        loading: false,
        error: null,
      })

      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo/a"
          selectedFile={null}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Should auto-select first file with cwd tag
      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/App.tsx',
        staged: false,
        cwd: '/repo/a',
      })
    })

    test('stale rows not rendered when filesCwd !== cwd', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/OldFile.tsx',
          status: 'modified',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo/a', // Stale data from old cwd
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        diff: null,
        loading: false,
        error: null,
      })

      render(
        <DiffPanelContent
          cwd="/repo/b"
          selectedFile={null}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Should show loading state (not stale files)
      expect(screen.getByText('Loading diff…')).toBeInTheDocument()
    })

    test('commitSelection tags with current cwd on click', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/App.tsx',
          status: 'modified',
          staged: false,
        },
        {
          path: 'src/Other.tsx',
          status: 'added',
          staged: true,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const mockDiff: FileDiff = {
        filePath: 'src/App.tsx',
        oldPath: 'src/App.tsx',
        newPath: 'src/App.tsx',
        hunks: [],
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        diff: mockDiff,
        loading: false,
        error: null,
      })

      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo/b"
          selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '/repo/b' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Find and click a different file row
      const otherFileRow = screen.getByText('Other.tsx')
      otherFileRow.click()

      // Should call with cwd tag
      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/Other.tsx',
        staged: true,
        cwd: '/repo/b',
      })
    })

    test('untracked file regression: shows placeholder for untracked files', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'new.ts',
          status: 'untracked',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue({
          diff: null,
          loading: false,
          error: null,
        })

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'new.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Should show untracked placeholder
      expect(screen.getByText('New file — not yet tracked')).toBeInTheDocument()
      // useFileDiff should still be called with the path
      expect(useFileDiffSpy).toHaveBeenCalledWith('new.ts', false, '/repo')
    })
  })

  describe('Uncontrolled mode fallback', () => {
    test('auto-select works without controlled props', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/App.tsx',
          status: 'modified',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue({
          diff: null,
          loading: false,
          error: null,
        })

      render(<DiffPanelContent cwd="/repo" />)

      // Should auto-select first file (via local state)
      expect(useFileDiffSpy).toHaveBeenCalledWith('src/App.tsx', false, '/repo')
    })

    test('cwd guard works in uncontrolled mode', (): void => {
      const mockFiles: ChangedFile[] = [
        {
          path: 'src/App.tsx',
          status: 'modified',
          staged: false,
        },
      ]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue({
          diff: null,
          loading: false,
          error: null,
        })

      const { rerender } = render(<DiffPanelContent cwd="/repo/a" />)

      // Change cwd
      rerender(<DiffPanelContent cwd="/repo/b" />)

      // Initially should call with null (stale selection from old cwd)
      // Then after filesCwd updates, should auto-select
      const calls = useFileDiffSpy.mock.calls
      // Last call should be with the correct file after auto-select
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toEqual(['src/App.tsx', false, '/repo/b'])
    })
  })
})
