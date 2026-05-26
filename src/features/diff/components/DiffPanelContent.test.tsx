import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { DiffPanelContent } from './DiffPanelContent'
import * as useGitStatusModule from '../hooks/useGitStatus'
import * as useFileDiffModule from '../hooks/useFileDiff'
import type { UseFileDiffReturn } from '../hooks/useFileDiff'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'
import type { ChangedFile, FileDiff } from '../types'
import { DIFF_MIN_WIDTH_PX, SPLIT_MIN_WIDTH_PX } from './toolbar'
import {
  MockResizeObserver,
  installMockResizeObserver,
} from '../../../test/mockResizeObserver'

// Mock the hooks
vi.mock('../hooks/useGitStatus')
vi.mock('../hooks/useFileDiff')

// Stub @pierre/diffs/react: the real MultiFileDiff mounts a Pierre web
// component and runs Shiki inside a Web Worker, neither of which jsdom
// supports (CSSStyleSheet.replaceSync is undefined). The stub forwards the
// props we care about asserting through data-* attributes so tests can
// confirm option plumbing without booting the renderer.
// Stub worker pool so we can assert setRenderOptions is called when the
// theme changes — that's the contract for Pierre's main-thread theme
// switch (DiffHunksRenderer reads its theme from the pool, not the
// per-instance prop, see useWorkerPool wiring in DiffPanelContent.tsx).
const workerPoolSetRenderOptionsMock = vi.fn(() => Promise.resolve(undefined))

const workerPoolMock = {
  setRenderOptions: workerPoolSetRenderOptionsMock,
}

const deferredWorkerOptions = (): {
  promise: Promise<undefined>
  resolve: () => void
  reject: (reason?: unknown) => void
} => {
  let resolveDeferred!: (value: undefined) => void
  let rejectDeferred!: (reason?: unknown) => void

  const promise = new Promise<undefined>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })

  return {
    promise,
    resolve: (): void => resolveDeferred(undefined),
    reject: rejectDeferred,
  }
}

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: (): typeof workerPoolMock => workerPoolMock,
  MultiFileDiff: ({
    oldFile,
    newFile,
    options,
  }: {
    oldFile: { name: string; contents: string }
    newFile: { name: string; contents: string }
    options: { diffStyle?: string; theme?: string; lineDiffType?: string }
  }): ReactElement => (
    <div
      data-testid="multi-file-diff"
      data-old-name={oldFile.name}
      data-old-contents={oldFile.contents}
      data-new-name={newFile.name}
      data-new-contents={newFile.contents}
      data-diff-style={options.diffStyle}
      data-theme={options.theme}
      data-line-diff-type={options.lineDiffType}
    >
      MultiFileDiff stub
    </div>
  ),
}))

/**
 * Build a `UseFileDiffReturn` from the legacy `{ diff, loading, error }`
 * shape. Synthesizes a matching `response` so the hook contract widened in
 * PR1 task 1.6 (parsed `fileDiff` + raw `oldText`/`newText`/`rawDiff`) is
 * satisfied without rewriting every test case.
 */
const fileDiffMock = ({
  diff,
  loading,
  error,
  oldText = '',
  newText = '',
  rawDiff = '',
}: {
  diff: FileDiff | null
  loading: boolean
  error: Error | null
  oldText?: string
  newText?: string
  rawDiff?: string
}): UseFileDiffReturn => ({
  response:
    diff === null
      ? null
      : {
          // Local FileDiff permits absent path keys; bindings require them.
          fileDiff: diff as GetGitDiffResponse['fileDiff'],
          oldText,
          newText,
          rawDiff,
        },
  diff,
  loading,
  error,
})

