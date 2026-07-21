import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  act,
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
  within,
  type RenderResult,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState, type ReactElement, type ReactNode } from 'react'
import { Panel } from './Panel'
import * as useGitStatusModule from './hooks/useGitStatus'
import * as useFileDiffModule from './hooks/useFileDiff'
import type { UseGitStatusReturn } from './hooks/useGitStatus'
import type { UseFileDiffReturn } from './hooks/useFileDiff'
import type { GetGitDiffResponse } from '../../bindings/GetGitDiffResponse'
import type { ChangedFile, FileDiff } from './types'
import { DIFF_MIN_WIDTH_PX, SPLIT_MIN_WIDTH_PX } from './components/toolbar'
import {
  MockResizeObserver,
  installMockResizeObserver,
} from '../../test/mockResizeObserver'
import type { GitService } from './services/gitService'
import * as gitServiceModule from './services/gitService'
import * as pierreAdapterModule from './services/pierreAdapter'
import { __resetPoolWritesForTest } from './services/workerPoolWrites'
import * as useFeedbackBatchModule from './hooks/useFeedbackBatch'
import {
  type FeedbackDraftStore,
  makeBatchKey,
  type ReviewComment,
  type UseFeedbackBatchReturn,
} from './hooks/useFeedbackBatch'
import type { MockInstance } from 'vitest'
import type { PaneCandidate } from './services/activePanePicker'
import { clearPendingReview, getPendingReview } from './services/pendingReviews'
import {
  clearPendingReviewRequest,
  getPendingReviewRequest,
} from './services/pendingReviewRequests'
import type { DiffLineAnnotation, FileDiffOptions } from '@pierre/diffs'
import { themeService } from '../../theme'
import type { Keybindings } from '../keymap/useKeybindings'
import {
  SettingsContext,
  type SettingsContextValue,
} from '../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../settings/store/settingsDefaults'

let updatePanelSettings: SettingsContextValue['update'] = (): void => undefined

const PanelSettingsProvider = ({
  children,
}: {
  children: ReactNode
}): ReactElement => {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  const update = useCallback(
    (patch: Partial<typeof DEFAULT_SETTINGS>): void => {
      setSettings((current) => ({ ...current, ...patch }))
    },
    []
  )

  updatePanelSettings = update

  return (
    <SettingsContext.Provider value={{ settings, saveError: null, update }}>
      {children}
    </SettingsContext.Provider>
  )
}

const render = (ui: ReactElement): RenderResult =>
  testingLibraryRender(ui, { wrapper: PanelSettingsProvider })

