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
      filesCwd: null,
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
      filesCwd: '/test/cwd',
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

    expect(useGitStatusSpy).toHaveBeenCalledWith('/home/user/project')
    expect(useFileDiffSpy).toHaveBeenCalledWith(
      null,
      false,
      '/home/user/project'
    )
  })
})