// Trigger every active ResizeObserver instance with the given width.
//
// DiffPanelContent installs an observer on its right-pane wrapper (the one
// the width-band logic reads), AND PriorityPlus installs its own observer
// inside the chip toolbar. React effect ordering means the inner
// PriorityPlus observer is created first, so `instances[0]` is NOT the
// pane observer. Broadcasting the width to all instances is simpler and
// equivalent — PriorityPlus accepts any width and DiffPanelContent reads
// the one it cares about. Wrapped in `act` so React flushes the state
// update before the next assertion runs.
const setPaneWidth = (width: number): void => {
  act(() => {
    for (const instance of MockResizeObserver.instances) {
      instance.trigger({ width, height: 800 })
    }
  })
}

describe('DiffPanelContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMockResizeObserver()
  })

  test('renders loading state while fetching', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
      idle: false,
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
      fileDiffMock({
        diff: null,
        loading: false,
        error: null,
      })
    )

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
      idle: false,
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
      fileDiffMock({
        diff: null,
        loading: false,
        error: null,
      })
    )

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
      idle: false,
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
      fileDiffMock({
        diff: null,
        loading: false,
        error: null,
      })
    )

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

  test('renders ChangedFilesList and Pierre MultiFileDiff when changes exist', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [
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
      ],
      filesCwd: '.',
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: false,
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
      fileDiffMock({
        diff: {
          filePath: 'src/App.tsx',
          oldPath: 'src/App.tsx',
          newPath: 'src/App.tsx',
          hunks: [],
        },
        loading: false,
        error: null,
        oldText: 'old',
        newText: 'new',
        rawDiff: '',
      })
    )

    render(<DiffPanelContent />)

    // Verify populated state is rendered
    const layout = screen.getByTestId('diff-populated-state')
    expect(layout).toBeInTheDocument()
    expect(layout).toHaveClass('flex')
    expect(layout).toHaveClass('h-full')
    expect(layout).toHaveClass('w-full')
    expect(layout).toHaveClass('min-h-0')
    expect(layout).toHaveClass('min-w-0')

    // Initial pane width is the unmeasured sentinel, so MultiFileDiff mounts
    // immediately before a ResizeObserver trigger without forcing narrow mode.
    expect(screen.getByTestId('multi-file-diff')).toBeInTheDocument()

    // Chip toolbar (controlled component) is mounted alongside.
    expect(
      screen.getByRole('toolbar', { name: 'Diff toolbar' })
    ).toBeInTheDocument()

    const rightPane = screen.getByTestId('diff-right-pane')
    const toolbarShell = screen.getByTestId('diff-toolbar-shell')
    const scrollBody = screen.getByTestId('diff-scroll-body')
    const toolbar = screen.getByRole('toolbar', { name: 'Diff toolbar' })
    expect(rightPane).toHaveClass('overflow-hidden')
    expect(toolbarShell).toHaveClass('shrink-0')
    expect(scrollBody).toHaveClass('overflow-auto')
    expect(scrollBody).not.toContainElement(toolbar)
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
        idle: false,
      })

    const useFileDiffSpy = vi
      .spyOn(useFileDiffModule, 'useFileDiff')
      .mockReturnValue(
        fileDiffMock({
          diff: null,
          loading: false,
          error: null,
        })
      )

    render(<DiffPanelContent cwd="/home/user/project" />)

    expect(useGitStatusSpy).toHaveBeenCalledWith('/home/user/project', {
      watch: true,
      enabled: true,
    })

    expect(useFileDiffSpy).toHaveBeenCalledWith(
      null,
      false,
      '/home/user/project',
      undefined
    )
  })

  test('uses external git status without starting an internal watcher', (): void => {
    const useGitStatusSpy = vi
      .spyOn(useGitStatusModule, 'useGitStatus')
      .mockReturnValue({
        files: [],
        filesCwd: null,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: true,
      })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
      fileDiffMock({
        diff: {
          filePath: 'src/App.tsx',
          oldPath: 'src/App.tsx',
          newPath: 'src/App.tsx',
          hunks: [],
        },
        loading: false,
        error: null,
      })
    )

    render(
      <DiffPanelContent
        cwd="/repo"
        gitStatus={{
          files: [
            {
              path: 'src/App.tsx',
              status: 'modified',
              insertions: 5,
              deletions: 2,
              staged: false,
            },
          ],
          filesCwd: '/repo',
          loading: false,
          error: null,
          refresh: vi.fn(),
          idle: false,
        }}
      />
    )

    expect(useGitStatusSpy).toHaveBeenCalledWith('/repo', {
      watch: true,
      enabled: false,
    })
    expect(screen.getByTestId('diff-populated-state')).toBeInTheDocument()
  })

  describe('Pierre renderer width bands', () => {
    const mockFiles: ChangedFile[] = [
      {
        path: 'src/App.tsx',
        status: 'modified',
        staged: false,
      },
    ]

    const mockDiff: FileDiff = {
      filePath: 'src/App.tsx',
      oldPath: 'src/App.tsx',
      newPath: 'src/App.tsx',
      hunks: [],
    }

    beforeEach(() => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: mockFiles,
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: mockDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )
    })

    test('attaches ResizeObserver after loading state resolves', (): void => {
      let loading = true
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockImplementation(() => {
        if (loading) {
          return {
            files: [],
            filesCwd: null,
            loading: true,
            error: null,
            refresh: vi.fn(),
            idle: false,
          }
        }

        return {
          files: mockFiles,
          filesCwd: '/repo',
          loading: false,
          error: null,
          refresh: vi.fn(),
          idle: false,
        }
      })

      const { rerender } = render(<DiffPanelContent cwd="/repo" />)

      expect(screen.getByText('Loading diff…')).toBeInTheDocument()
      expect(screen.queryByTestId('diff-right-pane')).toBeNull()
      expect(MockResizeObserver.instances).toHaveLength(0)

      loading = false
      rerender(<DiffPanelContent cwd="/repo" />)

      expect(screen.getByTestId('diff-right-pane')).toBeInTheDocument()

      setPaneWidth(DIFF_MIN_WIDTH_PX - 1)

      expect(screen.queryByTestId('multi-file-diff')).toBeNull()
      expect(
        screen.getByText('Pane is too narrow to render the diff.')
      ).toBeInTheDocument()
    })

    test('renders MultiFileDiff when paneWidth >= DIFF_MIN_WIDTH_PX', (): void => {
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(DIFF_MIN_WIDTH_PX + 10)

      expect(screen.getByTestId('multi-file-diff')).toBeInTheDocument()
      expect(
        screen.queryByRole('status', {
          name: /pane is too narrow/i,
        })
      ).toBeNull()
    })

    test('renders DiffNarrowPlaceholder when paneWidth < DIFF_MIN_WIDTH_PX', (): void => {
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(DIFF_MIN_WIDTH_PX - 1)

      expect(screen.queryByTestId('multi-file-diff')).toBeNull()
      expect(
        screen.getByText('Pane is too narrow to render the diff.')
      ).toBeInTheDocument()

      expect(
        screen.getByText(`Widen to ≥ ${DIFF_MIN_WIDTH_PX}px to view changes.`)
      ).toBeInTheDocument()
    })

    test('coerces split → unified when paneWidth < SPLIT_MIN_WIDTH_PX (saved preference unchanged)', (): void => {
      // diffStyle default is 'split'. Pane below the split threshold must
      // render unified, but the saved preference is untouched (we cannot
      // assert the underlying state here directly; the contract is asserted
      // via the prop flowing into MultiFileDiff).
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX - 1)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-diff-style')).toBe('unified')
    })

    test('keeps split preference when clicking forced unified below split width', (): void => {
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX - 1)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-diff-style',
        'unified'
      )

      fireEvent.click(screen.getByRole('button', { name: 'unified' }))
      setPaneWidth(SPLIT_MIN_WIDTH_PX + 1)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-diff-style',
        'split'
      )
    })

    test('renders split when paneWidth >= SPLIT_MIN_WIDTH_PX (default diffStyle)', (): void => {
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 1)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-diff-style')).toBe('split')
    })

    test('passes default theme + oldFile/newFile names to MultiFileDiff', (): void => {
      render(<DiffPanelContent cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-theme')).toBe('pierre-dark')
      expect(diff.getAttribute('data-old-name')).toBe('src/App.tsx')
      expect(diff.getAttribute('data-new-name')).toBe('src/App.tsx')
      expect(diff.getAttribute('data-old-contents')).toBe('old')
      expect(diff.getAttribute('data-new-contents')).toBe('new')
    })
  })

  describe('Controlled mode', () => {
    test('render-time cwd guard: ignores selection from different cwd', (): void => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue(
          fileDiffMock({
            diff: null,
            loading: false,
            error: null,
          })
        )

      // selectedFile is from /repo/a but current cwd is /repo/b
      render(
        <DiffPanelContent
          cwd="/repo/b"
          selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '/repo/a' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // useFileDiff should be called with null (selection ignored)
      expect(useFileDiffSpy).toHaveBeenCalledWith(
        null,
        false,
        '/repo/b',
        undefined
      )
    })

    test('auto-select gated on filesCwd: only fires when filesCwd matches cwd', (): void => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo/a', // Fresh data
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: null,
          loading: false,
          error: null,
        })
      )

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
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/OldFile.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo/a', // Stale data from old cwd
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: null,
          loading: false,
          error: null,
        })
      )

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
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
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
        ],
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/App.tsx',
            oldPath: 'src/App.tsx',
            newPath: 'src/App.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
        })
      )

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

    test('untracked file: renders Pierre MultiFileDiff with synthesized all-added content', (): void => {
      // Backend runs `git diff --no-index /dev/null <file>` for untracked
      // paths, returning a real FileDiff with all-added lines + newText
      // = file contents, oldText = ''. Pierre's MultiFileDiff renders that
      // exactly like a modified file — no placeholder branch needed.
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'new.ts',
            status: 'untracked',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue(
          fileDiffMock({
            diff: {
              filePath: 'new.ts',
              hunks: [
                {
                  id: 'hunk-0',
                  header: '@@ -0,0 +1,2 @@',
                  oldStart: 0,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 2,
                  lines: [
                    {
                      type: 'added',
                      newLineNumber: 1,
                      content: 'alpha',
                    },
                    {
                      type: 'added',
                      newLineNumber: 2,
                      content: 'beta',
                    },
                  ],
                },
              ],
            },
            loading: false,
            error: null,
            oldText: '',
            newText: 'alpha\nbeta',
          })
        )

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'new.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // No legacy placeholder; the stub-rendered Pierre diff appears.
      expect(screen.queryByText('New file — not yet tracked')).toBeNull()
      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-old-name')).toBe('new.ts')
      expect(diff.getAttribute('data-new-name')).toBe('new.ts')
      expect(diff.getAttribute('data-old-contents')).toBe('')
      expect(diff.getAttribute('data-new-contents')).toBe('alpha\nbeta')

      // useFileDiff was called with the path, staged flag, cwd, and untracked hint
      expect(useFileDiffSpy).toHaveBeenCalledWith(
        'new.ts',
        false,
        '/repo',
        true
      )
    })
  })

  describe('File navigation (chip toolbar)', () => {
    // Three changed files, mixed staged flags so the (path, staged) identity
    // is exercised. useFileDiff returns the same stub for every selection —
    // we only assert which file the toolbar arrows commit, not the diff body.
    const navFiles: ChangedFile[] = [
      { path: 'src/a.tsx', status: 'modified', staged: false },
      { path: 'src/b.tsx', status: 'modified', staged: false },
      { path: 'src/c.tsx', status: 'added', staged: true },
    ]

    beforeEach(() => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: navFiles,
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/a.tsx',
            oldPath: 'src/a.tsx',
            newPath: 'src/a.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
        })
      )
    })

    test('next-file selects the following file in effectiveFiles', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'src/a.tsx', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Selection is index 0; next → index 1 (src/b.tsx).
      const nextButton = screen.getByRole('button', { name: /next file/i })
      nextButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/b.tsx',
        staged: false,
        cwd: '/repo',
      })
    })

    test('prev-file selects the preceding file in effectiveFiles', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'src/b.tsx', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Selection is index 1; prev → index 0 (src/a.tsx).
      const prevButton = screen.getByRole('button', { name: /previous file/i })
      prevButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/a.tsx',
        staged: false,
        cwd: '/repo',
      })
    })

    test('next-file wraps from the last file to the first', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'src/c.tsx', staged: true, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Selection is the last file (index 2); next wraps → index 0.
      const nextButton = screen.getByRole('button', { name: /next file/i })
      nextButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/a.tsx',
        staged: false,
        cwd: '/repo',
      })
    })

    test('prev-file wraps from the first file to the last', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={{ path: 'src/a.tsx', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Selection is the first file (index 0); prev wraps → index 2.
      const prevButton = screen.getByRole('button', { name: /previous file/i })
      prevButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/c.tsx',
        staged: true,
        cwd: '/repo',
      })
    })

    test('next-file selects the first file when no file is selected', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={null}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      onSelectedFileChange.mockClear()

      const nextButton = screen.getByRole('button', { name: /next file/i })
      nextButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/a.tsx',
        staged: false,
        cwd: '/repo',
      })
    })

    test('prev-file selects the last file when no file is selected', (): void => {
      const onSelectedFileChange = vi.fn()

      render(
        <DiffPanelContent
          cwd="/repo"
          selectedFile={null}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      onSelectedFileChange.mockClear()

      const prevButton = screen.getByRole('button', { name: /previous file/i })
      prevButton.click()

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/c.tsx',
        staged: true,
        cwd: '/repo',
      })
    })
  })

  describe('Uncontrolled mode fallback', () => {
    test('auto-select works without controlled props', (): void => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue(
          fileDiffMock({
            diff: null,
            loading: false,
            error: null,
          })
        )

      render(<DiffPanelContent cwd="/repo" />)

      // Should auto-select first file (via local state)
      expect(useFileDiffSpy).toHaveBeenCalledWith(
        'src/App.tsx',
        false,
        '/repo',
        false
      )
    })

    test('cwd guard works in uncontrolled mode', (): void => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo/b',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockReturnValue(
          fileDiffMock({
            diff: null,
            loading: false,
            error: null,
          })
        )

      const { rerender } = render(<DiffPanelContent cwd="/repo/a" />)

      // Change cwd
      rerender(<DiffPanelContent cwd="/repo/b" />)

      // Initially should call with null (stale selection from old cwd)
      // Then after filesCwd updates, should auto-select
      const calls = useFileDiffSpy.mock.calls
      // Last call should be with the correct file after auto-select
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toEqual(['src/App.tsx', false, '/repo/b', false])
    })
  })

  describe('worker pool render-options sync', (): void => {
    test('calls workerPool.setRenderOptions with the initial pool options on mount', async (): Promise<void> => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [],
        filesCwd: null,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({ diff: null, loading: false, error: null })
      )

      render(<DiffPanelContent />)

      // DiffPanelContent's defaults are theme 'pierre-dark' + lineDiffType
      // 'word'; the sync effect must push BOTH into the shared worker pool so
      // the renderer's workerManager-driven path picks them up. lineDiffType
      // matters because setRenderOptions defaults every omitted field —
      // leaving it out would reset the pool to Pierre's 'word-alt'. Writes are
      // serialized through a promise chain, so the call is scheduled a
      // microtask later — await it.
      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledWith({
          theme: 'pierre-dark',
          lineDiffType: 'word',
        })
      )
    })

    test('surfaces workerPool.setRenderOptions failures', async (): Promise<void> => {
      const error = new Error('worker failed')
      workerPoolSetRenderOptionsMock.mockRejectedValueOnce(error)

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/App.tsx',
            oldPath: 'src/App.tsx',
            newPath: 'src/App.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
        })
      )

      render(<DiffPanelContent cwd="/repo" />)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Diff render sync failed: worker failed'
      )
    })

    test('remounts MultiFileDiff only after worker pool accepts a new theme', async (): Promise<void> => {
      const user = userEvent.setup()
      const pendingThemeSync = deferredWorkerOptions()
      workerPoolSetRenderOptionsMock
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(pendingThemeSync.promise)

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/App.tsx',
            oldPath: 'src/App.tsx',
            newPath: 'src/App.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
        })
      )

      render(<DiffPanelContent cwd="/repo" />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-theme',
        'pierre-dark'
      )

      await user.click(screen.getByRole('button', { name: /pierre-dark/i }))
      const menu = await screen.findByRole('menu')
      await user.click(
        within(menu).getByRole('menuitem', { name: /pierre-light$/i })
      )

      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenLastCalledWith({
          theme: 'pierre-light',
          lineDiffType: 'word',
        })
      )

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-theme',
        'pierre-dark'
      )

      await act(async () => {
        pendingThemeSync.resolve()
        await pendingThemeSync.promise
      })

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-theme',
        'pierre-light'
      )
    })

    test('remounts MultiFileDiff only after worker pool accepts a new lineDiffType', async (): Promise<void> => {
      const user = userEvent.setup()
      const pendingSync = deferredWorkerOptions()
      workerPoolSetRenderOptionsMock
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(pendingSync.promise)

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/App.tsx',
            oldPath: 'src/App.tsx',
            newPath: 'src/App.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
        })
      )

      render(<DiffPanelContent cwd="/repo" />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-line-diff-type',
        'word'
      )

      // HIGHLIGHT dropdown trigger shows the current value 'Word'.
      await user.click(screen.getByRole('button', { name: 'Word' }))
      const menu = await screen.findByRole('menu')
      await user.click(
        within(menu).getByRole('menuitem', { name: /character/i })
      )

      // lineDiffType MUST ride along with theme — it is a pool-owned option,
      // so the HIGHLIGHT dropdown would be a no-op without this push.
      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenLastCalledWith({
          theme: 'pierre-dark',
          lineDiffType: 'char',
        })
      )

      // Remount is gated on the synced value, so the diff keeps the prior
      // highlighting until the pool resolves.
      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-line-diff-type',
        'word'
      )

      await act(async () => {
        pendingSync.resolve()
        await pendingSync.promise
      })

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-line-diff-type',
        'char'
      )
    })

    test('serializes pool writes so a newer change waits for the prior write', async (): Promise<void> => {
      const user = userEvent.setup()
      const firstWrite = deferredWorkerOptions()
      const secondWrite = deferredWorkerOptions()
      workerPoolSetRenderOptionsMock
        .mockReturnValueOnce(firstWrite.promise) // mount sync — left pending
        .mockReturnValueOnce(secondWrite.promise) // theme change

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
          },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/App.tsx',
            oldPath: 'src/App.tsx',
            newPath: 'src/App.tsx',
            hunks: [],
          },
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
        })
      )

      render(<DiffPanelContent cwd="/repo" />)

      // The mount write fires and is left pending (unresolved).
      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(1)
      )

      // Change the theme while the mount write is still in flight.
      await user.click(screen.getByRole('button', { name: /pierre-dark/i }))
      const menu = await screen.findByRole('menu')
      await user.click(
        within(menu).getByRole('menuitem', { name: /pierre-light$/i })
      )

      // Serialization: the second write MUST NOT start until the first
      // resolves. Overlapping `setRenderOptions` calls can land out of order
      // and leave the shared pool on the stale value (WorkerPoolManager assigns
      // `this.renderOptions` only after its awaits).
      expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(1)

      // Resolve the first write; the chained second write then runs.
      await act(async () => {
        firstWrite.resolve()
        await firstWrite.promise
      })

      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(2)
      )

      expect(workerPoolSetRenderOptionsMock).toHaveBeenLastCalledWith({
        theme: 'pierre-light',
        lineDiffType: 'word',
      })
    })
  })
})