const codeForKey = (key: string): string => {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`
  }

  return (
    {
      '/': 'Slash',
      '[': 'BracketLeft',
      ']': 'BracketRight',
    }[key] ?? key
  )
}

const keyDown = (
  target: Element | Document | Window,
  init: KeyboardEventInit & { key: string }
): boolean =>
  fireEvent.keyDown(target, {
    ...init,
    code: init.code ?? codeForKey(init.key),
  })

// Mock the hooks
vi.mock('./hooks/useGitStatus')
vi.mock('./hooks/useFileDiff')
vi.mock('../keymap/useKeybindings', async () => {
  const { getCommand } = await import('../keymap/catalog')
  const { eventMatchesChord } = await import('../keymap/match')
  const { resolveDefault } = await import('../keymap/resolve')

  const bindingFor: Keybindings['bindingFor'] = (id) =>
    resolveDefault(getCommand(id), false)

  const matches: Keybindings['matches'] = (event, id) =>
    eventMatchesChord(event, bindingFor(id), 'ctrl', getCommand(id).matchPolicy)

  return {
    useKeybindings: (): Pick<Keybindings, 'bindingFor' | 'matches'> => ({
      bindingFor,
      matches,
    }),
  }
})

// Stub @pierre/diffs/react: the real MultiFileDiff mounts a Pierre web
// component and runs Shiki inside a Web Worker, neither of which jsdom
// supports (CSSStyleSheet.replaceSync is undefined). The stub forwards the
// props we care about asserting through data-* attributes so tests can
// confirm option plumbing without booting the renderer.
// Stub worker pool so we can assert setRenderOptions is called when the
// theme changes — that's the contract for Pierre's main-thread theme
// switch (DiffHunksRenderer reads its theme from the pool, not the
// per-instance prop, see useWorkerPool wiring in Panel.tsx).
const workerPoolSetRenderOptionsMock = vi.fn(() => Promise.resolve(undefined))

const workerPoolMock = {
  setRenderOptions: workerPoolSetRenderOptionsMock,
}

const multiFileDiffOptionsSeen: FileDiffOptions<ReviewComment>[] = []
let mockedGutterHoverLine = 1

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
    selectedLines = undefined,
    lineAnnotations = undefined,
    renderGutterUtility = undefined,
    renderAnnotation = undefined,
  }: {
    oldFile: { name: string; contents: string; cacheKey?: string }
    newFile: { name: string; contents: string; cacheKey?: string }
    options: FileDiffOptions<ReviewComment>
    selectedLines?: {
      start: number
      end: number
      side?: string
    } | null
    lineAnnotations?: {
      lineNumber: number
      side: string
      metadata: ReviewComment
    }[]
    renderGutterUtility?: (
      getHovered: () => { lineNumber: number; side: string }
    ) => ReactElement
    renderAnnotation?: (a: {
      lineNumber: number
      side: string
      metadata: ReviewComment
    }) => ReactElement
  }): ReactElement => {
    multiFileDiffOptionsSeen.push(options)

    return (
      <div
        data-testid="multi-file-diff"
        data-old-name={oldFile.name}
        data-old-contents={oldFile.contents}
        data-old-cache-key={oldFile.cacheKey}
        data-new-name={newFile.name}
        data-new-contents={newFile.contents}
        data-new-cache-key={newFile.cacheKey}
        data-diff-style={options.diffStyle}
        data-theme={options.theme}
        data-line-diff-type={options.lineDiffType}
        data-selected-lines-start={
          selectedLines != null ? String(selectedLines.start) : undefined
        }
        data-selected-lines-end={
          selectedLines != null ? String(selectedLines.end) : undefined
        }
        data-selected-lines-side={selectedLines?.side ?? undefined}
      >
        {renderGutterUtility != null ? (
          <div data-testid="gutter-utility-slot">
            {renderGutterUtility(() => ({
              lineNumber: mockedGutterHoverLine,
              side: 'additions',
            }))}
          </div>
        ) : null}
        {lineAnnotations != null && renderAnnotation != null ? (
          <div key={newFile.contents} data-testid="annotation-slot">
            {lineAnnotations.map((annotation, index) => (
              <div key={annotation.metadata.id ?? index}>
                {renderAnnotation(annotation)}
              </div>
            ))}
          </div>
        ) : null}
        MultiFileDiff stub
      </div>
    )
  },
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
  latestDiffStatus = null,
  acceptLatestDiff = vi.fn(),
  oldText = '',
  newText = '',
  rawDiff = '',
  repoRoot = '/repo',
}: {
  diff: FileDiff | null
  loading: boolean
  error: Error | null
  latestDiffStatus?: UseFileDiffReturn['latestDiffStatus']
  acceptLatestDiff?: () => void
  oldText?: string
  newText?: string
  rawDiff?: string
  repoRoot?: string
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
          repoRoot,
        },
  diff,
  loading,
  error,
  latestDiffStatus,
  refetch: vi.fn(),
  acceptLatestDiff,
})

// Trigger every active ResizeObserver instance with the given width.
//
// Panel installs an observer on its right-pane wrapper (the one
// the width-band logic reads), AND PriorityPlus installs its own observer
// inside the chip toolbar. React effect ordering means the inner
// PriorityPlus observer is created first, so `instances[0]` is NOT the
// pane observer. Broadcasting the width to all instances is simpler and
// equivalent — PriorityPlus accepts any width and Panel reads
// the one it cares about. Wrapped in `act` so React flushes the state
// update before the next assertion runs.
const setPaneWidth = (width: number): void => {
  act(() => {
    for (const instance of MockResizeObserver.instances) {
      instance.trigger({ width, height: 800 })
    }
  })
}

const lastMultiFileDiffOptions = (): FileDiffOptions<ReviewComment> => {
  const last = multiFileDiffOptionsSeen[multiFileDiffOptionsSeen.length - 1]

  if (last === undefined) {
    throw new Error('MultiFileDiff was not rendered')
  }

  return last
}

describe('Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPoolWritesForTest()
    multiFileDiffOptionsSeen.length = 0
    mockedGutterHoverLine = 1
    window.localStorage.clear()
    themeService.apply('obsidian-lens')
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

    render(<Panel />)

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

    render(<Panel />)

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

    render(<Panel />)

    expect(screen.getByText('No changes to review')).toBeInTheDocument()
    expect(screen.getByText(/nothing to diff or annotate/i)).toBeInTheDocument()

    // The empty state keeps a dormant toolbar (settings stay live) above a
    // centered "no changes" panel, so the chrome persists when a diff appears.
    const wrapper = screen.getByTestId('diff-empty-state')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveClass('w-full')
    expect(
      screen.getByRole('toolbar', { name: /diff toolbar/i })
    ).toBeInTheDocument()
    const panel = screen.getByTestId('diff-empty-panel')
    expect(panel).toHaveClass('items-center')
    expect(panel).toHaveClass('justify-center')
  })

  test('keeps feedback actions available in the empty state', async (): Promise<void> => {
    const user = userEvent.setup()
    const clearBatch = vi.fn()
    const clearPending = vi.fn()

    const annotation: DiffLineAnnotation<ReviewComment> = {
      side: 'additions',
      lineNumber: 1,
      metadata: {
        id: 'comment-1',
        text: 'Needs review',
        author: 'self',
        createdAt: 1000,
      },
    }

    const batch = new Map([
      [makeBatchKey('/repo/old', 'src/foo.ts', false), [annotation]],
    ])

    const feedbackBatch: UseFeedbackBatchReturn = {
      batch,
      annotationsForFile: () => [],
      addAnnotation: () => 'ok',
      addAnnotationForOwner: () => 'ok',
      updateAnnotation: vi.fn(),
      removeAnnotation: vi.fn(),
      clearBatch,
      clearPending,
      markDispatched: vi.fn(),
      totalAnnotations: () => 1,
      pendingAnnotations: () => 1,
    }

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: '/repo/current',
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

    render(<Panel cwd="/repo/current" feedbackBatch={feedbackBatch} />)

    expect(screen.getByTestId('diff-empty-state')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /finish feedback \(1\)/i })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /discard all feedback/i })
    )

    expect(clearPending).toHaveBeenCalledOnce()

    await user.click(
      screen.getByRole('button', { name: /finish feedback \(1\)/i })
    )

    expect(
      await screen.findByRole('dialog', { name: 'Finish feedback' })
    ).toBeInTheDocument()
  })

  test('copies review comments to the clipboard from the finish popover', async (): Promise<void> => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const originalClipboard = window.navigator.clipboard
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })

    try {
      const annotation: DiffLineAnnotation<ReviewComment> = {
        side: 'additions',
        lineNumber: 5,
        metadata: {
          id: 'comment-1',
          text: 'Needs review',
          author: 'self',
          createdAt: 1000,
        },
      }

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [
            makeBatchKey('/repo/packages/app', 'src/foo.ts', false),
            [annotation],
          ],
        ]),
        annotationsForFile: () => [],
        addAnnotation: () => 'ok',
        addAnnotationForOwner: () => 'ok',
        updateAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 1,
        pendingAnnotations: () => 1,
      }

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [],
        filesCwd: '/repo/packages/app',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({ diff: null, loading: false, error: null })
      )

      render(
        <Panel
          cwd="/repo/packages/app"
          feedbackBatch={feedbackBatch}
          feedbackRepoRootRef={{
            current: '',
            repoRootForCwd: (entryCwd: string): string =>
              entryCwd === '/repo/packages/app' ? '/repo' : '',
          }}
        />
      )

      await user.click(
        screen.getByRole('button', { name: /finish feedback \(1\)/i })
      )
      await screen.findByRole('dialog', { name: 'Finish feedback' })

      await user.click(screen.getByRole('button', { name: 'Copy (C)' }))

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const payload = writeText.mock.calls[0][0] as string
      expect(payload).toContain('Needs review')
      expect(payload).toContain('/repo/src/foo.ts')
      expect(payload).not.toContain('> src/foo.ts:5')
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
    }
  })

  test('hides Request review while the Finish popover is open', async (): Promise<void> => {
    const user = userEvent.setup()

    const annotation: DiffLineAnnotation<ReviewComment> = {
      side: 'additions',
      lineNumber: 5,
      metadata: {
        id: 'comment-1',
        text: 'Needs review',
        author: 'self',
        createdAt: 1000,
      },
    }

    const feedbackBatch: UseFeedbackBatchReturn = {
      batch: new Map([
        [makeBatchKey('/repo', 'src/foo.ts', false), [annotation]],
      ]),
      annotationsForFile: () => [annotation],
      addAnnotation: () => 'ok',
      addAnnotationForOwner: () => 'ok',
      updateAnnotation: vi.fn(),
      removeAnnotation: vi.fn(),
      clearBatch: vi.fn(),
      clearPending: vi.fn(),
      markDispatched: vi.fn(),
      totalAnnotations: () => 1,
      pendingAnnotations: () => 1,
    }

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [
        {
          path: 'src/foo.ts',
          status: 'modified',
          insertions: 1,
          deletions: 0,
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
          filePath: 'src/foo.ts',
          oldPath: 'src/foo.ts',
          newPath: 'src/foo.ts',
          hunks: [
            {
              id: 'h1',
              header: '@@',
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [],
            },
          ],
        },
        loading: false,
        error: null,
        oldText: '',
        newText: 'new',
        rawDiff: '',
      })
    )

    render(
      <Panel
        cwd="/repo"
        feedbackBatch={feedbackBatch}
        feedbackOwnerKey="sess:pane-1"
      />
    )

    expect(
      screen.getByRole('button', { name: /request review/i })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /finish feedback \(1\)/i })
    )

    expect(
      await screen.findByRole('dialog', { name: 'Finish feedback' })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /request review/i })
    ).not.toBeInTheDocument()
  })

  test('keeps draft-only feedback discard available in the empty state', async (): Promise<void> => {
    const user = userEvent.setup()
    const clearBatch = vi.fn()
    const clearPending = vi.fn()
    const setDraft = vi.fn()

    const feedbackBatch: UseFeedbackBatchReturn = {
      batch: new Map(),
      annotationsForFile: () => [],
      addAnnotation: () => 'ok',
      addAnnotationForOwner: () => 'ok',
      updateAnnotation: vi.fn(),
      removeAnnotation: vi.fn(),
      clearBatch,
      clearPending,
      markDispatched: vi.fn(),
      totalAnnotations: () => 0,
      pendingAnnotations: () => 0,
    }

    const feedbackDraft: FeedbackDraftStore = {
      draft: {
        cwd: '/repo/current',
        filePath: 'src/removed.ts',
        staged: false,
        side: 'additions',
        lineNumber: 42,
        text: 'Draft after removed file',
      },
      setDraft,
    }

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: '/repo/current',
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
      <Panel
        cwd="/repo/current"
        feedbackBatch={feedbackBatch}
        feedbackDraft={feedbackDraft}
      />
    )

    expect(screen.getByTestId('diff-empty-state')).toBeInTheDocument()

    const finishButton = screen.getByRole('button', {
      name: /finish feedback \(1\)/i,
    })

    expect(finishButton).toBeDisabled()

    await user.click(finishButton)

    expect(
      screen.queryByRole('dialog', { name: 'Finish feedback' })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /discard all feedback/i })
    )

    expect(clearPending).toHaveBeenCalledOnce()
  })

  test('renders full-width diff with a hover cue when changes exist', (): void => {
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

    render(<Panel />)

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
    expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()
    expect(screen.getByTestId('changed-files-edge-hint')).toBeInTheDocument()
    expect(
      screen.queryByTestId('changed-files-hot-zone')
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /show changed files \(2\)/i })
    ).toHaveAttribute('aria-keyshortcuts', 'e')

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

  test('pressing e toggles the changed-files panel and Shift+E toggles sticky', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [
        {
          path: 'src/App.tsx',
          status: 'modified',
          insertions: 5,
          deletions: 2,
          staged: false,
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

    render(<Panel />)

    expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()

    keyDown(screen.getByTestId('diff-populated-state'), { key: 'e' })

    expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

    keyDown(screen.getByTestId('diff-populated-state'), { key: 'e' })

    expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()

    keyDown(screen.getByTestId('diff-populated-state'), {
      key: 'E',
      shiftKey: true,
    })

    expect(window.localStorage.getItem('vf-diff-files-open')).toBe('1')
    expect(screen.getByTestId('changed-files-pane')).toHaveClass('h-full')

    keyDown(screen.getByTestId('diff-populated-state'), {
      key: 'E',
      shiftKey: true,
    })

    expect(window.localStorage.getItem('vf-diff-files-open')).toBe('0')
    expect(screen.getByTestId('changed-files-pane')).toHaveClass('absolute')
  })

  test('pin button restores diff focus when the changed-files surface remounts', async (): Promise<void> => {
    const user = userEvent.setup()

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [
        {
          path: 'src/App.tsx',
          status: 'modified',
          insertions: 5,
          deletions: 2,
          staged: false,
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

    render(<Panel />)

    keyDown(screen.getByTestId('diff-populated-state'), { key: 'e' })

    await user.click(
      within(screen.getByTestId('changed-files-pane')).getByRole('button', {
        name: /^pin changed files/i,
      })
    )

    expect(window.localStorage.getItem('vf-diff-files-open')).toBe('1')
    expect(screen.getByTestId('changed-files-pane')).toHaveClass('h-full')
    expect(screen.getByTestId('diff-populated-state')).toHaveFocus()

    await user.click(
      within(screen.getByTestId('changed-files-pane')).getByRole('button', {
        name: /^unpin changed files/i,
      })
    )

    expect(window.localStorage.getItem('vf-diff-files-open')).toBe('0')
    expect(screen.getByTestId('changed-files-pane')).toHaveClass('absolute')
    expect(screen.getByTestId('diff-populated-state')).toHaveFocus()
  })

  test('plain e toggle restores diff focus when closing the changed-files surface', (): void => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [
        {
          path: 'src/App.tsx',
          status: 'modified',
          insertions: 5,
          deletions: 2,
          staged: false,
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

    render(<Panel />)

    keyDown(screen.getByTestId('diff-populated-state'), { key: 'e' })

    const pinButton = within(
      screen.getByTestId('changed-files-pane')
    ).getByRole('button', { name: /^pin changed files/i })
    act(() => {
      pinButton.focus()
    })
    expect(pinButton).toHaveFocus()

    keyDown(pinButton, { key: 'e' })

    expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()
    expect(screen.getByTestId('diff-populated-state')).toHaveFocus()
  })

  test('hovering the left edge reveals the changed-files panel and selecting a file closes it', async (): Promise<void> => {
    const user = userEvent.setup()
    const onSelectedFileChange = vi.fn()

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

    render(
      <Panel
        selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '.' }}
        onSelectedFileChange={onSelectedFileChange}
      />
    )

    fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

    expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

    await user.click(
      within(screen.getByTestId('changed-files-pane')).getByText('lib.ts')
    )

    expect(onSelectedFileChange).toHaveBeenCalledWith({
      path: 'src/lib.ts',
      staged: true,
      cwd: '.',
    })
    expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()
  })

  test('changing the syntax theme keeps keyboard focus on the diff (VIM-276)', async (): Promise<void> => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [{ path: 'src/App.tsx', status: 'modified', staged: false }],
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

    render(<Panel />)

    const diffRoot = screen.getByTestId('diff-populated-state')
    act(() => diffRoot.focus())
    expect(diffRoot).toHaveFocus()

    // Switch the persisted syntax theme; the Pierre surface re-keys and
    // remounts, which used to strand focus off the diff.
    act(() => updatePanelSettings({ diffTheme: 'dracula' }))

    await waitFor(() => expect(diffRoot).toHaveFocus())
  })

  test('changing the workspace theme preserves focused diff text fields', async (): Promise<void> => {
    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [{ path: 'src/App.tsx', status: 'modified', staged: false }],
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

    render(<Panel />)

    keyDown(screen.getByTestId('diff-populated-state'), {
      key: '/',
    })

    const input = await screen.findByRole('textbox', {
      name: /search in diff/i,
    })
    await waitFor(() => expect(input).toHaveFocus())

    act(() => {
      themeService.apply('flexoki')
    })

    await waitFor(() =>
      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-theme',
        'pierre-light'
      )
    )
    expect(input).toHaveFocus()
  })

  test('hover reveal waits before closing on mouse leave', (): void => {
    vi.useFakeTimers()

    try {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
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

      render(<Panel />)

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))
      expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

      fireEvent.mouseLeave(screen.getByTestId('changed-files-edge-hint'))
      act(() => {
        vi.advanceTimersByTime(219)
      })
      expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('keyboard reveal (e) auto-hides the changed-files panel after ~5s', (): void => {
    vi.useFakeTimers()

    try {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
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

      render(<Panel />)

      keyDown(screen.getByTestId('diff-populated-state'), {
        key: 'e',
      })
      expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(4999)
      })
      expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('pinning the changed-files panel persists and prevents hover close', (): void => {
    vi.useFakeTimers()

    try {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          {
            path: 'src/App.tsx',
            status: 'modified',
            staged: false,
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

      render(<Panel />)

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))
      fireEvent.click(
        screen.getByRole('button', { name: /pin changed files/i })
      )

      expect(window.localStorage.getItem('vf-diff-files-open')).toBe('1')

      expect(screen.getByTestId('diff-populated-state')).toHaveClass('flex-col')

      expect(screen.getByTestId('changed-files-pane')).toHaveClass(
        'h-full',
        'w-64',
        'shrink-0'
      )

      expect(screen.getByTestId('diff-body-region')).toContainElement(
        screen.getByTestId('changed-files-pane')
      )

      expect(screen.getByTestId('diff-body-region')).toContainElement(
        screen.getByTestId('diff-right-pane')
      )

      expect(screen.getByTestId('changed-files-pane')).not.toContainElement(
        screen.getByTestId('diff-toolbar-shell')
      )

      expect(screen.getByTestId('diff-right-pane')).toHaveClass('flex-1')

      fireEvent.mouseLeave(screen.getByTestId('changed-files-pane'))
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.getByTestId('changed-files-pane')).toBeInTheDocument()

      fireEvent.click(
        screen.getByRole('button', { name: /unpin changed files/i })
      )

      expect(window.localStorage.getItem('vf-diff-files-open')).toBe('0')
    } finally {
      vi.useRealTimers()
    }
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

    render(<Panel cwd="/home/user/project" />)

    expect(useGitStatusSpy).toHaveBeenCalledWith('/home/user/project', {
      watch: true,
      enabled: true,
    })

    expect(useFileDiffSpy).toHaveBeenCalledWith(
      null,
      false,
      '/home/user/project',
      undefined,
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
      <Panel
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

      const { rerender } = render(<Panel cwd="/repo" />)

      expect(screen.getByText('Loading diff…')).toBeInTheDocument()
      expect(screen.queryByTestId('diff-right-pane')).toBeNull()
      expect(MockResizeObserver.instances).toHaveLength(0)

      loading = false
      rerender(<Panel cwd="/repo" />)

      expect(screen.getByTestId('diff-right-pane')).toBeInTheDocument()

      setPaneWidth(DIFF_MIN_WIDTH_PX - 1)

      expect(screen.queryByTestId('multi-file-diff')).toBeNull()
      expect(
        screen.getByText('Pane is too narrow to render the diff.')
      ).toBeInTheDocument()
    })

    test('renders MultiFileDiff when paneWidth >= DIFF_MIN_WIDTH_PX', (): void => {
      render(<Panel cwd="/repo" />)

      setPaneWidth(DIFF_MIN_WIDTH_PX + 10)

      expect(screen.getByTestId('multi-file-diff')).toBeInTheDocument()
      expect(
        screen.queryByRole('status', {
          name: /pane is too narrow/i,
        })
      ).toBeNull()
    })

    test('renders DiffNarrowPlaceholder when paneWidth < DIFF_MIN_WIDTH_PX', (): void => {
      render(<Panel cwd="/repo" />)

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
      render(<Panel cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX - 1)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-diff-style')).toBe('unified')
    })

    test('keeps split preference when toggling forced unified below split width', (): void => {
      render(<Panel cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX - 1)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-diff-style',
        'unified'
      )

      keyDown(screen.getByTestId('diff-populated-state'), { key: 't' })
      setPaneWidth(SPLIT_MIN_WIDTH_PX + 1)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-diff-style',
        'split'
      )
    })

    test('renders split when paneWidth >= SPLIT_MIN_WIDTH_PX (default diffStyle)', (): void => {
      render(<Panel cwd="/repo" />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 1)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-diff-style')).toBe('split')
    })

    test('passes default theme + oldFile/newFile names to MultiFileDiff', (): void => {
      render(<Panel cwd="/repo" />)

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
        <Panel
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
        undefined,
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
        <Panel
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
        <Panel
          cwd="/repo/b"
          selectedFile={null}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Should show loading state (not stale files)
      expect(screen.getByText('Loading diff…')).toBeInTheDocument()
    })

    test('commitSelection tags with current cwd on click', async (): Promise<void> => {
      const user = userEvent.setup()

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
        <Panel
          cwd="/repo/b"
          selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '/repo/b' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

      // Find and click a different file row
      const otherFileRow = screen.getByText('Other.tsx')
      await user.click(otherFileRow)

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
        <Panel
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
        true,
        '/repo:0:new.ts:unstaged'
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
        <Panel
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
        <Panel
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
        <Panel
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
        <Panel
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
        <Panel
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
        <Panel
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

      render(<Panel cwd="/repo" />)

      // Should auto-select first file (via local state)
      expect(useFileDiffSpy).toHaveBeenCalledWith(
        'src/App.tsx',
        false,
        '/repo',
        false,
        '/repo:0:src/App.tsx:unstaged'
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

      const { rerender } = render(<Panel cwd="/repo/a" />)

      // Change cwd
      rerender(<Panel cwd="/repo/b" />)

      // Initially should call with null (stale selection from old cwd)
      // Then after filesCwd updates, should auto-select
      const calls = useFileDiffSpy.mock.calls
      // Last call should be with the correct file after auto-select
      const lastCall = calls[calls.length - 1]
      expect(lastCall).toEqual([
        'src/App.tsx',
        false,
        '/repo/b',
        false,
        '/repo/b:0:src/App.tsx:unstaged',
      ])
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

      render(<Panel />)

      // Panel's defaults are theme 'pierre-dark' + lineDiffType
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

      render(<Panel cwd="/repo" />)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Diff render sync failed: worker failed'
      )
    })

    test('remounts MultiFileDiff only after worker pool accepts a new theme', async (): Promise<void> => {
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

      render(<Panel cwd="/repo" />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-theme',
        'pierre-dark'
      )

      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(1)
      )

      act(() => updatePanelSettings({ diffTheme: 'pierre-light' }))

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

      await waitFor(() =>
        expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
          'data-theme',
          'pierre-light'
        )
      )
    })

    test('remounts MultiFileDiff only after worker pool accepts a new lineDiffType', async (): Promise<void> => {
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

      render(<Panel cwd="/repo" />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-line-diff-type',
        'word'
      )

      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(1)
      )

      act(() => updatePanelSettings({ diffLineDiffType: 'char' }))

      // lineDiffType MUST ride along with theme — it is a pool-owned option,
      // so the persisted setting would be a no-op without this push.
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

      await waitFor(() =>
        expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
          'data-line-diff-type',
          'char'
        )
      )
    })

    test('serializes pool writes so a newer change waits for the prior write', async (): Promise<void> => {
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

      render(<Panel cwd="/repo" />)

      // The mount write fires and is left pending (unresolved).
      await waitFor(() =>
        expect(workerPoolSetRenderOptionsMock).toHaveBeenCalledTimes(1)
      )

      // Change the theme while the mount write is still in flight.
      act(() => updatePanelSettings({ diffTheme: 'pierre-light' }))

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

  describe('Staging handlers (§5.3)', () => {
    // Shared hunk fixture. The rawDiff is real unified-diff text so
    // extractHunkPatch(rawDiff, 0) returns a non-null patch. The FileDiff
    // carries matching (newStart, newLines) coordinates so
    // findRawDiffHunkIndex also resolves to index 0 on the clean path.
    const hunkRawDiff =
      [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -5,3 +5,3 @@',
        ' context',
        '-removed',
        '+added',
      ].join('\n') + '\n'

    const hunkFileDiff: FileDiff = {
      filePath: 'src/foo.ts',
      oldPath: 'src/foo.ts',
      newPath: 'src/foo.ts',
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -5,3 +5,3 @@',
          oldStart: 5,
          oldLines: 3,
          newStart: 5,
          newLines: 3,
          lines: [
            { type: 'context', content: 'context' },
            { type: 'removed', content: 'removed' },
            { type: 'added', content: 'added' },
          ],
        },
      ],
    }

    // Spy-based GitService that resolves by default on all staging methods.
    // The returned service satisfies the GitService interface; the spies are
    // also returned separately so callers can assert on .mock.calls without
    // unsafe member-access on the untyped vi.fn() return value.
    interface ServiceSpies {
      service: GitService
      stageFile: MockInstance<(file: string, patch?: string) => Promise<void>>
      unstageFile: MockInstance<(file: string, patch?: string) => Promise<void>>
      discardChanges: MockInstance<
        (file: string, patch?: string) => Promise<void>
      >
    }

    const makeServiceSpy = (): ServiceSpies => {
      const stageFile = vi
        .fn<(file: string, patch?: string) => Promise<void>>()
        .mockResolvedValue(undefined)

      const unstageFile = vi
        .fn<(file: string, patch?: string) => Promise<void>>()
        .mockResolvedValue(undefined)

      const discardChanges = vi
        .fn<(file: string, patch?: string) => Promise<void>>()
        .mockResolvedValue(undefined)

      const service: GitService = {
        getStatus: vi.fn().mockResolvedValue([]),
        getDiff: vi.fn().mockResolvedValue({
          fileDiff: hunkFileDiff,
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
        }),
        stageFile,
        unstageFile,
        discardChanges,
      }

      return { service, stageFile, unstageFile, discardChanges }
    }

    beforeEach(() => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/foo.ts', status: 'modified', staged: false }],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })
    })

    test('stage: calls stageFile with extracted hunk patch; refetch and status refresh fire on success', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, stageFile } = makeServiceSpy()
      const refetchSpy = vi.fn()
      const refreshSpy = vi.fn()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/foo.ts', status: 'modified', staged: false }],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: refreshSpy,
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: refetchSpy,
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: 'stage' }))

      await waitFor(() => expect(stageFile).toHaveBeenCalledTimes(1))

      const [calledFile, calledPatch] = stageFile.mock.calls[0]
      expect(calledFile).toBe('src/foo.ts')
      expect(typeof calledPatch).toBe('string')
      expect(calledPatch!.length).toBeGreaterThan(0)
      expect(refetchSpy).toHaveBeenCalledTimes(1)
      expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    test('keyboard s confirms before staging the selected hunk', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, stageFile } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), { key: 's' })

      const confirm = await screen.findByRole('dialog', {
        name: 'Stage hunk?',
      })
      expect(stageFile).not.toHaveBeenCalled()
      const noButton = within(confirm).getByRole('button', { name: 'No (N)' })
      const yesButton = within(confirm).getByRole('button', { name: 'Yes (Y)' })
      expect(noButton).toHaveClass('focus-visible:ring-1')
      expect(noButton).toHaveClass('focus-visible:ring-primary')
      expect(noButton).not.toHaveClass('focus-visible:ring-0')
      expect(yesButton).toHaveClass('focus-visible:ring-1')
      expect(yesButton).toHaveClass('focus-visible:ring-primary')
      expect(yesButton).not.toHaveClass('focus-visible:ring-0')

      await user.click(yesButton)

      await waitFor(() => expect(stageFile).toHaveBeenCalledTimes(1))
    })

    test('keyboard d confirms before discarding the selected hunk', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, discardChanges } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), { key: 'd' })

      const confirm = await screen.findByRole('dialog', {
        name: 'Discard hunk?',
      })
      expect(discardChanges).not.toHaveBeenCalled()

      await user.click(within(confirm).getByRole('button', { name: 'Yes (Y)' }))

      await waitFor(() => expect(discardChanges).toHaveBeenCalledTimes(1))
    })

    test('keyboard D confirms before discarding the selected file', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, discardChanges } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'D',
        shiftKey: true,
      })

      const confirm = await screen.findByRole('dialog', {
        name: 'Discard file?',
      })
      expect(discardChanges).not.toHaveBeenCalled()

      await user.click(within(confirm).getByRole('button', { name: 'Yes (Y)' }))

      await waitFor(() => expect(discardChanges).toHaveBeenCalledTimes(1))
      expect(discardChanges.mock.calls[0][1]).toBeUndefined()
    })

    test('keyboard confirmation accepts n for no and y for yes', async (): Promise<void> => {
      const { service, stageFile } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 's' })
      expect(
        await screen.findByRole('dialog', { name: 'Stage hunk?' })
      ).toBeInTheDocument()

      keyDown(document, { key: 'n' })
      expect(stageFile).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Stage hunk?' })
        ).not.toBeInTheDocument()
      )

      keyDown(document, { key: 's' })
      expect(
        await screen.findByRole('dialog', { name: 'Stage hunk?' })
      ).toBeInTheDocument()

      keyDown(document, { key: 'y' })

      await waitFor(() => expect(stageFile).toHaveBeenCalledTimes(1))
    })

    test('stage: shows "Pierre split" notice and skips service call when findRawDiffHunkIndex returns -1', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, stageFile } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)
      // Force the mapping to fail — simulates Pierre splitting one git hunk
      // into two Pierre hunks so the focused Pierre hunk has coordinates that
      // don't appear in git's hunk list.
      vi.spyOn(pierreAdapterModule, 'findRawDiffHunkIndex').mockReturnValueOnce(
        -1
      )

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: 'stage' }))

      expect(
        await screen.findByText(
          /Pierre split this hunk differently than git — cannot stage this region/
        )
      ).toBeInTheDocument()

      expect(stageFile).not.toHaveBeenCalled()
    })

    test('stage: shows "Could not isolate" notice and skips service call when extractHunkPatch returns null', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, stageFile } = makeServiceSpy()
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)
      // rawDiff is empty — extractHunkPatch('', 0) returns null because there
      // are no @@ sections to split on, even though index 0 would be in range.
      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: '',
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: 'stage' }))

      expect(
        await screen.findByText(
          /Could not isolate this hunk — try refreshing the diff/
        )
      ).toBeInTheDocument()

      expect(stageFile).not.toHaveBeenCalled()
    })

    test('stage: shows "Failed to stage hunk" notice when service rejects, and staging flag clears', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, stageFile } = makeServiceSpy()
      stageFile.mockRejectedValue(new Error('patch does not apply'))
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)
      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: 'stage' }))

      expect(
        await screen.findByText(/Failed to stage hunk: patch does not apply/)
      ).toBeInTheDocument()

      // staging flag must clear in finally — chip re-enabled after failure
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'stage' })).not.toBeDisabled()
      )
    })

    test('unstage/discard notice messages contain the correct verb (I1 regression guard)', async (): Promise<void> => {
      const user = userEvent.setup()
      const { service, unstageFile, discardChanges } = makeServiceSpy()
      // Trigger IPC-failure path so each handler emits `Failed to ${verb} hunk`.
      // A copy-paste bug (I1) would make all three say "stage" — this catches it.
      unstageFile.mockRejectedValue(new Error('unstage err'))
      discardChanges.mockRejectedValue(new Error('discard err'))
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(service)

      // Staged file so the unstage chip renders (spec Section 4.7).
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/foo.ts', status: 'modified', staged: true }],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
        response: {
          fileDiff: hunkFileDiff as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: hunkRawDiff,
          repoRoot: '/repo',
        },
        diff: hunkFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: null,
        refetch: vi.fn(),
        acceptLatestDiff: vi.fn(),
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: true, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: 'unstage' }))
      expect(
        await screen.findByText(/Failed to unstage hunk: unstage err/)
      ).toBeInTheDocument()

      // Wait for staging flag to clear before the next action.
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'discard' })
        ).not.toBeDisabled()
      )

      await user.click(screen.getByRole('button', { name: 'discard' }))
      expect(
        await screen.findByText(/Failed to discard hunk: discard err/)
      ).toBeInTheDocument()
    })
  })

  describe('Hunk navigation (PR3)', () => {
    // Three-hunk fixture:
    //   hunk 0: additions, newStart=1, newLines=3   → selectedLines: start=1,end=3,side=additions
    //   hunk 1: additions, newStart=20, newLines=4  → selectedLines: start=20,end=23,side=additions
    //   hunk 2: deletion-only, oldStart=50, oldLines=2, newLines=0
    //                                               → selectedLines: start=50,end=51,side=deletions
    const threeHunkDiff: FileDiff = {
      filePath: 'src/multi.ts',
      oldPath: 'src/multi.ts',
      newPath: 'src/multi.ts',
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -1,3 +1,3 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [],
        },
        {
          id: 'hunk-1',
          header: '@@ -20,4 +20,4 @@',
          oldStart: 20,
          oldLines: 4,
          newStart: 20,
          newLines: 4,
          lines: [],
        },
        {
          id: 'hunk-2',
          header: '@@ -50,2 +50,0 @@',
          oldStart: 50,
          oldLines: 2,
          newStart: 50,
          newLines: 0,
          lines: [],
        },
      ],
    }

    beforeEach(() => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/multi.ts', status: 'modified', staged: false }],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: threeHunkDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )
    })

    test('initial render: no persistent hunk selection (gutter + follows hover)', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // PR4: the focused-hunk selection is only a transient flash on prev/next
      // navigation. There is no persistent selection on load — otherwise Pierre
      // would pin the comment-gutter "+" to the focused hunk instead of letting
      // it follow the mouse.
      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-selected-lines-start')).toBeNull()
      expect(diff.getAttribute('data-selected-lines-side')).toBeNull()
    })

    test('counter shows 1/3 on initial render', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      expect(
        screen.getByRole('group', { name: /hunk 1\/3/i })
      ).toBeInTheDocument()
    })

    test('shows 0/0 instead of the previous file hunk count while next diff loads', (): void => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/multi.ts', status: 'modified', staged: false },
          { path: 'src/other.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const { rerender } = render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      expect(
        screen.getByRole('group', { name: /hunk 1\/3/i })
      ).toBeInTheDocument()

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: threeHunkDiff,
          loading: true,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      rerender(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/other.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      expect(
        screen.getByRole('group', { name: /hunk 0\/0/i })
      ).toBeInTheDocument()
      expect(screen.queryByLabelText(/hunk 1\/3/i)).not.toBeInTheDocument()

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/other.ts',
            oldPath: 'src/other.ts',
            newPath: 'src/other.ts',
            hunks: [threeHunkDiff.hunks[0]],
          },
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      rerender(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/other.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      expect(
        screen.getByRole('group', { name: /hunk 1\/1/i })
      ).toBeInTheDocument()
    })

    test('clicking next-hunk advances focus: counter 2/3 and selectedLines from hunk 1', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /next hunk/i }))

      expect(
        screen.getByRole('group', { name: /hunk 2\/3/i })
      ).toBeInTheDocument()

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-selected-lines-start')).toBe('20')
      expect(diff.getAttribute('data-selected-lines-end')).toBe('23')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('additions')
    })

    test('[] moves the comment target to the first changed line in the target hunk', (): void => {
      const contextualThreeHunkDiff: FileDiff = {
        ...threeHunkDiff,
        hunks: [
          threeHunkDiff.hunks[0],
          {
            id: 'hunk-1',
            header: '@@ -18,3 +18,4 @@',
            oldStart: 18,
            oldLines: 3,
            newStart: 18,
            newLines: 4,
            lines: [
              {
                type: 'context',
                oldLineNumber: 18,
                newLineNumber: 18,
                content: 'before one',
              },
              {
                type: 'context',
                oldLineNumber: 19,
                newLineNumber: 19,
                content: 'before two',
              },
              {
                type: 'added',
                newLineNumber: 20,
                content: 'target change',
              },
              {
                type: 'context',
                oldLineNumber: 20,
                newLineNumber: 21,
                content: 'after',
              },
            ],
          },
          threeHunkDiff.hunks[2],
        ],
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: contextualThreeHunkDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const diff = screen.getByTestId('multi-file-diff')
      const scrollBody = screen.getByTestId('diff-scroll-body')
      const host = document.createElement('diffs-container')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const additions = document.createElement('div')
      const firstHunkLine = document.createElement('div')
      const changedHunkLine = document.createElement('div')
      const lastHunkLine = document.createElement('div')
      const scrollFirstHunkLineIntoView = vi.fn()
      const scrollLastHunkLineIntoView = vi.fn()

      const rect = (top: number, bottom: number): DOMRect => ({
        bottom,
        height: bottom - top,
        left: 0,
        right: 0,
        top,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      })
      let lastHunkLineRect = rect(40, 60)

      additions.setAttribute('data-additions', '')
      Object.defineProperty(scrollBody, 'clientHeight', {
        configurable: true,
        value: 80,
      })
      firstHunkLine.setAttribute('data-line-type', 'context')
      firstHunkLine.setAttribute('data-line', '18')
      changedHunkLine.setAttribute('data-line-type', 'change-addition')
      changedHunkLine.setAttribute('data-line', '20')
      lastHunkLine.setAttribute('data-line-type', 'context')
      lastHunkLine.setAttribute('data-line', '21')
      Object.defineProperty(firstHunkLine, 'scrollIntoView', {
        configurable: true,
        value: scrollFirstHunkLineIntoView,
      })

      Object.defineProperty(firstHunkLine, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(0, 20),
      })

      Object.defineProperty(lastHunkLine, 'scrollIntoView', {
        configurable: true,
        value: scrollLastHunkLineIntoView,
      })

      Object.defineProperty(lastHunkLine, 'getBoundingClientRect', {
        configurable: true,
        value: () => lastHunkLineRect,
      })

      additions.append(firstHunkLine, changedHunkLine, lastHunkLine)
      shadowRoot.append(additions)
      scrollBody.append(host)

      keyDown(diff, { key: ']' })
      expect(
        screen.getByRole('group', { name: /hunk 2\/3/i })
      ).toBeInTheDocument()
      expect(diff.getAttribute('data-selected-lines-start')).toBe('20')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('additions')
      expect(scrollFirstHunkLineIntoView).toHaveBeenCalledWith({
        block: 'start',
        inline: 'nearest',
      })

      expect(scrollLastHunkLineIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        inline: 'nearest',
      })

      lastHunkLineRect = rect(120, 140)
      scrollFirstHunkLineIntoView.mockClear()
      scrollLastHunkLineIntoView.mockClear()

      keyDown(diff, { key: ']' })
      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()
      expect(diff.getAttribute('data-selected-lines-start')).toBe('50')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('deletions')

      keyDown(diff, { key: '[' })
      expect(
        screen.getByRole('group', { name: /hunk 2\/3/i })
      ).toBeInTheDocument()
      expect(diff.getAttribute('data-selected-lines-start')).toBe('20')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('additions')
      expect(scrollFirstHunkLineIntoView).toHaveBeenCalledWith({
        block: 'start',
        inline: 'nearest',
      })
      expect(scrollLastHunkLineIntoView).not.toHaveBeenCalled()

      keyDown(diff, { key: 'i' })
      expect(
        screen.getByRole('dialog', { name: /Comment on line R20/ })
      ).toBeInTheDocument()
    })

    test('mouse-selected hunk is the start point for [] navigation', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const scrollBody = screen.getByTestId('diff-scroll-body')
      const hoveredLine = document.createElement('div')
      hoveredLine.setAttribute('data-line-type', 'change-addition')
      hoveredLine.setAttribute('data-line', '20')
      scrollBody.append(hoveredLine)

      fireEvent.pointerMove(hoveredLine)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff).toHaveAttribute('data-selected-lines-start', '20')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: ']' })

      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()
      expect(diff).toHaveAttribute('data-selected-lines-start', '50')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'deletions')
    })

    test('toolbar-selected hunk is the start point for [] navigation', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /next hunk/i }))

      const diff = screen.getByTestId('multi-file-diff')
      expect(
        screen.getByRole('group', { name: /hunk 2\/3/i })
      ).toBeInTheDocument()

      keyDown(diff, { key: ']' })

      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()
      expect(diff).toHaveAttribute('data-selected-lines-start', '50')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'deletions')
    })

    test('clicking next-hunk three times wraps from last hunk back to first', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Advance to hunk 2 (index 2)
      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      // Wrap around to hunk 0 (index 0)
      await user.click(screen.getByRole('button', { name: /next hunk/i }))

      expect(
        screen.getByRole('group', { name: /hunk 1\/3/i })
      ).toBeInTheDocument()

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-selected-lines-start')).toBe('1')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('additions')
    })

    test('clicking prev-hunk from first hunk wraps to last hunk', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /prev hunk/i }))

      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()

      const diff = screen.getByTestId('multi-file-diff')
      // Hunk 2 is deletion-only: oldStart=50, oldLines=2 → side=deletions, start=50, end=51
      expect(diff.getAttribute('data-selected-lines-start')).toBe('50')
      expect(diff.getAttribute('data-selected-lines-end')).toBe('51')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('deletions')
    })

    test('deletion-only hunk yields side=deletions using old-side coordinates', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Advance to hunk 2 (the deletion-only one)
      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      await user.click(screen.getByRole('button', { name: /next hunk/i }))

      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff.getAttribute('data-selected-lines-start')).toBe('50')
      expect(diff.getAttribute('data-selected-lines-end')).toBe('51')
      expect(diff.getAttribute('data-selected-lines-side')).toBe('deletions')
    })

    test('reset-on-file-change: focus resets to hunk 0 when selected file changes', async (): Promise<void> => {
      const user = userEvent.setup()
      const onSelectedFileChange = vi.fn()

      // Two files: multi.ts (3 hunks) and other.ts (1 hunk)
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/multi.ts', status: 'modified', staged: false },
          { path: 'src/other.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const { rerender } = render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Advance to hunk 2 on multi.ts
      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()

      // Switch to a different file (1 hunk only)
      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: {
            filePath: 'src/other.ts',
            oldPath: 'src/other.ts',
            newPath: 'src/other.ts',
            hunks: [
              {
                id: 'hunk-0',
                header: '@@ -5,2 +5,2 @@',
                oldStart: 5,
                oldLines: 2,
                newStart: 5,
                newLines: 2,
                lines: [],
              },
            ],
          },
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      rerender(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/other.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      // Focus must reset to 0: counter shows 1/1 (not 3/3 or out-of-range)
      expect(
        screen.getByRole('group', { name: /hunk 1\/1/i })
      ).toBeInTheDocument()
    })

    test('controlled mode does not clear restored selection when cwd changes during pane switches', async (): Promise<void> => {
      const onSelectedFileChange = vi.fn()

      const makeGitStatus = (filesCwd: string): UseGitStatusReturn => ({
        files: [
          { path: 'src/first.ts', status: 'modified', staged: false },
          { path: 'src/multi.ts', status: 'modified', staged: false },
        ],
        filesCwd,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const { rerender } = render(
        <Panel
          cwd="/repo-a"
          gitStatus={makeGitStatus('/repo-a')}
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo-a' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      expect(screen.getByTestId('multi-file-diff')).toBeInTheDocument()

      rerender(
        <Panel
          cwd="/repo-b"
          gitStatus={makeGitStatus('/repo-b')}
          selectedFile={{ path: 'src/first.ts', staged: false, cwd: '/repo-b' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      rerender(
        <Panel
          cwd="/repo-a"
          gitStatus={makeGitStatus('/repo-a')}
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo-a' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      await act(async () => {
        await Promise.resolve()
      })

      expect(onSelectedFileChange).not.toHaveBeenCalledWith(null)
    })

    test('clamp-on-shrink: same-file refetch with fewer hunks clamps focus (valid counter, staging not blocked)', async (): Promise<void> => {
      const user = userEvent.setup()

      const { rerender } = render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Focus the last hunk of the 3-hunk file (prev from hunk 0 wraps to 3/3).
      await user.click(screen.getByRole('button', { name: /prev hunk/i }))
      expect(
        screen.getByRole('group', { name: /hunk 3\/3/i })
      ).toBeInTheDocument()

      // Simulate a stage/discard refetch: SAME file (path + staged unchanged)
      // but the hunk array shrank 3 → 2 (the focused last hunk was discarded).
      // The file-change reset must NOT fire here; only the hunk-count clamp.
      const twoHunkDiff: FileDiff = {
        filePath: 'src/multi.ts',
        oldPath: 'src/multi.ts',
        newPath: 'src/multi.ts',
        hunks: [threeHunkDiff.hunks[0], threeHunkDiff.hunks[1]],
      }
      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: twoHunkDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      rerender(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/multi.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      // Index 2 clamps to 1: counter is the valid "2/2", never the invalid "3/2".
      // (The focused hunk now drives staging via the counter/index, not a
      // persistent Pierre selection — see the transient nav-flash design.)
      expect(
        screen.getByRole('group', { name: /hunk 2\/2/i })
      ).toBeInTheDocument()
      expect(screen.queryByLabelText(/hunk 3\/2/i)).not.toBeInTheDocument()
    })
  })

  describe('inline review comments', () => {
    const inlineFileDiff: FileDiff = {
      filePath: 'src/foo.ts',
      oldPath: 'src/foo.ts',
      newPath: 'src/foo.ts',
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -1,3 +1,3 @@',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [
            { type: 'context', content: 'alpha' },
            { type: 'added', content: 'beta' },
            { type: 'context', content: 'gamma' },
          ],
        },
      ],
    }

    beforeEach(() => {
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/foo.ts', status: 'modified', staged: false }],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )
    })

    test('clicking the gutter + opens a comment editor and submitting adds an annotation rendered via renderAnnotation', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      const addButton = within(gutterSlot).getByRole('button', {
        name: 'Add comment on this line',
      })

      await user.click(addButton)

      const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
      const textarea = within(dialog).getByPlaceholderText('Request change')

      await user.type(textarea, 'Great change!')
      await user.keyboard('{Enter}')

      expect(
        await screen.findByRole('button', { name: /finish feedback \(1\)/i })
      ).toBeInTheDocument()

      const annotationSlot = screen.getByTestId('annotation-slot')
      expect(
        within(annotationSlot).getByText('Great change!')
      ).toBeInTheDocument()
    })

    test('shows a changed-file cue for adding a file-level comment', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

      const commentButton = within(
        screen.getByTestId('changed-files-pane')
      ).getByRole('button', {
        name: 'Comment on file foo.ts',
      })

      vi.spyOn(commentButton, 'getBoundingClientRect').mockReturnValue({
        x: 42,
        y: 56,
        left: 42,
        top: 56,
        right: 64,
        bottom: 78,
        width: 22,
        height: 22,
        toJSON: () => ({}),
      } as DOMRect)

      await user.click(commentButton)

      expect(screen.getByTestId('file-comment-popover-anchor')).toHaveClass(
        'fixed'
      )

      expect(screen.getByTestId('file-comment-popover-anchor')).toHaveStyle({
        left: '42px',
        top: '78px',
      })

      expect(
        screen.getByRole('dialog', { name: 'Comment on file src/foo.ts' })
      ).toBeInTheDocument()
    })

    test('submitting a file-level comment stores an explicit file-scope annotation', async (): Promise<void> => {
      const user = userEvent.setup()

      const addAnnotation = vi.fn<UseFeedbackBatchReturn['addAnnotation']>(
        () => 'ok'
      )

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [],
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 0,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'I',
        shiftKey: true,
      })

      expect(screen.queryByTestId('changed-files-pane')).not.toBeInTheDocument()

      expect(screen.getByTestId('diff-right-pane')).toContainElement(
        screen.getByTestId('file-comment-popover-anchor')
      )

      const dialog = screen.getByRole('dialog', {
        name: 'Comment on file src/foo.ts',
      })
      const textarea = within(dialog).getByPlaceholderText('Request change')

      await user.type(textarea, 'Review the whole file')
      await user.keyboard('{Enter}')

      expect(addAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        expect.objectContaining({
          lineNumber: 0,
          side: 'additions',
          metadata: expect.objectContaining({
            text: 'Review the whole file',
            target: { scope: 'file' },
          }),
        })
      )
    })

    test('renders submitted file-level comments in the right pane, not the file list', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'I',
        shiftKey: true,
      })

      const dialog = screen.getByRole('dialog', {
        name: 'Comment on file src/foo.ts',
      })

      await user.type(
        within(dialog).getByPlaceholderText('Request change'),
        'Review the whole file'
      )
      await user.keyboard('{Enter}')

      const fileCommentsPanel = await screen.findByTestId(
        'file-level-comments-panel'
      )

      const commentList = within(fileCommentsPanel).getByTestId(
        'file-level-comments-list'
      )

      expect(
        within(fileCommentsPanel).getByText('Commented on file')
      ).toBeInTheDocument()

      expect(
        within(fileCommentsPanel).getByText('Review the whole file')
      ).toBeInTheDocument()

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

      expect(
        within(screen.getByTestId('changed-files-pane')).queryByText(
          'Review the whole file'
        )
      ).not.toBeInTheDocument()

      expect(fileCommentsPanel).not.toHaveClass('max-h-56')
      expect(commentList).not.toHaveClass('overflow-y-auto')
    })

    test('keyboard Shift+U edits the selected file-level comment', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'I',
        shiftKey: true,
      })

      await user.type(
        within(
          screen.getByRole('dialog', {
            name: 'Comment on file src/foo.ts',
          })
        ).getByPlaceholderText('Request change'),
        'Review the whole file'
      )
      await user.keyboard('{Enter}')

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'U',
        shiftKey: true,
      })

      const editDialog = screen.getByRole('dialog', {
        name: 'Comment on file src/foo.ts',
      })
      const textarea = within(editDialog).getByPlaceholderText('Request change')

      expect(textarea).toHaveValue('Review the whole file')

      await user.clear(textarea)
      await user.type(textarea, 'Updated file comment')
      await user.keyboard('{Enter}')

      const fileCommentsPanel = screen.getByTestId('file-level-comments-panel')

      expect(
        within(fileCommentsPanel).getByText('Updated file comment')
      ).toBeInTheDocument()

      expect(
        within(fileCommentsPanel).queryByText('Review the whole file')
      ).not.toBeInTheDocument()
    })

    test('keyboard Shift+U leaves dispatched file-level comments read-only', (): void => {
      const updateAnnotation = vi.fn()

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [
          {
            lineNumber: 0,
            side: 'additions',
            metadata: {
              id: 'comment-1',
              text: 'Sent file comment',
              author: 'self',
              createdAt: 1000,
              dispatchedAt: 2000,
              target: { scope: 'file' },
            },
          },
        ],
        addAnnotation: vi.fn(() => 'ok' as const),
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 1,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'U',
        shiftKey: true,
      })

      expect(
        screen.queryByRole('dialog', { name: 'Comment on file src/foo.ts' })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Sent file comment')).toBeInTheDocument()
      expect(updateAnnotation).not.toHaveBeenCalled()
    })

    test('hides a file-level draft when another file is selected', async (): Promise<void> => {
      const user = userEvent.setup()

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/foo.ts', status: 'modified', staged: false },
          { path: 'src/bar.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      const onSelectedFileChange = vi.fn()

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange,
      } as const

      const { rerender } = render(<Panel {...props} />)

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'I',
        shiftKey: true,
      })

      await user.type(
        within(
          screen.getByRole('dialog', {
            name: 'Comment on file src/foo.ts',
          })
        ).getByPlaceholderText('Request change'),
        'Draft for foo'
      )

      rerender(
        <Panel
          {...props}
          selectedFile={{ path: 'src/bar.ts', staged: false, cwd: '/repo' }}
        />
      )

      expect(
        screen.queryByRole('dialog', { name: 'Comment on file src/foo.ts' })
      ).not.toBeInTheDocument()

      expect(screen.getByTestId('diff-draft-recovery')).toHaveTextContent(
        'Draft preserved for file src/foo.ts'
      )
    })

    test('Focus: stays in the Diff View for comment edit, comment editor exit, and comment delete operations', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      const textarea = within(
        screen.getByRole('dialog', { name: /Comment on line/ })
      ).getByPlaceholderText('Request change')
      await user.type(textarea, 'Great change!')
      await user.keyboard('{Enter}')

      await user.click(screen.getByRole('button', { name: 'Edit comment' }))

      const editTextarea = within(
        screen.getByRole('dialog', { name: /Comment on line/ })
      ).getByPlaceholderText('Request change')
      expect(editTextarea).toHaveFocus()
      expect(editTextarea).toHaveValue('Great change!')
      await user.keyboard('{Escape}')
      expect(screen.getByTestId('diff-populated-state')).toHaveFocus()

      await user.click(screen.getByRole('button', { name: 'Delete comment' }))

      expect(screen.queryByText('Great change!')).not.toBeInTheDocument()
      expect(screen.getByTestId('diff-populated-state')).toHaveFocus()
    })

    test('j/k move the keyboard-selected comment target within the current file', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')

      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '2')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'k' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')
    })

    test('v enters visual mode and j/k extend or shrink the selected range', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')

      keyDown(diff, { key: 'v' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-end', '1')

      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-end', '2')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'k' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-end', '1')
    })

    test('mouse drag selects multiple diff rows', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const scrollBody = screen.getByTestId('diff-scroll-body')
      const firstLine = document.createElement('div')
      const secondLine = document.createElement('div')

      firstLine.setAttribute('data-line-type', 'context')
      firstLine.setAttribute('data-line', '1')
      secondLine.setAttribute('data-line-type', 'change-addition')
      secondLine.setAttribute('data-line', '2')
      scrollBody.append(firstLine, secondLine)

      fireEvent.pointerDown(firstLine, { button: 0 })
      fireEvent.pointerMove(secondLine, { buttons: 1 })
      fireEvent.pointerUp(secondLine)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-end', '2')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      fireEvent.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      expect(
        screen.getByRole('dialog', { name: /Comment on lines R1-R2/ })
      ).toBeInTheDocument()
    })

    test('j/k scroll Pierre shadow-DOM lines into view', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const scrollBody = screen.getByTestId('diff-scroll-body')
      const host = document.createElement('diffs-container')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const additions = document.createElement('div')
      additions.setAttribute('data-additions', '')
      const stickyHeader = document.createElement('div')
      stickyHeader.setAttribute('data-diffs-header', 'default')
      stickyHeader.setAttribute('data-sticky', '')
      const firstLine = document.createElement('div')
      const secondLine = document.createElement('div')
      const scrollFirstIntoView = vi.fn()
      const scrollSecondIntoView = vi.fn()

      const rect = (top: number, bottom: number): DOMRect => ({
        bottom,
        height: bottom - top,
        left: 0,
        right: 0,
        top,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      })

      firstLine.setAttribute('data-line-type', 'context')
      firstLine.setAttribute('data-line', '1')
      secondLine.setAttribute('data-line-type', 'context')
      secondLine.setAttribute('data-line', '2')
      Object.defineProperty(scrollBody, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(0, 400),
      })

      Object.defineProperty(stickyHeader, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(0, 28),
      })

      Object.defineProperty(firstLine, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(20, 40),
      })

      Object.defineProperty(firstLine, 'scrollIntoView', {
        configurable: true,
        value: scrollFirstIntoView,
      })

      Object.defineProperty(secondLine, 'scrollIntoView', {
        configurable: true,
        value: scrollSecondIntoView,
      })
      additions.append(firstLine, secondLine)
      shadowRoot.append(stickyHeader, additions)
      scrollBody.append(host)

      const diff = screen.getByTestId('multi-file-diff')

      keyDown(diff, { key: 'j' })
      expect(scrollSecondIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        inline: 'nearest',
      })

      scrollBody.scrollTop = 100

      keyDown(diff, { key: 'k' })
      expect(scrollFirstIntoView).toHaveBeenCalledWith({
        block: 'start',
        inline: 'nearest',
      })
      expect(scrollBody.scrollTop).toBe(68)
    })

    test('j does not scroll when split replacement navigation cannot leave the current row', (): void => {
      const changedFileDiff: FileDiff = {
        filePath: 'src/foo.ts',
        oldPath: 'src/foo.ts',
        newPath: 'src/foo.ts',
        hunks: [
          {
            id: 'hunk-0',
            header: '@@ -1 +1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { type: 'removed', oldLineNumber: 1, content: 'old beta' },
              { type: 'added', newLineNumber: 1, content: 'new beta' },
            ],
          },
        ],
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: changedFileDiff,
          loading: false,
          error: null,
          oldText: 'old beta\n',
          newText: 'new beta\n',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const scrollBody = screen.getByTestId('diff-scroll-body')
      const host = document.createElement('diffs-container')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const deletions = document.createElement('div')
      const additions = document.createElement('div')
      const deletionLine = document.createElement('div')
      const additionLine = document.createElement('div')
      const scrollDeletionIntoView = vi.fn()
      const scrollAdditionIntoView = vi.fn()

      deletions.setAttribute('data-deletions', '')
      additions.setAttribute('data-additions', '')
      deletionLine.setAttribute('data-line-type', 'change-deletion')
      deletionLine.setAttribute('data-line', '1')
      additionLine.setAttribute('data-line-type', 'change-addition')
      additionLine.setAttribute('data-line', '1')
      Object.defineProperty(deletionLine, 'scrollIntoView', {
        configurable: true,
        value: scrollDeletionIntoView,
      })

      Object.defineProperty(additionLine, 'scrollIntoView', {
        configurable: true,
        value: scrollAdditionIntoView,
      })
      deletions.append(deletionLine)
      additions.append(additionLine)
      shadowRoot.append(deletions, additions)
      scrollBody.append(host)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'l' })
      expect(scrollAdditionIntoView).toHaveBeenCalledWith({
        block: 'nearest',
        inline: 'nearest',
      })

      keyDown(diff, { key: 'h' })
      scrollDeletionIntoView.mockClear()

      keyDown(diff, { key: 'j' })

      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'deletions')
      expect(scrollDeletionIntoView).not.toHaveBeenCalled()
    })

    test('i opens the inline comment editor on the keyboard-selected line', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'j' })
      keyDown(diff, { key: 'i' })

      expect(
        screen.getByRole('dialog', { name: /Comment on line R2/ })
      ).toBeInTheDocument()
    })

    test('i opens a range comment editor for the visual selection', async (): Promise<void> => {
      const user = userEvent.setup()
      const addAnnotation = vi.fn(() => 'ok' as const)

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [],
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 0,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'v' })
      keyDown(diff, { key: 'j' })
      keyDown(diff, { key: 'i' })

      const dialog = screen.getByRole('dialog', {
        name: /Comment on lines R1-R2/,
      })

      await user.type(
        within(dialog).getByPlaceholderText('Request change'),
        'Review this range'
      )
      await user.keyboard('{Enter}')

      expect(addAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        expect.objectContaining({
          // Anchored at the range's last line so the comment renders below the
          // selection; the span stays in target (VIM-273).
          lineNumber: 2,
          side: 'additions',
          metadata: expect.objectContaining({
            text: 'Review this range',
            target: {
              scope: 'range',
              side: 'additions',
              startLine: 1,
              endLine: 2,
            },
          }),
        })
      )
    })

    test('gutter add comment uses the clicked line when a stale visual range is elsewhere', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'j' })
      keyDown(diff, { key: 'v' })
      keyDown(diff, { key: 'j' })

      expect(diff).toHaveAttribute('data-selected-lines-start', '2')
      expect(diff).toHaveAttribute('data-selected-lines-end', '3')

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      expect(
        screen.getByRole('dialog', { name: /Comment on line R1/ })
      ).toBeInTheDocument()

      expect(
        screen.queryByRole('dialog', { name: /Comment on lines R2-R3/ })
      ).not.toBeInTheDocument()
    })

    test('switching comment targets resets a stale draft category', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      await user.click(
        within(
          screen.getByRole('dialog', { name: /Comment on line R1/ })
        ).getByRole('button', { name: 'Question' })
      )

      mockedGutterHoverLine = 2

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      const nextLineDialog = screen.getByRole('dialog', {
        name: /Comment on line R2/,
      })

      expect(
        within(nextLineDialog).getByRole('button', { name: 'Change' })
      ).toHaveAttribute('aria-pressed', 'true')

      expect(
        within(nextLineDialog).getByRole('button', { name: 'Question' })
      ).toHaveAttribute('aria-pressed', 'false')

      fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

      await user.click(
        within(screen.getByTestId('changed-files-pane')).getByRole('button', {
          name: 'Comment on file foo.ts',
        })
      )

      const fileDialog = screen.getByRole('dialog', {
        name: 'Comment on file src/foo.ts',
      })

      expect(
        within(fileDialog).getByRole('button', { name: 'Change' })
      ).toHaveAttribute('aria-pressed', 'true')

      expect(
        within(fileDialog).getByRole('button', { name: 'Question' })
      ).toHaveAttribute('aria-pressed', 'false')
    })

    test('editing a comment clears a stale visual range before the next insert', async (): Promise<void> => {
      const user = userEvent.setup()
      const updateAnnotation = vi.fn()

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [
          {
            lineNumber: 1,
            side: 'additions',
            metadata: {
              id: 'comment-1',
              text: 'Existing comment',
              author: 'self',
              createdAt: 1000,
            },
          },
        ],
        addAnnotation: vi.fn(() => 'ok' as const),
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 1,
        pendingAnnotations: () => 1,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'v' })
      keyDown(diff, { key: 'j' })

      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-end', '2')

      await user.click(screen.getByRole('button', { name: 'Edit comment' }))

      const editTextarea = within(
        screen.getByRole('dialog', { name: /Comment on line R1/ })
      ).getByPlaceholderText('Request change')
      await user.clear(editTextarea)
      await user.type(editTextarea, 'Updated comment')
      await user.keyboard('{Enter}')

      expect(updateAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        'comment-1',
        { text: 'Updated comment', category: 'change' }
      )
      keyDown(diff, { key: 'i' })

      expect(
        screen.getByRole('dialog', { name: /Comment on line R2/ })
      ).toBeInTheDocument()

      expect(
        screen.queryByRole('dialog', { name: /Comment on lines R1-R2/ })
      ).not.toBeInTheDocument()
    })

    test('editing a range comment preserves the range endpoint', async (): Promise<void> => {
      const user = userEvent.setup()
      const updateAnnotation = vi.fn()

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [
          {
            lineNumber: 1,
            side: 'additions',
            metadata: {
              id: 'comment-1',
              text: 'Existing range comment',
              author: 'self',
              createdAt: 1000,
              target: {
                scope: 'range',
                side: 'additions',
                startLine: 1,
                endLine: 2,
              },
            },
          },
        ],
        addAnnotation: vi.fn(() => 'ok' as const),
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 1,
        pendingAnnotations: () => 1,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(screen.getByRole('button', { name: 'Edit comment' }))

      const editTextarea = within(
        screen.getByRole('dialog', { name: /Comment on lines R1-R2/ })
      ).getByPlaceholderText('Request change')
      await user.clear(editTextarea)
      await user.type(editTextarea, 'Updated range comment')
      await user.keyboard('{Enter}')

      expect(updateAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        'comment-1',
        { text: 'Updated range comment', category: 'change' }
      )
    })

    test('y copies the visual selection to the system clipboard', async (): Promise<void> => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const originalClipboard = window.navigator.clipboard

      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
        writable: true,
      })

      try {
        render(
          <Panel
            cwd="/repo"
            selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
            onSelectedFileChange={vi.fn()}
          />
        )

        setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

        const diff = screen.getByTestId('multi-file-diff')
        keyDown(diff, { key: 'v' })
        keyDown(diff, { key: 'j' })
        keyDown(diff, { key: 'y' })
        await waitFor(() =>
          expect(writeText).toHaveBeenCalledWith('alpha\nbeta')
        )
      } finally {
        Object.defineProperty(window.navigator, 'clipboard', {
          value: originalClipboard,
          configurable: true,
          writable: true,
        })
      }
    })

    test('Shift+I opens the file-level comment editor for the selected file', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'I',
        shiftKey: true,
      })

      expect(
        screen.getByRole('dialog', { name: 'Comment on file src/foo.ts' })
      ).toBeInTheDocument()
    })

    test('u and x update or delete the comment on the keyboard-selected line', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      const textarea = within(
        screen.getByRole('dialog', { name: /Comment on line R1/ })
      ).getByPlaceholderText('Request change')
      await user.type(textarea, 'Original comment')
      await user.keyboard('{Enter}')

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'u' })

      const editTextarea = within(
        screen.getByRole('dialog', { name: /Comment on line R1/ })
      ).getByPlaceholderText('Request change')
      expect(editTextarea).toHaveValue('Original comment')

      await user.clear(editTextarea)
      await user.type(editTextarea, 'Updated comment')
      await user.keyboard('{Enter}')

      expect(screen.getByText('Updated comment')).toBeInTheDocument()

      keyDown(diff, { key: 'x' })

      expect(screen.queryByText('Updated comment')).not.toBeInTheDocument()
    })

    test('u and x leave a dispatched keyboard-selected line comment read-only', (): void => {
      const updateAnnotation = vi.fn()
      const removeAnnotation = vi.fn()

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map(),
        annotationsForFile: () => [
          {
            lineNumber: 1,
            side: 'additions',
            metadata: {
              id: 'comment-1',
              text: 'Sent comment',
              author: 'self',
              createdAt: 1000,
              dispatchedAt: 2000,
            },
          },
        ],
        addAnnotation: vi.fn(() => 'ok' as const),
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation,
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 1,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'u' })
      keyDown(diff, { key: 'x' })

      expect(
        screen.queryByRole('dialog', { name: /Comment on line R1/ })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Sent comment')).toBeInTheDocument()
      expect(updateAnnotation).not.toHaveBeenCalled()
      expect(removeAnnotation).not.toHaveBeenCalled()
    })

    test('exiting a comment editor returns focus to the diff root', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'i' })

      const textarea = within(
        screen.getByRole('dialog', { name: /Comment on line R1/ })
      ).getByPlaceholderText('Request change')
      expect(textarea).toHaveFocus()

      await user.keyboard('{Escape}')

      expect(screen.getByTestId('diff-populated-state')).toHaveFocus()
    })

    test('comment editor text input does not trigger DiffView shortcuts', async (): Promise<void> => {
      const user = userEvent.setup()
      const onSelectedFileChange = vi.fn()

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/foo.ts', status: 'modified', staged: false },
          { path: 'src/bar.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '2')

      keyDown(diff, { key: 'i' })

      const textarea = within(
        screen.getByRole('dialog', { name: /Comment on line R2/ })
      ).getByPlaceholderText('Request change')

      await user.type(textarea, ['i', 'u', 'x', 'n', 'p'].join(''))

      expect(textarea).toHaveValue(['i', 'u', 'x', 'n', 'p'].join(''))
      expect(onSelectedFileChange).not.toHaveBeenCalled()
    })

    test('n and p navigate next and previous files', (): void => {
      const onSelectedFileChange = vi.fn()

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/foo.ts', status: 'modified', staged: false },
          { path: 'src/bar.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={onSelectedFileChange}
        />
      )

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 'n' })
      expect(screen.getByTestId('diff-populated-state')).toHaveFocus()

      keyDown(document, { key: 'p' })

      expect(onSelectedFileChange).toHaveBeenNthCalledWith(1, {
        path: 'src/bar.ts',
        staged: false,
        cwd: '/repo',
      })

      expect(onSelectedFileChange).toHaveBeenNthCalledWith(2, {
        path: 'src/bar.ts',
        staged: false,
        cwd: '/repo',
      })
    })

    test('keeps diff content clicks from bubbling to the dock focus steal', (): void => {
      const onSelectedFileChange = vi.fn()
      const dockPointerDown = vi.fn()

      render(
        <div
          data-testid="dock-panel"
          tabIndex={-1}
          onPointerDown={(event): void => {
            dockPointerDown()
            event.currentTarget.focus()
          }}
        >
          <div data-testid="diff-panel">
            <Panel
              cwd="/repo"
              gitStatus={{
                files: [
                  { path: 'src/foo.ts', status: 'modified', staged: false },
                  { path: 'src/bar.ts', status: 'modified', staged: false },
                ],
                filesCwd: '/repo',
                loading: false,
                error: null,
                refresh: vi.fn(),
                idle: false,
              }}
              selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
              onSelectedFileChange={onSelectedFileChange}
            />
          </div>
        </div>
      )

      fireEvent.pointerDown(screen.getByTestId('multi-file-diff'))

      expect(dockPointerDown).not.toHaveBeenCalled()
      expect(
        within(screen.getByTestId('diff-panel')).getByTestId(
          'diff-populated-state'
        )
      ).toHaveFocus()

      keyDown(document, { key: 'n' })

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/bar.ts',
        staged: false,
        cwd: '/repo',
      })
    })

    test('Ctrl+D and Ctrl+U page the diff scroll body and cursor together', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const scrollBody = screen.getByTestId('diff-scroll-body')
      Object.defineProperty(scrollBody, 'clientHeight', {
        configurable: true,
        value: 100,
      })

      const rect = (top: number, bottom: number): DOMRect => ({
        bottom,
        height: bottom - top,
        left: 0,
        right: 0,
        top,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      })

      Object.defineProperty(scrollBody, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(0, 100),
      })

      for (const line of [1, 2, 3]) {
        const element = document.createElement('div')
        const top = (line - 1) * 90

        element.setAttribute('data-line-type', 'context')
        element.setAttribute('data-line', String(line))
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () =>
            rect(top - scrollBody.scrollTop, top - scrollBody.scrollTop + 20),
        })
        scrollBody.append(element)
      }

      keyDown(screen.getByTestId('multi-file-diff'), {
        key: 'd',
        ctrlKey: true,
      })
      const diff = screen.getByTestId('multi-file-diff')
      expect(scrollBody.scrollTop).toBe(160)
      expect(diff).toHaveAttribute('data-selected-lines-start', '3')
      expect(screen.getByTestId('diff-populated-state')).toHaveFocus()

      keyDown(document, { key: 'u', ctrlKey: true })
      expect(scrollBody.scrollTop).toBe(0)
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
    })

    test('t toggles split and unified view', (): void => {
      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      expect(diff).toHaveAttribute('data-diff-style', 'split')

      keyDown(diff, { key: 't' })

      expect(diff).toHaveAttribute('data-diff-style', 'unified')
    })

    test('j/k move rows and h/l move the keyboard-selected comment target between split sides', (): void => {
      const changedFileDiff: FileDiff = {
        filePath: 'src/foo.ts',
        oldPath: 'src/foo.ts',
        newPath: 'src/foo.ts',
        hunks: [
          {
            id: 'hunk-0',
            header: '@@ -1,2 +1,2 @@',
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: 'removed', oldLineNumber: 1, content: 'old beta' },
              { type: 'added', newLineNumber: 1, content: 'new beta' },
              {
                type: 'context',
                oldLineNumber: 2,
                newLineNumber: 2,
                content: 'tail',
              },
            ],
          },
        ],
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: changedFileDiff,
          loading: false,
          error: null,
          oldText: 'old beta\ntail\n',
          newText: 'new beta\ntail\n',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')

      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '2')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'k' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'h' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'deletions')

      keyDown(diff, { key: 'l' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'h' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'deletions')

      keyDown(diff, { key: 'i' })
      expect(
        screen.getByRole('dialog', { name: /Comment on line L1/ })
      ).toBeInTheDocument()
    })

    test('j/k step through both replacement lines in unified view', (): void => {
      const changedFileDiff: FileDiff = {
        filePath: 'src/foo.ts',
        oldPath: 'src/foo.ts',
        newPath: 'src/foo.ts',
        hunks: [
          {
            id: 'hunk-0',
            header: '@@ -1,2 +1,2 @@',
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: 'removed', oldLineNumber: 1, content: 'old beta' },
              { type: 'added', newLineNumber: 1, content: 'new beta' },
              {
                type: 'context',
                oldLineNumber: 2,
                newLineNumber: 2,
                content: 'tail',
              },
            ],
          },
        ],
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: changedFileDiff,
          loading: false,
          error: null,
          oldText: 'old beta\ntail\n',
          newText: 'new beta\ntail\n',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const diff = screen.getByTestId('multi-file-diff')
      keyDown(diff, { key: 't' })
      expect(diff).toHaveAttribute('data-diff-style', 'unified')

      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'j' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '2')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')

      keyDown(diff, { key: 'k' })
      expect(diff).toHaveAttribute('data-selected-lines-start', '1')
      expect(diff).toHaveAttribute('data-selected-lines-side', 'additions')
    })

    test('preserves comment draft text across a same-file diff refresh remount', async (): Promise<void> => {
      const user = userEvent.setup()
      let newText = 'new'

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(() =>
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText,
          rawDiff: '',
        })
      )

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange: vi.fn(),
      } as const

      const { rerender } = render(<Panel {...props} />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      await user.click(
        within(gutterSlot).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      const textarea = within(
        screen.getByRole('dialog', { name: /Comment on line/ })
      ).getByPlaceholderText('Request change')

      await user.type(textarea, 'Draft while agent edits')
      expect(textarea).toHaveValue('Draft while agent edits')

      newText = 'new after agent edit'
      rerender(<Panel {...props} />)

      expect(screen.getByPlaceholderText('Request change')).toHaveValue(
        'Draft while agent edits'
      )
    })

    test('preserves comment draft text when selected file temporarily clears before returning', async (): Promise<void> => {
      const user = userEvent.setup()

      const changedFile = {
        path: 'src/foo.ts',
        status: 'modified' as const,
        staged: false,
      }

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation((path) =>
        fileDiffMock({
          diff: path === null ? null : inlineFileDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      const controlledProps = {
        cwd: '/repo',
        onSelectedFileChange: vi.fn(),
      } as const

      const loadedGitStatus = {
        files: [changedFile],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }

      const emptyGitStatus = {
        ...loadedGitStatus,
        files: [],
      }

      const { rerender } = render(
        <Panel
          {...controlledProps}
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          gitStatus={loadedGitStatus}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      await user.type(
        within(
          screen.getByRole('dialog', { name: /Comment on line/ })
        ).getByPlaceholderText('Request change'),
        'Draft through transient empty selection'
      )

      rerender(
        <Panel
          {...controlledProps}
          selectedFile={null}
          gitStatus={emptyGitStatus}
        />
      )

      expect(screen.queryByPlaceholderText('Request change')).toBeNull()

      rerender(
        <Panel
          {...controlledProps}
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          gitStatus={loadedGitStatus}
        />
      )

      expect(await screen.findByPlaceholderText('Request change')).toHaveValue(
        'Draft through transient empty selection'
      )
    })

    test('shows manual refresh only when the visible active-file diff is out of sync', async (): Promise<void> => {
      const user = userEvent.setup()
      const acceptLatestDiff = vi.fn()
      let fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: false,
        error: null,
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      const useFileDiffSpy = vi
        .spyOn(useFileDiffModule, 'useFileDiff')
        .mockImplementation(() => fileDiffState)

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange: vi.fn(),
      } as const

      const gitStatus = {
        files: [
          { path: 'src/foo.ts', status: 'modified' as const, staged: false },
        ],
        filesCwd: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }

      const { rerender } = render(<Panel {...props} gitStatus={gitStatus} />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-new-contents',
        'new v1'
      )

      fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: true,
        error: null,
        latestDiffStatus: 'updating',
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      rerender(<Panel {...props} gitStatus={{ ...gitStatus, revision: 2 }} />)

      expect(screen.queryByText('Loading diff…')).not.toBeInTheDocument()
      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-new-contents',
        'new v1'
      )

      expect(
        screen.queryByRole('button', { name: 'refresh diff' })
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Updating diff...')).not.toBeInTheDocument()

      fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: 'ready',
        acceptLatestDiff,
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      rerender(<Panel {...props} gitStatus={{ ...gitStatus, revision: 2 }} />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-new-contents',
        'new v1'
      )
      await user.click(screen.getByRole('button', { name: 'refresh diff' }))
      expect(acceptLatestDiff).toHaveBeenCalledOnce()

      expect(useFileDiffSpy).toHaveBeenLastCalledWith(
        'src/foo.ts',
        false,
        '/repo',
        false,
        '/repo:2:src/foo.ts:unstaged'
      )
    })

    test('r refreshes the active diff when the latest diff is ready', (): void => {
      const acceptLatestDiff = vi.fn()

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          latestDiffStatus: 'ready',
          acceptLatestDiff,
          oldText: 'old',
          newText: 'new v1',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), { key: 'r' })

      expect(acceptLatestDiff).toHaveBeenCalledOnce()
    })

    test('r does not refresh the active diff until the latest diff is ready', (): void => {
      const acceptLatestDiff = vi.fn()

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          latestDiffStatus: 'updating',
          acceptLatestDiff,
          oldText: 'old',
          newText: 'new v1',
          rawDiff: '',
        })
      )

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      keyDown(screen.getByTestId('multi-file-diff'), { key: 'r' })

      expect(acceptLatestDiff).not.toHaveBeenCalled()
    })

    test('reclaims focus when a focused element unmounts silently', async (): Promise<void> => {
      const onSelectedFileChange = vi.fn()
      const acceptLatestDiff = vi.fn()
      let fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: 'ready',
        acceptLatestDiff,
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(
        () => fileDiffState
      )

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange,
      } as const

      const gitStatus = {
        files: [
          {
            path: 'src/foo.ts',
            status: 'modified' as const,
            staged: false,
          },
          {
            path: 'src/bar.ts',
            status: 'modified' as const,
            staged: false,
          },
        ],
        filesCwd: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }

      const { rerender } = render(
        <div data-testid="diff-panel">
          <Panel {...props} gitStatus={gitStatus} />
        </div>
      )
      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const refreshButton = screen.getByRole('button', {
        name: 'refresh diff',
      })
      refreshButton.focus()
      fireEvent.focusIn(refreshButton)
      expect(refreshButton).toHaveFocus()

      fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: true,
        error: null,
        latestDiffStatus: 'updating',
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      rerender(
        <div data-testid="diff-panel">
          <Panel
            {...props}
            gitStatus={{ ...gitStatus, revision: gitStatus.revision + 1 }}
          />
        </div>
      )

      expect(
        screen.queryByRole('button', { name: 'refresh diff' })
      ).not.toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getByTestId('diff-panel')).toContainElement(
          // eslint-disable-next-line testing-library/no-node-access -- asserting focus stayed inside the diff panel
          document.activeElement as HTMLElement
        )
      })

      keyDown(document, { key: 'n' })

      expect(onSelectedFileChange).toHaveBeenCalledWith({
        path: 'src/bar.ts',
        staged: false,
        cwd: '/repo',
      })
    })

    test('does not reclaim focus after an outside pointerdown', (): void => {
      const onSelectedFileChange = vi.fn()
      const acceptLatestDiff = vi.fn()
      let fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: false,
        error: null,
        latestDiffStatus: 'ready',
        acceptLatestDiff,
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(
        () => fileDiffState
      )

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange,
      } as const

      const gitStatus = {
        files: [
          {
            path: 'src/foo.ts',
            status: 'modified' as const,
            staged: false,
          },
          {
            path: 'src/bar.ts',
            status: 'modified' as const,
            staged: false,
          },
        ],
        filesCwd: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }

      const { rerender } = render(
        <>
          <button type="button">Outside</button>
          <div data-testid="diff-panel">
            <Panel {...props} gitStatus={gitStatus} />
          </div>
        </>
      )
      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const refreshButton = screen.getByRole('button', {
        name: 'refresh diff',
      })
      refreshButton.focus()
      fireEvent.focusIn(refreshButton)
      expect(refreshButton).toHaveFocus()

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))

      fileDiffState = fileDiffMock({
        diff: inlineFileDiff,
        loading: true,
        error: null,
        latestDiffStatus: 'updating',
        oldText: 'old',
        newText: 'new v1',
        rawDiff: '',
      })

      rerender(
        <>
          <button type="button">Outside</button>
          <div data-testid="diff-panel">
            <Panel
              {...props}
              gitStatus={{ ...gitStatus, revision: gitStatus.revision + 1 }}
            />
          </div>
        </>
      )

      // eslint-disable-next-line testing-library/no-node-access -- asserting the browser body-focus handoff was not reclaimed
      expect(document.activeElement).toBe(document.body)

      keyDown(document, { key: 'n' })

      expect(onSelectedFileChange).not.toHaveBeenCalled()
    })

    test('restores diff focus when a focused refresh chip unmounts', (): void => {
      const onSelectedFileChange = vi.fn()
      const acceptLatestDiff = vi.fn()
      const rafCallbacks: FrameRequestCallback[] = []
      const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)

      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback): number => {
          rafCallbacks.push(callback)

          return rafCallbacks.length
        }
      )

      try {
        let fileDiffState = fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          latestDiffStatus: 'ready',
          acceptLatestDiff,
          oldText: 'old',
          newText: 'new v1',
          rawDiff: '',
        })

        vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(
          () => fileDiffState
        )

        const props = {
          cwd: '/repo',
          selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
          onSelectedFileChange,
        } as const

        const gitStatus = {
          files: [
            {
              path: 'src/foo.ts',
              status: 'modified' as const,
              staged: false,
            },
            {
              path: 'src/bar.ts',
              status: 'modified' as const,
              staged: false,
            },
          ],
          filesCwd: '/repo',
          revision: 1,
          loading: false,
          error: null,
          refresh: vi.fn(),
          idle: false,
        }

        const { rerender } = render(<Panel {...props} gitStatus={gitStatus} />)
        setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

        const refreshButton = screen.getByRole('button', {
          name: 'refresh diff',
        })
        refreshButton.focus()
        expect(refreshButton).toHaveFocus()

        fireEvent.blur(refreshButton, { relatedTarget: null })

        fileDiffState = fileDiffMock({
          diff: inlineFileDiff,
          loading: true,
          error: null,
          latestDiffStatus: 'updating',
          oldText: 'old',
          newText: 'new v1',
          rawDiff: '',
        })

        rerender(
          <Panel
            {...props}
            gitStatus={{ ...gitStatus, revision: gitStatus.revision + 1 }}
          />
        )

        expect(
          screen.queryByRole('button', { name: 'refresh diff' })
        ).not.toBeInTheDocument()

        act(() => {
          for (const callback of rafCallbacks) {
            callback(0)
          }
        })

        expect(screen.getByTestId('diff-populated-state')).toHaveFocus()

        keyDown(document, { key: 'n' })

        expect(onSelectedFileChange).toHaveBeenCalledWith({
          path: 'src/bar.ts',
          staged: false,
          cwd: '/repo',
        })
      } finally {
        hasFocusSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    test('does not restore diff focus after an outside non-focusable pointerdown blur', (): void => {
      const rafCallbacks: FrameRequestCallback[] = []
      const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true)

      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback): number => {
          rafCallbacks.push(callback)

          return rafCallbacks.length
        }
      )

      try {
        vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
          fileDiffMock({
            diff: inlineFileDiff,
            loading: false,
            error: null,
            latestDiffStatus: 'ready',
            oldText: 'old',
            newText: 'new v1',
            rawDiff: '',
          })
        )

        render(
          <>
            <div data-testid="outside-non-focusable" />
            <Panel
              cwd="/repo"
              selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
              onSelectedFileChange={vi.fn()}
            />
          </>
        )
        setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

        const diffRoot = screen.getByTestId('diff-populated-state')
        diffRoot.focus()
        fireEvent.focusIn(diffRoot)
        expect(diffRoot).toHaveFocus()

        fireEvent.pointerDown(screen.getByTestId('outside-non-focusable'))
        act(() => {
          diffRoot.blur()
        })

        expect(rafCallbacks).toHaveLength(1)
        // eslint-disable-next-line testing-library/no-node-access -- asserting the body-focus handoff is not reclaimed
        expect(document.activeElement).toBe(document.body)

        act(() => {
          for (const callback of rafCallbacks) {
            callback(0)
          }
        })

        // eslint-disable-next-line testing-library/no-node-access -- asserting focus was not pulled back into the diff panel
        expect(document.activeElement).toBe(document.body)
      } finally {
        hasFocusSpy.mockRestore()
        vi.unstubAllGlobals()
      }
    })

    test('keeps submitted comments when manual refresh swaps the diff response', async (): Promise<void> => {
      const user = userEvent.setup()
      let newText = 'new v1'

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(() =>
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText,
          rawDiff: '',
        })
      )

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange: vi.fn(),
      } as const

      const { rerender } = render(<Panel {...props} />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      await user.type(
        within(
          screen.getByRole('dialog', { name: /Comment on line/ })
        ).getByPlaceholderText('Request change'),
        'Comment survives refresh'
      )
      await user.keyboard('{Enter}')

      expect(screen.getByText('Comment survives refresh')).toBeInTheDocument()

      newText = 'new v2'
      rerender(<Panel {...props} />)

      expect(screen.getByTestId('multi-file-diff')).toHaveAttribute(
        'data-new-contents',
        'new v2'
      )
      expect(screen.getByText('Comment survives refresh')).toBeInTheDocument()
    })

    test('keeps a recoverable draft notice when refresh removes the target line', async (): Promise<void> => {
      const user = userEvent.setup()
      let currentDiff: FileDiff = inlineFileDiff

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(() =>
        fileDiffMock({
          diff: currentDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
        })
      )

      const props = {
        cwd: '/repo',
        selectedFile: { path: 'src/foo.ts', staged: false, cwd: '/repo' },
        onSelectedFileChange: vi.fn(),
      } as const

      const { rerender } = render(<Panel {...props} />)

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      await user.click(
        within(screen.getByTestId('gutter-utility-slot')).getByRole('button', {
          name: 'Add comment on this line',
        })
      )

      await user.type(
        within(
          screen.getByRole('dialog', { name: /Comment on line/ })
        ).getByPlaceholderText('Request change'),
        'Draft after disappearing hunk'
      )

      currentDiff = {
        ...inlineFileDiff,
        hunks: [],
      }
      rerender(<Panel {...props} />)

      expect(
        screen.queryByRole('dialog', { name: /Comment on line/ })
      ).not.toBeInTheDocument()

      expect(screen.getByTestId('diff-draft-recovery')).toHaveTextContent(
        'Draft after disappearing hunk'
      )
    })

    test('onDiscardFeedback (Discard action) clears the batch', async (): Promise<void> => {
      const user = userEvent.setup()

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      const addButton = within(gutterSlot).getByRole('button', {
        name: 'Add comment on this line',
      })

      await user.click(addButton)

      const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
      const textarea = within(dialog).getByPlaceholderText('Request change')

      await user.type(textarea, 'Great change!')
      await user.keyboard('{Enter}')

      expect(
        await screen.findByRole('button', { name: /finish feedback \(1\)/i })
      ).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', { name: /discard all feedback/i })
      )

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /finish feedback/i })
        ).not.toBeInTheDocument()
      )

      expect(screen.queryByText('Great change!')).not.toBeInTheDocument()
    })

    test('Finish with one running candidate dispatches via writePty and keeps the sent comment in the hunk', async (): Promise<void> => {
      const user = userEvent.setup()
      let pendingWasRegisteredBeforeWrite = false

      const writePty = vi
        .fn<(ptyId: string, data: string) => Promise<void>>()
        .mockImplementation((ptyId, payload) => {
          const nonce = /"nonce":"(\w+)"/.exec(payload)?.[1] ?? ''
          pendingWasRegisteredBeforeWrite =
            getPendingReview(ptyId, nonce) !== undefined

          return Promise.resolve()
        })
      const focusTerminal = vi.fn()

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo',
        status: 'running',
        isFocused: true,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal,
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      const addButton = within(gutterSlot).getByRole('button', {
        name: 'Add comment on this line',
      })

      await user.click(addButton)

      const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
      const textarea = within(dialog).getByPlaceholderText('Request change')

      await user.type(textarea, 'Great change!')
      await user.keyboard('{Enter}')

      expect(
        await screen.findByRole('button', { name: /finish feedback \(1\)/i })
      ).toBeInTheDocument()

      await user.keyboard('{Shift>}y{/Shift}')

      const popover = await screen.findByRole('dialog', {
        name: 'Finish feedback',
      })
      expect(popover).toHaveTextContent(/Send 1 comment/)

      expect(
        within(popover).getByRole('button', { name: 'Confirm (Shift+Y)' })
      ).toHaveAttribute('aria-keyshortcuts', 'Shift+Y')

      await user.keyboard('{Shift>}y{/Shift}')

      await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))
      expect(pendingWasRegisteredBeforeWrite).toBe(true)
      await waitFor(() => expect(focusTerminal).toHaveBeenCalledOnce())

      const [, payload] = writePty.mock.calls[0]
      expect(typeof payload).toBe('string')
      expect(payload).toContain('\x1b[200~')
      // P1 fix: the dispatched reference is an ABSOLUTE path (repoRoot joined
      // with the repo-relative file path), so an agent in any cwd resolves it.
      expect(payload).toContain('/repo/')

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /finish feedback/i })
        ).not.toBeInTheDocument()
      )

      // VIM-282: the dispatched comment stays in the hunk as a thread anchor
      // instead of being wiped on send.
      expect(screen.getByText('Great change!')).toBeInTheDocument()

      // VIM-249: a pending review is recorded for this pty, keyed by [#n], so an
      // agent reply can be correlated back. The path is the repo-relative batch
      // key, not the absolute prompt path.
      // The record is keyed by the minted nonce (VIM-297) — read it from the
      // dispatched payload, proving the stored record matches what the agent
      // will echo back.
      const nonce = /"nonce":"(\w+)"/.exec(payload)?.[1] ?? ''
      const pending = getPendingReview('pty-1', nonce)
      expect(pending?.ownerKey).toBe('sess:pane-1')
      expect(pending?.byHandle.get(1)?.filePath).toBe('src/foo.ts')
      expect(pending?.byHandle.get(1)?.lineNumber).toBe(1)
      // VIM-298: handle carries the threadId so a reply lands in the right
      // thread. The only dispatched comment is a fresh root, which self-roots —
      // its threadId must be its own generated comment id.
      const handle1 = pending?.byHandle.get(1)
      expect(handle1?.threadId).toMatch(
        /^feedback-comment-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )

      clearPendingReview('pty-1', nonce) // module singleton — don't leak into other tests
    })

    test('Send now dispatches only the addressed comment; the rest stay pending (VIM-297)', async (): Promise<void> => {
      const user = userEvent.setup()
      const writePty = vi.fn().mockResolvedValue(undefined)
      const focusTerminal = vi.fn()

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo',
        status: 'running',
        isFocused: true,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal,
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      const addButton = within(gutterSlot).getByRole('button', {
        name: 'Add comment on this line',
      })

      await user.click(addButton)
      const first = screen.getByRole('dialog', { name: /Comment on line/ })
      await user.type(
        within(first).getByPlaceholderText('Request change'),
        'First note'
      )
      await user.keyboard('{Enter}')

      await user.click(addButton)
      const second = screen.getByRole('dialog', { name: /Comment on line/ })
      await user.type(
        within(second).getByPlaceholderText('Request change'),
        'Second note'
      )
      await user.keyboard('{Enter}')

      expect(
        await screen.findByRole('button', { name: /finish feedback \(2\)/i })
      ).toBeInTheDocument()

      const sendButtons = screen.getAllByRole('button', {
        name: 'Send comment now',
      })
      expect(sendButtons).toHaveLength(2)
      await user.click(sendButtons[0])

      const popover = await screen.findByRole('dialog', {
        name: 'Finish feedback',
      })
      expect(popover).toHaveTextContent(/Send 1 comment/)

      await user.keyboard('{Shift>}y{/Shift}')

      await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))
      const [, payload] = writePty.mock.calls[0]
      expect(payload as string).toContain('First note')
      expect(payload as string).not.toContain('Second note')
      expect(payload as string).toContain('[#1')
      expect(payload as string).not.toContain('[#2')

      // The other comment is untouched and still dispatches on Finish.
      expect(
        await screen.findByRole('button', { name: /finish feedback \(1\)/i })
      ).toBeInTheDocument()
      expect(screen.getByText('Second note')).toBeInTheDocument()

      // Its correlation record covers exactly the one dispatched handle.
      const nonce = /"nonce":"(\w+)"/.exec(payload as string)?.[1] ?? ''
      const pending = getPendingReview('pty-1', nonce)
      expect(pending?.byHandle.size).toBe(1)
      expect(pending?.byHandle.get(1)?.lineNumber).toBe(1)

      clearPendingReview('pty-1', nonce)
    })

    test('preserves the comment draft and shows a notification when the feedback cap is reached', async (): Promise<void> => {
      const user = userEvent.setup()
      const addAnnotationSpy = vi.fn().mockReturnValue('cap-reached')

      const spy = vi
        .spyOn(useFeedbackBatchModule, 'useFeedbackBatch')
        .mockReturnValue({
          batch: new Map(),
          annotationsForFile: () => [],
          addAnnotation: addAnnotationSpy,
          addAnnotationForOwner: vi.fn(() => 'ok' as const),
          updateAnnotation: vi.fn(),
          removeAnnotation: vi.fn(),
          clearBatch: vi.fn(),
          clearPending: vi.fn(),
          markDispatched: vi.fn(),
          totalAnnotations: () => 50,
          pendingAnnotations: () => 50,
        })

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const gutterSlot = screen.getByTestId('gutter-utility-slot')

      const addButton = within(gutterSlot).getByRole('button', {
        name: 'Add comment on this line',
      })

      await user.click(addButton)

      const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
      const textarea = within(dialog).getByPlaceholderText('Request change')

      await user.type(textarea, 'Draft comment')
      await user.keyboard('{Enter}')

      expect(addAnnotationSpy).toHaveBeenCalledTimes(1)
      expect(
        screen.getByRole('dialog', { name: /Comment on line/ })
      ).toBeInTheDocument()

      expect(
        await screen.findByText(/Feedback limit reached/)
      ).toBeInTheDocument()

      spy.mockRestore()
    })

    test('thread reply inserts pre-stamped before dispatch and reopens (VIM-298)', async (): Promise<void> => {
      const user = userEvent.setup()
      const writePty = vi.fn().mockResolvedValue(undefined)
      const focusTerminal = vi.fn()

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo',
        status: 'running',
        isFocused: true,
      }

      // Seed: dispatched root (resolved) + agent turn + unrelated pending comment
      const addAnnotation = vi.fn<UseFeedbackBatchReturn['addAnnotation']>(
        () => 'ok'
      )
      const updateAnnotation = vi.fn()

      const batchAnnotations: DiffLineAnnotation<ReviewComment>[] = [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'root-c1',
            text: 'Why does this work?',
            author: 'self',
            category: 'question',
            createdAt: 1000,
            dispatchedAt: 1000,
            dispatchedTo: 'pty-1',
            threadId: 'root-c1',
            resolvedAt: 9999,
          },
        },
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'agent-g1',
            text: 'Because of backpressure.',
            author: 'agent',
            outcome: 'clarify',
            createdAt: 2000,
            threadId: 'root-c1',
          },
        },
        {
          lineNumber: 1,
          side: 'additions',
          metadata: {
            id: 'pending-p9',
            text: 'Unrelated pending comment',
            author: 'self',
            createdAt: 3000,
          },
        },
      ]

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [makeBatchKey('/repo', 'src/foo.ts', false), batchAnnotations],
        ]),
        annotationsForFile: () => batchAnnotations,
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 3,
        // Only pending-p9 is pending (no dispatchedAt, author self)
        pendingAnnotations: () => 1,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackBatch={feedbackBatch}
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal,
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      // The thread card renders in the annotation slot. The thread is resolved so
      // it starts collapsed — expand it first via the disclosure button.
      const annotationSlot = screen.getByTestId('annotation-slot')

      const disclosureButton = within(annotationSlot).getByRole('button', {
        name: /thread/i,
      })
      await user.click(disclosureButton)

      // Now the footer is visible — click Reply.
      const replyButton = within(annotationSlot).getByRole('button', {
        name: /reply/i,
      })
      await user.click(replyButton)

      // The reply editor should now be visible inside the thread card.
      const replyTextarea = within(annotationSlot).getByPlaceholderText(
        'Reply to the agent…'
      )
      await user.type(replyTextarea, 'How does that interact with resize?')
      keyDown(replyTextarea, { key: 'Enter' })

      // Confirm popover should open scoped to 1 comment.
      const popover = await screen.findByRole('dialog', {
        name: 'Finish feedback',
      })
      expect(popover).toHaveTextContent(/Send 1 comment/)

      // No Copy button for a reply (no persisted comment to copy).
      expect(
        within(popover).queryByRole('button', { name: /copy/i })
      ).not.toBeInTheDocument()

      await user.keyboard('{Shift>}y{/Shift}')

      await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))

      const [, payload] = writePty.mock.calls[0]
      expect(typeof payload).toBe('string')
      // Follow-up label present.
      expect(payload as string).toContain('[#1 · Follow-up]')
      // Context line from the agent turn.
      expect(payload as string).toContain('Continuing our thread')

      // The local turn exists before PTY publication, so a fast agent reply
      // cannot render ahead of the question it answers.
      expect(addAnnotation).toHaveBeenCalledOnce()
      expect(addAnnotation.mock.invocationCallOrder[0]).toBeLessThan(
        writePty.mock.invocationCallOrder[0]
      )

      const addedAnnotation = addAnnotation.mock.calls[0][3]
      expect(addedAnnotation.metadata.dispatchedAt).toBeDefined()
      expect(addedAnnotation.metadata.dispatchedTo).toBe('pty-1')
      expect(addedAnnotation.metadata.threadId).toBe('root-c1')

      // Reply on a resolved thread → resolvedAt cleared.
      expect(updateAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        'root-c1',
        { resolvedAt: undefined }
      )

      // Unrelated pending comment is untouched (addAnnotation called exactly once — the follow-up only).
      expect(addedAnnotation.metadata.id).not.toBe('pending-p9')

      await waitFor(() => expect(focusTerminal).toHaveBeenCalledOnce())
    })

    test('clicking Resolve stamps resolvedAt on the thread root (VIM-298)', async (): Promise<void> => {
      const user = userEvent.setup()
      const updateAnnotation = vi.fn()

      const batchAnnotations: DiffLineAnnotation<ReviewComment>[] = [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'root-c1',
            text: 'Why does this work?',
            author: 'self',
            category: 'question',
            createdAt: 1000,
            dispatchedAt: 1000,
            dispatchedTo: 'pty-1',
            threadId: 'root-c1',
          },
        },
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'agent-g1',
            text: 'Because of backpressure.',
            author: 'agent',
            outcome: 'reply',
            createdAt: 2000,
            threadId: 'root-c1',
          },
        },
      ]

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [makeBatchKey('/repo', 'src/foo.ts', false), batchAnnotations],
        ]),
        annotationsForFile: () => batchAnnotations,
        addAnnotation: vi.fn(() => 'ok' as const),
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation,
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 2,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackBatch={feedbackBatch}
          feedbackDispatch={{
            candidates: [],
            writePty: vi.fn(),
            focusTerminal: vi.fn(),
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const annotationSlot = screen.getByTestId('annotation-slot')

      await user.click(
        within(annotationSlot).getByRole('button', { name: /resolve/i })
      )

      expect(updateAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        'root-c1',
        { resolvedAt: expect.any(Number) }
      )
    })

    test('thread reply: write failure leaves no inserted comment and keeps the editor open (VIM-298)', async (): Promise<void> => {
      const user = userEvent.setup()
      let nonceAtWrite = ''
      let pendingWasRegisteredBeforeWrite = false

      const writePty = vi
        .fn<(ptyId: string, data: string) => Promise<void>>()
        .mockImplementation((ptyId, payload) => {
          nonceAtWrite = /"nonce":"(\w+)"/.exec(payload)?.[1] ?? ''
          pendingWasRegisteredBeforeWrite =
            getPendingReview(ptyId, nonceAtWrite) !== undefined

          return Promise.reject(new Error('pty closed'))
        })

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo',
        status: 'running',
        isFocused: true,
      }

      const addAnnotation = vi.fn<UseFeedbackBatchReturn['addAnnotation']>(
        () => 'ok'
      )
      const removeAnnotation = vi.fn()

      const batchAnnotations: DiffLineAnnotation<ReviewComment>[] = [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'root-c2',
            text: 'Root question',
            author: 'self',
            category: 'question',
            createdAt: 1000,
            dispatchedAt: 1000,
            threadId: 'root-c2',
          },
        },
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'agent-g2',
            text: 'Agent reply.',
            author: 'agent',
            outcome: 'reply',
            createdAt: 2000,
            threadId: 'root-c2',
          },
        },
      ]

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [makeBatchKey('/repo', 'src/foo.ts', false), batchAnnotations],
        ]),
        annotationsForFile: () => batchAnnotations,
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation: vi.fn(),
        removeAnnotation,
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 2,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackBatch={feedbackBatch}
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal: vi.fn(),
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const annotationSlot = screen.getByTestId('annotation-slot')
      await user.click(
        within(annotationSlot).getByRole('button', { name: /reply/i })
      )

      const replyTextarea = within(annotationSlot).getByPlaceholderText(
        'Reply to the agent…'
      )
      await user.type(replyTextarea, 'Follow-up question')
      keyDown(replyTextarea, { key: 'Enter' })

      await screen.findByRole('dialog', { name: 'Finish feedback' })
      await user.keyboard('{Shift>}y{/Shift}')

      // Write rejected — the optimistic local turn is rolled back.
      await waitFor(() => expect(writePty).toHaveBeenCalledOnce())
      expect(pendingWasRegisteredBeforeWrite).toBe(true)
      expect(getPendingReview('pty-1', nonceAtWrite)).toBeUndefined()
      expect(addAnnotation).toHaveBeenCalledOnce()
      expect(removeAnnotation).toHaveBeenCalledWith(
        '/repo',
        'src/foo.ts',
        false,
        addAnnotation.mock.calls[0][3].metadata.id
      )

      // Notification is shown.
      expect(
        await screen.findByText(/Terminal session ended/)
      ).toBeInTheDocument()
    })

    test('popover cancel preserves the reply draft and creates nothing (VIM-298)', async (): Promise<void> => {
      const user = userEvent.setup()
      const writePty = vi.fn().mockResolvedValue(undefined)

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo',
        status: 'running',
        isFocused: true,
      }

      const addAnnotation = vi.fn(() => 'ok' as const)

      const batchAnnotations: DiffLineAnnotation<ReviewComment>[] = [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'root-c3',
            text: 'Root question',
            author: 'self',
            category: 'question',
            createdAt: 1000,
            dispatchedAt: 1000,
            threadId: 'root-c3',
          },
        },
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'agent-g3',
            text: 'Agent reply.',
            author: 'agent',
            outcome: 'reply',
            createdAt: 2000,
            threadId: 'root-c3',
          },
        },
      ]

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [makeBatchKey('/repo', 'src/foo.ts', false), batchAnnotations],
        ]),
        annotationsForFile: () => batchAnnotations,
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 2,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
          feedbackBatch={feedbackBatch}
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal: vi.fn(),
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const annotationSlot = screen.getByTestId('annotation-slot')
      await user.click(
        within(annotationSlot).getByRole('button', { name: /reply/i })
      )

      const replyTextarea = within(annotationSlot).getByPlaceholderText(
        'Reply to the agent…'
      )
      await user.type(replyTextarea, 'Typed draft text')
      keyDown(replyTextarea, { key: 'Enter' })

      const popover = await screen.findByRole('dialog', {
        name: 'Finish feedback',
      })

      // Cancel the popover.
      const cancelButton = within(popover).getByRole('button', {
        name: /cancel/i,
      })
      await user.click(cancelButton)

      // No writePty call, no annotation inserted.
      expect(writePty).not.toHaveBeenCalled()
      expect(addAnnotation).not.toHaveBeenCalled()

      // After cancel, re-opening the reply editor should still show the draft.
      await user.click(
        within(annotationSlot).getByRole('button', { name: /reply/i })
      )

      expect(
        within(annotationSlot).getByPlaceholderText('Reply to the agent…')
      ).toHaveValue('Typed draft text')
    })

    test('repo-subdirectory cwd: writePty receives absolute path and pending handle carries repo-relative coords (VIM-298)', async (): Promise<void> => {
      const user = userEvent.setup()
      const writePty = vi.fn().mockResolvedValue(undefined)
      const focusTerminal = vi.fn()

      // Re-mock with the subdirectory cwd so the Panel does not enter loading state.
      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/foo.ts', status: 'modified', staged: false }],
        filesCwd: '/repo/sub',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: inlineFileDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
          repoRoot: '/repo',
        })
      )

      const candidate: PaneCandidate = {
        paneId: 'pane-1',
        ptyId: 'pty-1',
        tabName: 'Tab 1',
        agentLabel: 'Claude Code',
        cwd: '/repo/sub',
        status: 'running',
        isFocused: true,
      }

      const addAnnotation = vi.fn(() => 'ok' as const)

      // Annotations keyed under the subdirectory cwd.
      const batchAnnotations: DiffLineAnnotation<ReviewComment>[] = [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'root-sub1',
            text: 'Root question from sub.',
            author: 'self',
            category: 'question',
            createdAt: 1000,
            dispatchedAt: 1000,
            threadId: 'root-sub1',
          },
        },
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            id: 'agent-sub1',
            text: 'Agent sub reply.',
            author: 'agent',
            outcome: 'reply',
            createdAt: 2000,
            threadId: 'root-sub1',
          },
        },
      ]

      const feedbackBatch: UseFeedbackBatchReturn = {
        batch: new Map([
          [makeBatchKey('/repo/sub', 'src/foo.ts', false), batchAnnotations],
        ]),
        annotationsForFile: () => batchAnnotations,
        addAnnotation,
        addAnnotationForOwner: vi.fn(() => 'ok' as const),
        updateAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        clearBatch: vi.fn(),
        clearPending: vi.fn(),
        markDispatched: vi.fn(),
        totalAnnotations: () => 2,
        pendingAnnotations: () => 0,
      }

      render(
        <Panel
          cwd="/repo/sub"
          selectedFile={{ path: 'src/foo.ts', staged: false, cwd: '/repo/sub' }}
          onSelectedFileChange={vi.fn()}
          feedbackOwnerKey="sess:pane-1"
          feedbackBatch={feedbackBatch}
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal,
          }}
          feedbackRepoRootRef={{
            current: '',
            repoRootForCwd: (entryCwd: string): string =>
              entryCwd === '/repo/sub' ? '/repo' : '',
          }}
        />
      )

      setPaneWidth(SPLIT_MIN_WIDTH_PX + 100)

      const annotationSlot = screen.getByTestId('annotation-slot')
      await user.click(
        within(annotationSlot).getByRole('button', { name: /reply/i })
      )

      const replyTextarea = within(annotationSlot).getByPlaceholderText(
        'Reply to the agent…'
      )
      await user.type(replyTextarea, 'Sub-directory follow-up')
      keyDown(replyTextarea, { key: 'Enter' })

      const popover = await screen.findByRole('dialog', {
        name: 'Finish feedback',
      })
      expect(popover).toHaveTextContent(/Send 1 comment/)

      await user.keyboard('{Shift>}y{/Shift}')

      await waitFor(() => expect(writePty).toHaveBeenCalledOnce())

      // The prompt sent to the agent must carry the ABSOLUTE path so the agent
      // can resolve it from any working directory.
      const [, payload] = writePty.mock.calls[0]
      expect(payload as string).toContain('/repo/src/foo.ts')

      // The pending handle must carry REPO-RELATIVE coordinates (cwd + relative
      // filePath) matching the batch key, not the absolute prompt path.
      const nonce = /"nonce":"(\w+)"/.exec(payload as string)?.[1] ?? ''
      const pending = getPendingReview('pty-1', nonce)
      expect(pending?.byHandle.get(1)?.cwd).toBe('/repo/sub')
      expect(pending?.byHandle.get(1)?.filePath).toBe('src/foo.ts')

      clearPendingReview('pty-1', nonce)
    })
  })

  describe('diff search wiring', () => {
    const diffSearchFile: ChangedFile = {
      path: 'src/App.tsx',
      status: 'modified',
      staged: false,
    }

    const diffSearchDiff: FileDiff = {
      filePath: 'src/App.tsx',
      oldPath: 'src/App.tsx',
      newPath: 'src/App.tsx',
      hunks: [],
    }

    const renderPanel = ({
      tooNarrow = false,
    }: {
      tooNarrow?: boolean
    } = {}): {
      rerender: () => void
      clearFiles: () => void
    } => {
      let files: ChangedFile[] = [diffSearchFile]

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockImplementation(
        (): UseGitStatusReturn => ({
          files,
          filesCwd: '/repo',
          loading: false,
          error: null,
          refresh: vi.fn(),
          idle: false,
        })
      )

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: diffSearchDiff,
          loading: false,
          error: null,
          oldText: 'old',
          newText: 'new',
          rawDiff: '',
          repoRoot: '/repo',
        })
      )

      const view = (): ReactElement => (
        <Panel
          cwd="/repo"
          selectedFile={{ path: 'src/App.tsx', staged: false, cwd: '/repo' }}
          onSelectedFileChange={vi.fn()}
        />
      )

      const utils = render(view())

      if (tooNarrow) {
        setPaneWidth(DIFF_MIN_WIDTH_PX - 1)
      }

      return {
        rerender: (): void => utils.rerender(view()),
        clearFiles: (): void => {
          files = []
          utils.rerender(view())
        },
      }
    }

    test('passes a constant unsafeCSS and a stable onPostRender to pierre options', (): void => {
      const { rerender } = renderPanel()
      const first = lastMultiFileDiffOptions()

      expect(first.unsafeCSS).toContain('::highlight(vf-diff-search)')

      rerender()
      const second = lastMultiFileDiffOptions()
      expect(second).toEqual(first)
      expect(second.unsafeCSS).toBe(first.unsafeCSS)
      expect(second.onPostRender).toBe(first.onPostRender)
    })

    test('/ opens the search popup and focuses its input', async (): Promise<void> => {
      renderPanel()

      expect(screen.getByTestId('diff-body-region')).toHaveClass('relative')

      keyDown(screen.getByTestId('diff-populated-state'), {
        key: '/',
      })

      const popup = await screen.findByRole('search')
      await waitFor(() => expect(popup).not.toHaveAttribute('inert'))
      await waitFor(() =>
        expect(
          screen.getByRole('textbox', { name: /search in diff/i })
        ).toHaveFocus()
      )
    })

    test('search anchor moves down while the pierre file header is visible', async (): Promise<void> => {
      renderPanel()

      const button = screen.getByRole('button', { name: /search in diff/i })
      expect(button).toHaveClass('right-[22px]')
      expect(button).toHaveClass('top-10')
      expect(button).not.toHaveClass('right-[72px]')
      expect(button).not.toHaveClass('top-1')

      act(() => updatePanelSettings({ diffFileHeader: false }))

      expect(lastMultiFileDiffOptions().disableFileHeader).toBe(true)
      expect(button).toHaveClass('right-[22px]')
      expect(button).toHaveClass('top-1')
      expect(button).not.toHaveClass('right-[72px]')
      expect(button).not.toHaveClass('top-10')

      keyDown(screen.getByTestId('diff-populated-state'), {
        key: '/',
      })

      const popup = await screen.findByRole('search')
      expect(popup).toHaveClass('right-[22px]')
      expect(popup).toHaveClass('top-1')
      expect(popup).not.toHaveClass('right-[72px]')
      expect(popup).not.toHaveClass('top-10')
    })

    test('popup closes when the selected file goes away', async (): Promise<void> => {
      const { clearFiles } = renderPanel()
      keyDown(screen.getByTestId('diff-populated-state'), {
        key: '/',
      })
      await screen.findByRole('search')

      clearFiles()

      await waitFor(() => {
        expect(screen.queryByRole('search')).not.toBeInTheDocument()
      })
    })

    test('narrow panel: no search button and / does not open search', (): void => {
      renderPanel({ tooNarrow: true })

      expect(
        screen.queryByRole('button', { name: /search in diff/i })
      ).not.toBeInTheDocument()

      keyDown(screen.getByTestId('diff-populated-state'), {
        key: '/',
      })

      expect(screen.queryByRole('search')).not.toBeInTheDocument()
    })
  })

  describe('whole-changelist request review (VIM-327)', () => {
    // Three-entry changelist: a.ts unstaged, a.ts staged, new.ts untracked.
    const changelistFiles: ChangedFile[] = [
      { path: 'src/a.ts', status: 'modified', staged: false },
      { path: 'src/a.ts', status: 'modified', staged: true },
      { path: 'new.ts', status: 'untracked', staged: false },
    ]

    const makeHunkDiff = (filePath: string): FileDiff => ({
      filePath,
      hunks: [
        {
          id: 'hunk-1-1',
          header: '@@ -1,2 +1,3 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          lines: [],
        },
      ],
    })

    const candidate: PaneCandidate = {
      paneId: 'pane-1',
      ptyId: 'pty-1',
      tabName: 'claude',
      agentLabel: 'Claude Code',
      cwd: '/repo',
      status: 'running',
      isFocused: true,
    }

    test('changelist review dispatches all 3 entries with correct payload and stores snapshot', async (): Promise<void> => {
      const user = userEvent.setup()

      const writePty = vi
        .fn<(ptyId: string, data: string) => Promise<void>>()
        .mockResolvedValue(undefined)

      // getDiff returns a hunk diff for each file (untracked returns same shape)
      const getDiff = vi
        .fn<
          (
            file: string,
            staged?: boolean,
            untracked?: boolean
          ) => Promise<GetGitDiffResponse>
        >()
        .mockImplementation((file) =>
          Promise.resolve({
            fileDiff: makeHunkDiff(file) as GetGitDiffResponse['fileDiff'],
            oldText: '',
            newText: '',
            rawDiff: '',
            repoRoot: '/repo',
          })
        )

      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue({
        getStatus: vi.fn().mockResolvedValue([]),
        getDiff,
        stageFile: vi.fn().mockResolvedValue(undefined),
        unstageFile: vi.fn().mockResolvedValue(undefined),
        discardChanges: vi.fn().mockResolvedValue(undefined),
      })

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: changelistFiles,
        filesCwd: '/repo',
        repoRoot: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      // No selected file — test that the button still appears
      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({ diff: null, loading: false, error: null })
      )

      render(
        <Panel
          cwd="/repo"
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal: vi.fn(),
          }}
        />
      )

      // Button must appear even without a selected file when the strip is populated
      const btn = screen.getByRole('button', { name: /request review/i })
      expect(btn).toBeInTheDocument()

      await user.click(btn)

      // Popover opens — scope control should be visible (3 entries, no active file → changelist forced)
      const dialog = await screen.findByRole('dialog', {
        name: 'Request review',
      })
      expect(dialog).toBeInTheDocument()

      // Switch to changelist scope (already forced; this verifies the SegmentedControl rendered)
      expect(
        screen.getByRole('group', { name: 'Review scope' })
      ).toBeInTheDocument()

      // 'All changes (3)' should have aria-pressed=true (forced changelist — no active diff)
      expect(
        screen.getByRole('button', { name: 'All changes' })
      ).toHaveAttribute('aria-pressed', 'true')

      // Delegate via Y
      fireEvent.keyDown(document, {
        key: 'Y',
        code: 'KeyY',
        shiftKey: true,
      })

      // Wait for writePty to be called (async arm)
      await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))

      const [ptyId, payload] = writePty.mock.calls[0]
      expect(ptyId).toBe('pty-1')

      // Payload must name 3 changes in the header
      expect(payload).toContain('these 3 changes')
      // Both group headers
      expect(payload).toContain('unstaged diff (`git diff`)')
      expect(payload).toContain('staged diff (`git diff --cached`)')
      // Untracked annotation for new.ts
      expect(payload).toContain(
        'not in git diff; read the file, all lines are additions'
      )
      // nonce block
      expect(payload).toContain('<<<VIMEFLOW_REVIEW')

      // Verify the pending request was stored with 3 snapshot entries
      const nonce = /"nonce":"(\w+)"/.exec(payload)?.[1] ?? ''

      try {
        expect(nonce).not.toBe('')

        const pending = getPendingReviewRequest(nonce)
        expect(pending?.diffSnapshot).toHaveLength(3)
        expect(pending?.diffSnapshot[0]).toMatchObject({
          path: 'src/a.ts',
          staged: false,
        })

        expect(pending?.diffSnapshot[1]).toMatchObject({
          path: 'src/a.ts',
          staged: true,
        })

        expect(pending?.diffSnapshot[2]).toMatchObject({
          path: 'new.ts',
          staged: false,
        })
      } finally {
        clearPendingReviewRequest(nonce)
      }
    })

    test('request review button appears with a populated strip and no loaded diff', async (): Promise<void> => {
      const user = userEvent.setup()

      // Two-file strip: auto-selection picks src/a.ts but changeCount=2 so the
      // scope control is not suppressed by the "degenerate single-entry" rule.
      // useFileDiff returns no diff → fileDisabled=true, forced-changelist scope.
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue({
        getStatus: vi.fn().mockResolvedValue([]),
        getDiff: vi.fn().mockResolvedValue({
          fileDiff: makeHunkDiff('src/a.ts') as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: '',
          repoRoot: '/repo',
        }),
        stageFile: vi.fn().mockResolvedValue(undefined),
        unstageFile: vi.fn().mockResolvedValue(undefined),
        discardChanges: vi.fn().mockResolvedValue(undefined),
      })

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/a.ts', status: 'modified', staged: false },
          { path: 'src/b.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        repoRoot: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({ diff: null, loading: false, error: null })
      )

      render(
        <Panel
          cwd="/repo"
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty: vi.fn(),
            focusTerminal: vi.fn(),
          }}
        />
      )

      // Button must appear when the strip has at least one entry (even without an active diff)
      const btn = screen.getByRole('button', { name: /request review/i })
      expect(btn).toBeInTheDocument()

      // Open the popover
      await user.click(btn)

      // Wait for the popover dialog to mount
      await screen.findByRole('dialog', { name: 'Request review' })

      // Scope group must be present
      expect(
        screen.getByRole('group', { name: 'Review scope' })
      ).toBeInTheDocument()

      // No active diff → 'This file' must be disabled
      expect(screen.getByRole('button', { name: 'This file' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )

      // 'All changes' must NOT be disabled and must be the ACTIVE option
      // (forced-changelist proof: no loaded diff arms changelist scope)
      const allChangesBtn = screen.getByRole('button', { name: 'All changes' })
      expect(allChangesBtn).not.toHaveAttribute('aria-disabled', 'true')
      expect(allChangesBtn).toHaveAttribute('aria-pressed', 'true')
    })

    test('scope control is hidden when the only change is the selected file', async (): Promise<void> => {
      const user = userEvent.setup()

      // Single entry strip — the degenerate case: exactly one entry that
      // auto-selection will pick as the active file. Both scopes are identical,
      // so the scope control should be hidden.
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue({
        getStatus: vi.fn().mockResolvedValue([]),
        getDiff: vi.fn().mockResolvedValue({
          fileDiff: makeHunkDiff('src/a.ts') as GetGitDiffResponse['fileDiff'],
          oldText: '',
          newText: '',
          rawDiff: '',
          repoRoot: '/repo',
        }),
        stageFile: vi.fn().mockResolvedValue(undefined),
        unstageFile: vi.fn().mockResolvedValue(undefined),
        discardChanges: vi.fn().mockResolvedValue(undefined),
      })

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [{ path: 'src/a.ts', status: 'modified', staged: false }],
        filesCwd: '/repo',
        repoRoot: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: makeHunkDiff('src/a.ts'),
          loading: false,
          error: null,
        })
      )

      render(
        <Panel
          cwd="/repo"
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty: vi.fn(),
            focusTerminal: vi.fn(),
          }}
        />
      )

      const btn = screen.getByRole('button', { name: /request review/i })
      await user.click(btn)

      // Popover itself must be present (e.g. Copy button visible)
      await screen.findByRole('dialog', { name: 'Request review' })

      // Scope control must be absent in the degenerate case
      expect(
        screen.queryByRole('group', { name: 'Review scope' })
      ).not.toBeInTheDocument()
    })

    test('pressing f switches the armed scope back to the active file', async (): Promise<void> => {
      const user = userEvent.setup()

      const writePty = vi
        .fn<(ptyId: string, data: string) => Promise<void>>()
        .mockResolvedValue(undefined)

      // 2+ entries so scope control is visible; default scope = changelist
      // because the first entry auto-selected has a loaded diff.
      vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue({
        getStatus: vi.fn().mockResolvedValue([]),
        getDiff: vi.fn().mockImplementation((file: string) =>
          Promise.resolve({
            fileDiff: makeHunkDiff(file) as GetGitDiffResponse['fileDiff'],
            oldText: '',
            newText: '',
            rawDiff: '',
            repoRoot: '/repo',
          })
        ),
        stageFile: vi.fn().mockResolvedValue(undefined),
        unstageFile: vi.fn().mockResolvedValue(undefined),
        discardChanges: vi.fn().mockResolvedValue(undefined),
      })

      vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
        files: [
          { path: 'src/a.ts', status: 'modified', staged: false },
          { path: 'src/b.ts', status: 'modified', staged: false },
        ],
        filesCwd: '/repo',
        repoRoot: '/repo',
        revision: 1,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      })

      vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue(
        fileDiffMock({
          diff: makeHunkDiff('src/a.ts'),
          loading: false,
          error: null,
        })
      )

      render(
        <Panel
          cwd="/repo"
          feedbackOwnerKey="sess:pane-1"
          feedbackDispatch={{
            candidates: [candidate],
            writePty,
            focusTerminal: vi.fn(),
          }}
        />
      )

      const btn = screen.getByRole('button', { name: /request review/i })
      await user.click(btn)

      await screen.findByRole('dialog', { name: 'Request review' })

      // Default scope should be changelist (diff is loaded, 2 entries)
      expect(
        screen.getByRole('button', { name: 'All changes' })
      ).toHaveAttribute('aria-pressed', 'true')

      // Press 'f' to switch to file scope
      fireEvent.keyDown(document, { key: 'f', code: 'KeyF' })

      // 'This file' becomes the active scope
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'This file' })
        ).toHaveAttribute('aria-pressed', 'true')
      })

      // Delegate via Y and assert single-file payload
      fireEvent.keyDown(document, {
        key: 'Y',
        code: 'KeyY',
        shiftKey: true,
      })

      await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))

      const [ptyId, payload] = writePty.mock.calls[0]
      expect(ptyId).toBe('pty-1')
      expect(payload).toContain('this 1 change')
    })
  })
})
