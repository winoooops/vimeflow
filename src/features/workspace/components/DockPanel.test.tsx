import {
  fireEvent,
  render as testingLibraryRender,
  screen,
  waitFor,
  within,
  type RenderResult,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { createRef, forwardRef, useState, type ReactElement } from 'react'
import DockPanel, { type DockPanelHandle } from './DockPanel'
import * as useCodeMirrorModule from '../../editor/hooks/useCodeMirror'
import * as useVimModeModule from '../../editor/hooks/useVimMode'
import * as languageServiceModule from '../../editor/services/languageService'
import * as useGitStatusModule from '../../diff/hooks/useGitStatus'
import * as useFileDiffModule from '../../diff/hooks/useFileDiff'
import { useFeedbackBatchStore } from '../../diff/hooks/useFeedbackBatch'
import type { UseFileDiffReturn } from '../../diff/hooks/useFileDiff'
import type { ChangedFile, SelectedDiffFile } from '../../diff/types'
import type { FeedbackDispatchTarget } from '../../diff/services/activePanePicker'
import { javascript } from '@codemirror/lang-javascript'
import type { Keybindings } from '../../keymap/useKeybindings'
import { SettingsProvider } from '../../settings/SettingsProvider'

const render = (ui: ReactElement): RenderResult =>
  testingLibraryRender(ui, { wrapper: SettingsProvider })

vi.mock('../../editor/hooks/useCodeMirror')
vi.mock('../../editor/hooks/useVimMode')
vi.mock('../../editor/services/languageService')
vi.mock('../../diff/hooks/useGitStatus')
vi.mock('../../diff/hooks/useFileDiff')
vi.mock('../../keymap/useKeybindings', async () => {
  const { getCommand } = await import('../../keymap/catalog')
  const { eventMatchesChord } = await import('../../keymap/match')
  const { resolveDefault } = await import('../../keymap/resolve')

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

interface MockLineAnnotation {
  lineNumber: number
  side: string
  metadata: {
    id: string
    text: string
    author: string
    createdAt: number
  }
}

vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: vi.fn(() => null),
  MultiFileDiff: vi.fn(
    ({
      renderGutterUtility = undefined,
      lineAnnotations = undefined,
      renderAnnotation = undefined,
    }: {
      renderGutterUtility?: (
        getHovered: () => { lineNumber: number; side: string }
      ) => ReactElement
      lineAnnotations?: MockLineAnnotation[]
      renderAnnotation?: (annotation: MockLineAnnotation) => ReactElement
    }) => (
      <div data-testid="multi-file-diff">
        {renderGutterUtility ? (
          <div data-testid="gutter-utility-slot">
            {renderGutterUtility(() => ({
              lineNumber: 1,
              side: 'additions',
            }))}
          </div>
        ) : null}
        {lineAnnotations && renderAnnotation ? (
          <div data-testid="annotation-slot">
            {lineAnnotations.map((annotation, index) => (
              <div key={annotation.metadata.id ?? index}>
                {renderAnnotation(annotation)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  ),
}))

// react-markdown is ESM-only and heavy in jsdom; the DockPanel test only needs
// to prove WHICH surface mounts per viewMode. The real rendering/sanitize
// behavior is covered by MarkdownReadingView.test.tsx.
vi.mock('../../editor/components/MarkdownReadingView', () => ({
  MarkdownReadingView: forwardRef<HTMLDivElement, { content: string }>(
    function MarkdownReadingView({ content }, ref): ReactElement {
      // Forward the ref to a focusable node so the DockPanel view-mode-focus
      // effect (markdownViewRef.current?.focus()) is observable in tests.
      return (
        <div ref={ref} data-testid="markdown-reading-view" tabIndex={-1}>
          {content}
        </div>
      )
    }
  ),
}))

type DockPanelTestProps = Parameters<typeof DockPanel>[0]

const inlineChangedFile: ChangedFile = {
  path: 'src/foo.ts',
  status: 'modified',
  staged: false,
}

const inlineDiffResponse: NonNullable<UseFileDiffReturn['response']> = {
  fileDiff: {
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
  },
  oldText: 'old',
  newText: 'new',
  rawDiff: '',
  repoRoot: '/repo',
}

const SharedFeedbackDockHarness = ({
  tab,
  open,
  cwd = '/repo',
  feedbackDispatch = undefined,
}: {
  tab: 'editor' | 'diff'
  open: boolean
  cwd?: string
  feedbackDispatch?: FeedbackDispatchTarget
}): ReactElement => {
  const { feedbackBatch, feedbackDraft, feedbackRepoRootRef } =
    useFeedbackBatchStore('session-a:p0', cwd)
  const isResizing = false

  if (!open) {
    return <div data-testid="dock-closed" />
  }

  return (
    <DockPanel
      position="bottom"
      tab={tab}
      onTabChange={vi.fn()}
      onPositionChange={vi.fn()}
      onClose={vi.fn()}
      verticalSize={400}
      onVerticalResizeMouseDown={vi.fn()}
      isVerticalResizing={isResizing}
      onVerticalSizeAdjust={vi.fn()}
      verticalPixelMin={40}
      verticalPixelMax={640}
      horizontalSize={360}
      onHorizontalResizeMouseDown={vi.fn()}
      isHorizontalResizing={isResizing}
      onHorizontalSizeAdjust={vi.fn()}
      horizontalPixelMin={40}
      horizontalPixelMax={640}
      selectedFilePath={null}
      content=""
      cwd={cwd}
      gitStatus={{
        files: [inlineChangedFile],
        filesCwd: cwd,
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }}
      selectedDiffFile={{
        path: inlineChangedFile.path,
        staged: inlineChangedFile.staged,
        cwd,
      }}
      onSelectedDiffFileChange={vi.fn()}
      feedbackBatch={feedbackBatch}
      feedbackDraft={feedbackDraft}
      feedbackRepoRootRef={feedbackRepoRootRef}
      feedbackDispatch={feedbackDispatch}
    />
  )
}

const firstChangedFile: ChangedFile = {
  path: 'src/first.ts',
  status: 'modified',
  staged: false,
}

const secondChangedFile: ChangedFile = {
  path: 'src/second.ts',
  status: 'modified',
  staged: false,
}

const SelectedDiffLifecycleHarness = ({
  open,
}: {
  open: boolean
}): ReactElement => {
  const isResizing = false

  const [selectedDiffFile, setSelectedDiffFile] =
    useState<SelectedDiffFile | null>({
      path: secondChangedFile.path,
      staged: secondChangedFile.staged,
      cwd: '/repo',
    })

  if (!open) {
    return <div data-testid="dock-closed" />
  }

  return (
    <DockPanel
      position="bottom"
      tab="diff"
      onTabChange={vi.fn()}
      onPositionChange={vi.fn()}
      onClose={vi.fn()}
      verticalSize={400}
      onVerticalResizeMouseDown={vi.fn()}
      isVerticalResizing={isResizing}
      onVerticalSizeAdjust={vi.fn()}
      verticalPixelMin={40}
      verticalPixelMax={640}
      horizontalSize={360}
      onHorizontalResizeMouseDown={vi.fn()}
      isHorizontalResizing={isResizing}
      onHorizontalSizeAdjust={vi.fn()}
      horizontalPixelMin={40}
      horizontalPixelMax={640}
      selectedFilePath={null}
      content=""
      cwd="/repo"
      gitStatus={{
        files: [firstChangedFile, secondChangedFile],
        filesCwd: '/repo',
        loading: false,
        error: null,
        refresh: vi.fn(),
        idle: false,
      }}
      selectedDiffFile={selectedDiffFile}
      onSelectedDiffFileChange={setSelectedDiffFile}
    />
  )
}

const addInlineComment = async (
  user: ReturnType<typeof userEvent.setup>,
  text: string
): Promise<void> => {
  const gutterSlot = screen.getByTestId('gutter-utility-slot')

  await user.click(
    within(gutterSlot).getByRole('button', {
      name: 'Add comment on this line',
    })
  )

  const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
  await user.type(within(dialog).getByPlaceholderText('Request change'), text)
  await user.keyboard('{Enter}')

  await screen.findByRole('button', { name: /finish feedback \(1\)/i })
}

const openInlineCommentDraft = async (
  user: ReturnType<typeof userEvent.setup>,
  text: string
): Promise<void> => {
  const gutterSlot = screen.getByTestId('gutter-utility-slot')

  await user.click(
    within(gutterSlot).getByRole('button', {
      name: 'Add comment on this line',
    })
  )

  const dialog = screen.getByRole('dialog', { name: /Comment on line/ })
  await user.type(within(dialog).getByPlaceholderText('Request change'), text)
}

const renderDockPanel = (
  overrides: Partial<DockPanelTestProps> = {}
): ReturnType<typeof render> & {
  rerenderWith: (next: Partial<DockPanelTestProps>) => void
} => {
  const props: DockPanelTestProps = {
    position: 'bottom',
    tab: 'editor',
    onTabChange: vi.fn(),
    onPositionChange: vi.fn(),
    onClose: vi.fn(),
    verticalSize: 400,
    onVerticalResizeMouseDown: vi.fn(),
    isVerticalResizing: false,
    onVerticalSizeAdjust: vi.fn(),
    verticalPixelMin: 40,
    verticalPixelMax: 640,
    horizontalSize: 360,
    onHorizontalResizeMouseDown: vi.fn(),
    isHorizontalResizing: false,
    onHorizontalSizeAdjust: vi.fn(),
    horizontalPixelMin: 40,
    horizontalPixelMax: 640,
    selectedFilePath: null,
    content: '',
    ...overrides,
  } as DockPanelTestProps

  const view = render(<DockPanel {...props} />)

  return {
    ...view,
    // Re-render the same instance with a changed prop (e.g. selectedFilePath),
    // so a test can exercise the render-time view-mode reset without rebuilding
    // the full prop object.
    rerenderWith: (next: Partial<DockPanelTestProps>): void => {
      const nextProps = { ...props, ...next } as DockPanelTestProps
      view.rerender(<DockPanel {...nextProps} />)
    },
  }
}

describe('DockPanel', () => {
  const mockEditorView = {
    destroy: vi.fn(),
    focus: vi.fn(),
    state: { doc: { toString: (): string => 'test content' } },
  }

  const mockUseCodeMirror = vi.fn()
  const mockUseVimMode = vi.fn()
  const mockGetLanguageExtension = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCodeMirror.mockReturnValue({
      editorView: mockEditorView,
      updateContent: vi.fn(),
      copySelection: vi.fn(),
      cutSelection: vi.fn(),
      pasteClipboard: vi.fn(),
      selectAll: vi.fn(),
      setContainer: vi.fn(),
    })

    mockUseVimMode.mockReturnValue('NORMAL')
    mockGetLanguageExtension.mockReturnValue(javascript())

    vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockImplementation(
      mockUseCodeMirror
    )
    vi.spyOn(useVimModeModule, 'useVimMode').mockImplementation(mockUseVimMode)
    vi.spyOn(languageServiceModule, 'getLanguageExtension').mockImplementation(
      mockGetLanguageExtension
    )

    vi.spyOn(useGitStatusModule, 'useGitStatus').mockReturnValue({
      files: [],
      filesCwd: '.',
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: false,
    })

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      response: null,
      diff: null,
      loading: false,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    })
  })

  test('accepts selectedFilePath prop', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts' })

    expect(screen.getByTestId('dock-panel')).toBeInTheDocument()
  })

  test('exposes editor panel as a named region', () => {
    renderDockPanel({ tab: 'editor' })

    expect(
      screen.getByRole('region', { name: /code editor/i })
    ).toBeInTheDocument()
  })

  test('exposes diff panel as a named region', () => {
    renderDockPanel({ tab: 'diff' })

    expect(
      screen.getByRole('region', { name: /diff viewer/i })
    ).toBeInTheDocument()
  })

  test('passes selectedFilePath to CodeEditor', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts' })

    expect(screen.queryByTestId('no-file-selected')).not.toBeInTheDocument()
  })

  test('shows CodeEditor when file is selected', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts' })

    expect(screen.getByTestId('codemirror-container')).toBeInTheDocument()
  })

  test('renders editor path crumb above the editor surface without status for an untouched file', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts' })

    const editorPanel = screen.getByTestId('editor-panel')
    const crumb = within(editorPanel).getByTestId('editor-path-crumb')
    expect(crumb).toHaveTextContent('test.ts')
    expect(within(crumb).queryByText(/saved ·/i)).toBeNull()
    expect(within(crumb).queryByText('UNSAVED')).toBeNull()
  })

  test('renders unsaved path crumb state when the buffer is dirty', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts', isDirty: true })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('UNSAVED')).toHaveClass('text-primary')
  })

  test('renders new path crumb state for a clean new file', () => {
    renderDockPanel({
      selectedFilePath: '/home/user/new.ts',
      editorFileLifecycleStatus: 'NEW',
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('NEW')).toHaveClass('text-success-muted')
  })

  test('renders deleted path crumb state for a clean deleted file', () => {
    renderDockPanel({
      selectedFilePath: '/home/user/deleted.ts',
      editorFileLifecycleStatus: 'DELETED',
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('DELETED')).toHaveClass('text-tertiary')
  })

  test('makes the editor read-only for a clean deleted file', () => {
    renderDockPanel({
      selectedFilePath: '/home/user/deleted.ts',
      editorFileLifecycleStatus: 'DELETED',
    })

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true })
    )
  })

  test('keeps the editor editable for a dirty deleted file so it can be saved', () => {
    renderDockPanel({
      selectedFilePath: '/home/user/deleted.ts',
      editorFileLifecycleStatus: 'DELETED',
      isDirty: true,
    })

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: false })
    )
  })

  test('lets dirty state override new file lifecycle state', () => {
    renderDockPanel({
      selectedFilePath: '/home/user/new.ts',
      editorFileLifecycleStatus: 'NEW',
      isDirty: true,
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('UNSAVED')).toBeInTheDocument()
    expect(within(crumb).queryByText('NEW')).toBeNull()
  })

  test('renders saved path crumb state after a successful save', async () => {
    const view = renderDockPanel({
      selectedFilePath: '/home/user/test.ts',
      isDirty: true,
    })

    view.rerenderWith({
      selectedFilePath: '/home/user/test.ts',
      isDirty: false,
      savedAt: Date.now(),
    })

    const crumb = screen.getByTestId('editor-path-crumb')

    await waitFor(() => {
      expect(within(crumb).getByText(/saved ·/i)).toHaveClass(
        'text-success-muted'
      )
    })
  })

  test('shows just-saved state over new lifecycle state after saving a new file', async () => {
    const view = renderDockPanel({
      selectedFilePath: '/home/user/new.ts',
      editorFileLifecycleStatus: 'NEW',
      isDirty: true,
    })

    view.rerenderWith({
      selectedFilePath: '/home/user/new.ts',
      editorFileLifecycleStatus: 'NEW',
      isDirty: false,
      savedAt: Date.now(),
    })

    const crumb = screen.getByTestId('editor-path-crumb')

    await waitFor(() => {
      expect(within(crumb).getByText(/saved ·/i)).toHaveClass(
        'text-success-muted'
      )
    })
    expect(within(crumb).queryByText('NEW')).toBeNull()
  })

  test('lets deleted lifecycle state override stale saved state', async () => {
    const view = renderDockPanel({
      selectedFilePath: '/home/user/deleted.ts',
      isDirty: true,
    })

    view.rerenderWith({
      selectedFilePath: '/home/user/deleted.ts',
      isDirty: false,
      savedAt: Date.now(),
    })

    await screen.findByText(/saved ·/i)

    view.rerenderWith({
      selectedFilePath: '/home/user/deleted.ts',
      editorFileLifecycleStatus: 'DELETED',
      isDirty: false,
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('DELETED')).toHaveClass('text-tertiary')
    expect(within(crumb).queryByText(/saved ·/i)).toBeNull()
  })

  test('clears saved path crumb state when the selected file path changes', async () => {
    const view = renderDockPanel({
      selectedFilePath: '/home/user/first.ts',
      isDirty: true,
    })

    view.rerenderWith({
      selectedFilePath: '/home/user/first.ts',
      isDirty: false,
      savedAt: Date.now(),
    })

    await screen.findByText(/saved ·/i)

    view.rerenderWith({
      selectedFilePath: '/home/user/second.ts',
      isDirty: false,
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('second.ts')).toBeInTheDocument()

    await waitFor(() => {
      expect(within(crumb).queryByText(/saved ·/i)).toBeNull()
    })
  })

  test('clears saved path crumb state when the parent clears savedAt', async () => {
    const view = renderDockPanel({
      selectedFilePath: '/home/user/shared.ts',
      isDirty: true,
    })

    view.rerenderWith({
      selectedFilePath: '/home/user/shared.ts',
      isDirty: false,
      savedAt: Date.now(),
    })

    await screen.findByText(/saved ·/i)

    view.rerenderWith({
      selectedFilePath: '/home/user/shared.ts',
      isDirty: false,
      savedAt: null,
    })

    const crumb = screen.getByTestId('editor-path-crumb')
    expect(within(crumb).getByText('shared.ts')).toBeInTheDocument()

    await waitFor(() => {
      expect(within(crumb).queryByText(/saved ·/i)).toBeNull()
    })
    expect(within(crumb).queryByText('UNSAVED')).toBeNull()
  })

  test('keeps selected file path out of the dock tab header', () => {
    renderDockPanel({ selectedFilePath: '/home/user/test.ts' })

    expect(
      within(screen.getByTestId('dock-tab')).queryByText(/test\.ts/)
    ).toBeNull()
  })

  test('shows "No file selected" when selectedFilePath is null', () => {
    renderDockPanel()

    expect(screen.getByTestId('no-file-selected')).toBeInTheDocument()
    expect(screen.getByText(/No file selected/i)).toBeInTheDocument()
  })

  test('does not render editor path crumb when no file is selected', () => {
    renderDockPanel()

    expect(screen.queryByTestId('editor-path-crumb')).toBeNull()
  })

  describe('markdown reading view', () => {
    test('markdown file defaults to the reading view (not CodeEditor)', () => {
      renderDockPanel({ selectedFilePath: '/x/README.md', content: '# Hi' })

      expect(screen.getByTestId('markdown-reading-view')).toBeInTheDocument()
      expect(
        screen.queryByTestId('codemirror-container')
      ).not.toBeInTheDocument()
    })

    test('toggling to Source shows the CodeEditor (vim path)', async () => {
      const user = userEvent.setup()
      renderDockPanel({ selectedFilePath: '/x/README.md', content: '# Hi' })

      await user.click(screen.getByRole('button', { name: /source/i }))

      expect(screen.getByTestId('codemirror-container')).toBeInTheDocument()
      expect(
        screen.queryByTestId('markdown-reading-view')
      ).not.toBeInTheDocument()
    })

    test('toggling back to Reading restores the reading view', async () => {
      const user = userEvent.setup()
      renderDockPanel({ selectedFilePath: '/x/README.md', content: '# Hi' })

      await user.click(screen.getByRole('button', { name: /source/i }))
      await user.click(screen.getByRole('button', { name: /^reading$/i }))

      expect(screen.getByTestId('markdown-reading-view')).toBeInTheDocument()
      expect(
        screen.queryByTestId('codemirror-container')
      ).not.toBeInTheDocument()
    })

    test('switching to a different markdown file resets Source back to Reading', async () => {
      const user = userEvent.setup()

      const view = renderDockPanel({
        selectedFilePath: '/x/a.md',
        content: '# A',
      })

      // Drop file A into Source mode.
      await user.click(screen.getByRole('button', { name: /^source$/i }))
      expect(screen.getByTestId('codemirror-container')).toBeInTheDocument()

      // Opening a different markdown file resets the view mode to Reading, so
      // the reader never lands in the editor for a file they just opened.
      view.rerenderWith({ selectedFilePath: '/x/b.md', content: '# B' })

      expect(screen.getByTestId('markdown-reading-view')).toBeInTheDocument()
      expect(
        screen.queryByTestId('codemirror-container')
      ).not.toBeInTheDocument()
    })

    test('toggling to Reading moves keyboard focus into the reading region (focused pane)', async () => {
      const user = userEvent.setup()
      renderDockPanel({
        selectedFilePath: '/x/README.md',
        content: '# Hi',
        isFocused: true,
      })

      await user.click(screen.getByRole('button', { name: /^source$/i }))
      await user.click(screen.getByRole('button', { name: /^reading$/i }))

      expect(screen.getByTestId('markdown-reading-view')).toHaveFocus()
    })

    test('switching between markdown files keeps focus in the reading region (focused pane)', () => {
      const view = renderDockPanel({
        selectedFilePath: '/x/a.md',
        content: '# A',
        isFocused: true,
      })

      // The effect focuses the region on the initial focused-reading mount.
      expect(screen.getByTestId('markdown-reading-view')).toHaveFocus()

      // Switching files remounts the region (key=selectedFilePath); the effect
      // must re-fire on the selectedFilePath change to restore focus — otherwise
      // none of the other deps change and focus falls to document.body.
      view.rerenderWith({ selectedFilePath: '/x/b.md', content: '# B' })

      expect(screen.getByTestId('markdown-reading-view')).toHaveFocus()
    })

    test('.markdown extension also opens in the reading view', () => {
      renderDockPanel({
        selectedFilePath: '/x/notes.markdown',
        content: '# Hi',
      })

      expect(screen.getByTestId('markdown-reading-view')).toBeInTheDocument()
    })

    test('non-markdown file shows CodeEditor and no view-mode toggle', () => {
      renderDockPanel({ selectedFilePath: '/x/test.ts' })

      expect(screen.getByTestId('codemirror-container')).toBeInTheDocument()
      expect(
        screen.queryByTestId('markdown-reading-view')
      ).not.toBeInTheDocument()

      expect(
        screen.queryByRole('button', { name: /^reading$/i })
      ).not.toBeInTheDocument()

      expect(
        screen.queryByRole('button', { name: /^source$/i })
      ).not.toBeInTheDocument()
    })

    test('view-mode toggle is present for a markdown file on the editor tab', () => {
      renderDockPanel({ selectedFilePath: '/x/README.md' })

      expect(
        screen.getByRole('button', { name: /^reading$/i })
      ).toBeInTheDocument()

      expect(
        screen.getByRole('button', { name: /^source$/i })
      ).toBeInTheDocument()
    })

    test('reading-style gear is shown in reading mode and hidden in source mode', async () => {
      const user = userEvent.setup()
      renderDockPanel({ selectedFilePath: '/x/README.md' })

      expect(
        screen.getByRole('button', { name: /reading style/i })
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^source$/i }))

      expect(
        screen.queryByRole('button', { name: /reading style/i })
      ).not.toBeInTheDocument()
    })

    test('view-mode toggle is absent on the diff tab even for a markdown file', () => {
      renderDockPanel({ tab: 'diff', selectedFilePath: '/x/README.md' })

      expect(
        screen.queryByRole('button', { name: /^reading$/i })
      ).not.toBeInTheDocument()
    })

    test('DockSwitcher remains present alongside the toggle (composed, not replaced)', () => {
      renderDockPanel({
        position: 'bottom',
        selectedFilePath: '/x/README.md',
      })

      // Toggle is present...
      expect(
        screen.getByRole('button', { name: /^reading$/i })
      ).toBeInTheDocument()

      // ...and DockSwitcher (dock: <position>) was NOT removed (D6).
      expect(
        screen.getByRole('button', { name: /dock: bottom/i })
      ).toBeInTheDocument()
    })
  })

  test('renders resize handle for vertical docks', () => {
    const { unmount } = renderDockPanel()

    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()

    unmount()
    renderDockPanel({ position: 'top' })

    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()
  })

  test('resize handle has z-index so it paints above the DockTab header', () => {
    // Regression for the bottom-dock "can't resize" bug: the handle is
    // a `position:absolute` sibling of the `position:relative` DockTab.
    // Both default to `z-index: auto`, and DOM order ties resolve to the
    // later sibling, so without an explicit z-index the DockTab paints
    // over the handle and swallows every mousedown at the boundary.
    for (const position of ['bottom', 'top', 'left', 'right'] as const) {
      const { unmount } = renderDockPanel({ position })

      expect(screen.getByTestId('resize-handle').className).toMatch(/\bz-10\b/)

      unmount()
    }
  })

  test('renders horizontal resize handle for left dock', () => {
    renderDockPanel({ position: 'left' })

    const handle = screen.getByTestId('resize-handle')
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  test('renders horizontal resize handle for right dock', () => {
    renderDockPanel({ position: 'right' })

    const handle = screen.getByTestId('resize-handle')
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
  })

  test('horizontal resize handle is on right edge for left dock', () => {
    renderDockPanel({ position: 'left' })

    expect(screen.getByTestId('resize-handle').className).toMatch(/right-0/)
  })

  test('horizontal resize handle is on left edge for right dock', () => {
    renderDockPanel({ position: 'right' })

    expect(screen.getByTestId('resize-handle').className).toMatch(/left-0/)
  })

  test('has controlled height from WorkspaceView for bottom dock', () => {
    renderDockPanel({ verticalSize: 420 })

    expect(screen.getByTestId('dock-panel')).toHaveStyle({ height: '420px' })
  })

  test('side dock uses controlled width from horizontalSize prop', () => {
    renderDockPanel({ position: 'left', horizontalSize: 480 })

    expect(screen.getByTestId('dock-panel')).toHaveStyle({ width: '480px' })
  })

  test('side dock does not use flex basis', () => {
    renderDockPanel({ position: 'right', horizontalSize: 360 })

    expect(screen.getByTestId('dock-panel')).not.toHaveStyle({
      flex: '0 0 40%',
    })
  })

  test('resize handle forwards mouse down to lifted resize hook', () => {
    const onVerticalResizeMouseDown = vi.fn()
    renderDockPanel({ onVerticalResizeMouseDown })

    fireEvent.mouseDown(screen.getByTestId('resize-handle'), { clientY: 100 })

    expect(onVerticalResizeMouseDown).toHaveBeenCalled()
  })

  test('horizontal handle mousedown calls onHorizontalResizeMouseDown', () => {
    const onHorizontalResizeMouseDown = vi.fn()
    renderDockPanel({ position: 'left', onHorizontalResizeMouseDown })

    fireEvent.mouseDown(screen.getByTestId('resize-handle'))

    expect(onHorizontalResizeMouseDown).toHaveBeenCalled()
  })

  test('bottom resize handle keyboard arrows call onVerticalSizeAdjust', async () => {
    const user = userEvent.setup()
    const onVerticalSizeAdjust = vi.fn()
    renderDockPanel({ onVerticalSizeAdjust })

    await user.keyboard('{ArrowUp}')
    screen.getByTestId('resize-handle').focus()
    await user.keyboard('{ArrowDown}')

    expect(onVerticalSizeAdjust).toHaveBeenCalledWith(-20)
  })

  test('top resize handle grows on ArrowDown', async () => {
    const user = userEvent.setup()
    const onVerticalSizeAdjust = vi.fn()
    renderDockPanel({ position: 'top', onVerticalSizeAdjust })

    screen.getByTestId('resize-handle').focus()
    await user.keyboard('{ArrowDown}')

    expect(onVerticalSizeAdjust).toHaveBeenCalledWith(20)
  })

  test('left dock ArrowRight grows horizontal size', async () => {
    const user = userEvent.setup()
    const onHorizontalSizeAdjust = vi.fn()
    renderDockPanel({ position: 'left', onHorizontalSizeAdjust })

    screen.getByTestId('resize-handle').focus()
    await user.keyboard('{ArrowRight}')

    expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(20)
  })

  test('left dock ArrowLeft shrinks horizontal size', async () => {
    const user = userEvent.setup()
    const onHorizontalSizeAdjust = vi.fn()
    renderDockPanel({ position: 'left', onHorizontalSizeAdjust })

    screen.getByTestId('resize-handle').focus()
    await user.keyboard('{ArrowLeft}')

    expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(-20)
  })

  test('right dock ArrowLeft grows horizontal size', async () => {
    const user = userEvent.setup()
    const onHorizontalSizeAdjust = vi.fn()
    renderDockPanel({ position: 'right', onHorizontalSizeAdjust })

    screen.getByTestId('resize-handle').focus()
    await user.keyboard('{ArrowLeft}')

    expect(onHorizontalSizeAdjust).toHaveBeenCalledWith(20)
  })

  test('vertical handle aria-valuemin and aria-valuemax come from props', () => {
    renderDockPanel({
      position: 'bottom',
      verticalPixelMin: 75,
      verticalPixelMax: 900,
    })

    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('aria-valuemin', '75')
    expect(handle).toHaveAttribute('aria-valuemax', '900')
  })

  test('horizontal handle aria-valuemin and aria-valuemax come from props', () => {
    renderDockPanel({
      position: 'left',
      horizontalPixelMin: 60,
      horizontalPixelMax: 960,
    })

    const handle = screen.getByTestId('resize-handle')
    expect(handle).toHaveAttribute('aria-valuemin', '60')
    expect(handle).toHaveAttribute('aria-valuemax', '960')
  })

  test('narrow side dock keeps dock switcher in compact actions menu', async () => {
    const user = userEvent.setup()
    renderDockPanel({ position: 'left', horizontalSize: 360 })

    expect(
      screen.queryByRole('button', { name: /dock: left/i })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))

    expect(
      screen.getByRole('button', { name: /dock: left/i })
    ).toBeInTheDocument()
  })

  test('wide side dock keeps dock switcher inline', () => {
    renderDockPanel({ position: 'left', horizontalSize: 480 })

    expect(
      screen.getByRole('button', { name: /dock: left/i })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /more dock actions/i })
    ).not.toBeInTheDocument()
  })

  test('bottom dock keeps dock switcher inline', () => {
    renderDockPanel({ position: 'bottom' })

    expect(
      screen.getByRole('button', { name: /dock: bottom/i })
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /more dock actions/i })
    ).not.toBeInTheDocument()
  })

  test('diff header switches between multiple unfinished terminal-bound reviews', async () => {
    const user = userEvent.setup()
    const onPendingFeedbackReviewSelect = vi.fn()

    renderDockPanel({
      tab: 'diff',
      pendingFeedbackReviews: [
        {
          key: 'session-a:p0',
          label: 'Agent A',
          commentCount: 2,
          fileCount: 1,
        },
        {
          key: 'session-b:p0',
          label: 'Agent B',
          commentCount: 1,
          fileCount: 1,
        },
      ],
      activeFeedbackReviewKey: 'session-b:p0',
      onPendingFeedbackReviewSelect,
    })

    await user.click(screen.getByRole('button', { name: 'Reviews 2' }))

    const reviewItems = screen.getAllByRole('menuitem')
    expect(reviewItems).toHaveLength(2)
    expect(within(reviewItems[0]).getByText('Agent A')).toBeInTheDocument()
    expect(within(reviewItems[0]).getByText('p0')).toBeInTheDocument()
    expect(within(reviewItems[0]).queryByText('Active')).not.toBeInTheDocument()
    expect(reviewItems[0]).not.toHaveClass('bg-primary-container/15')
    expect(
      within(reviewItems[0]).getByText('2 comments · 1 file')
    ).toBeInTheDocument()
    expect(within(reviewItems[1]).getByText('Agent B')).toBeInTheDocument()
    expect(within(reviewItems[1]).queryByText('Active')).not.toBeInTheDocument()
    expect(reviewItems[1]).toHaveAttribute('aria-current', 'true')
    expect(reviewItems[1]).toHaveClass('bg-primary-container/15')
    expect(
      within(reviewItems[1]).getByText('1 comment · 1 file')
    ).toBeInTheDocument()

    await user.click(within(reviewItems[1]).getByText('Agent B'))

    expect(onPendingFeedbackReviewSelect).toHaveBeenCalledWith('session-b:p0')
  })

  test('diff header renders one unfinished terminal-bound review as a pane chip', async () => {
    const user = userEvent.setup()
    const onPendingFeedbackReviewSelect = vi.fn()

    renderDockPanel({
      tab: 'diff',
      pendingFeedbackReviews: [
        {
          key: 'session-a:p1',
          label: 'Agent A',
          commentCount: 2,
          fileCount: 1,
        },
      ],
      activeFeedbackReviewKey: 'session-a:p1',
      onPendingFeedbackReviewSelect,
    })

    expect(
      screen.queryByRole('button', { name: 'Reviews 1' })
    ).not.toBeInTheDocument()

    const reviewChip = screen.getByRole('button', { name: 'p1' })
    expect(reviewChip).toHaveAttribute('aria-pressed', 'true')

    await user.click(reviewChip)

    expect(onPendingFeedbackReviewSelect).toHaveBeenCalledWith('session-a:p1')
  })

  test('diff header lists draft-only unfinished reviews', async () => {
    const user = userEvent.setup()
    const onPendingFeedbackReviewSelect = vi.fn()

    renderDockPanel({
      tab: 'diff',
      pendingFeedbackReviews: [
        {
          key: 'session-a:p1',
          label: 'Agent A',
          commentCount: 0,
          draftCount: 1,
          fileCount: 1,
        },
        {
          key: 'session-b:p0',
          label: 'Agent B',
          commentCount: 1,
          fileCount: 1,
        },
      ],
      activeFeedbackReviewKey: 'session-b:p0',
      onPendingFeedbackReviewSelect,
    })

    await user.click(screen.getByRole('button', { name: 'Reviews 2' }))

    const reviewItems = screen.getAllByRole('menuitem')
    expect(within(reviewItems[0]).getByText('Agent A')).toBeInTheDocument()
    expect(
      within(reviewItems[0]).getByText('1 draft · 1 file')
    ).toBeInTheDocument()

    await user.click(within(reviewItems[0]).getByText('Agent A'))

    expect(onPendingFeedbackReviewSelect).toHaveBeenCalledWith('session-a:p1')
  })

  test('narrow diff dock lists unfinished reviews in compact actions menu', async () => {
    const user = userEvent.setup()
    const onPendingFeedbackReviewSelect = vi.fn()

    renderDockPanel({
      tab: 'diff',
      position: 'left',
      horizontalSize: 360,
      pendingFeedbackReviews: [
        {
          key: 'session-a:p0',
          label: 'Agent A',
          commentCount: 2,
          fileCount: 1,
        },
        {
          key: 'session-b:p0',
          label: 'Agent B',
          commentCount: 1,
          fileCount: 1,
        },
      ],
      activeFeedbackReviewKey: 'session-b:p0',
      onPendingFeedbackReviewSelect,
    })

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))

    const menu = screen.getByTestId('dock-actions-menu')
    expect(within(menu).getByText('Unfinished reviews · 2')).toBeInTheDocument()
    expect(within(menu).getByText('Agent A')).toBeInTheDocument()
    expect(within(menu).getByText('1 comment · 1 file')).toBeInTheDocument()

    const reviewButtons = within(menu).getAllByRole('button')
    expect(reviewButtons[1]).toHaveAttribute('aria-current', 'true')
    expect(reviewButtons[1]).toHaveClass('bg-primary-container/15')
    expect(
      within(reviewButtons[1]).queryByText('Active')
    ).not.toBeInTheDocument()

    await user.click(within(menu).getByText('Agent A'))

    expect(onPendingFeedbackReviewSelect).toHaveBeenCalledWith('session-a:p0')
  })

  test('renders controlled active tab', () => {
    renderDockPanel({ tab: 'diff' })

    expect(screen.getByRole('button', { name: /diff viewer/i })).toHaveClass(
      'text-primary'
    )
  })

  test('clicking Diff Viewer tab calls onTabChange with "diff"', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    renderDockPanel({ tab: 'editor', onTabChange })

    await user.click(screen.getByRole('button', { name: /diff viewer/i }))

    expect(onTabChange).toHaveBeenCalledWith('diff')
  })

  test('displays Diff Viewer content when Diff tab is active', () => {
    renderDockPanel({ tab: 'diff' })

    expect(screen.getByText(/No changes to review/i)).toBeInTheDocument()
  })

  test('renders close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderDockPanel({ onClose })

    await user.click(screen.getByRole('button', { name: /collapse panel/i }))

    expect(onClose).toHaveBeenCalled()
  })

  test('uses Material Symbols icons for tabs', () => {
    renderDockPanel()

    expect(
      within(screen.getByRole('button', { name: /editor/i })).getByText('code')
    ).toBeInTheDocument()

    expect(
      within(screen.getByRole('button', { name: /diff viewer/i })).getByText(
        'difference'
      )
    ).toBeInTheDocument()
  })

  test('renders only Editor and Diff Viewer tabs', () => {
    renderDockPanel()

    expect(
      screen.getAllByRole('button', { name: /editor|diff viewer/i })
    ).toHaveLength(2)

    expect(
      screen.queryByRole('button', { name: /files/i })
    ).not.toBeInTheDocument()
  })

  test('header is 34px tall', () => {
    renderDockPanel()

    const editorTab = screen.getByRole('button', { name: /editor/i })
    // eslint-disable-next-line testing-library/no-node-access -- structural class check
    const header = editorTab.closest('div[class*="h-\\[34px\\]"]')

    expect(header).not.toBeNull()
  })

  test('active tab uses rounded-chip styling', () => {
    renderDockPanel({ tab: 'editor' })

    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toHaveClass('rounded-md')
    expect(editorTab).toHaveClass('bg-primary/[0.08]')
    expect(editorTab).toHaveClass('border-primary-container/30')
    expect(editorTab).toHaveClass('text-primary')
  })

  test('inactive tab has transparent border', () => {
    renderDockPanel({ tab: 'editor' })

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(diffTab).toHaveClass('border')
    expect(diffTab).toHaveClass('border-transparent')
  })

  test('each tab is 26px tall', () => {
    renderDockPanel()

    expect(screen.getByRole('button', { name: /editor/i })).toHaveClass(
      'h-[26px]'
    )

    expect(screen.getByRole('button', { name: /diff viewer/i })).toHaveClass(
      'h-[26px]'
    )
  })

  test.each(['top', 'bottom', 'left', 'right'] as const)(
    'data-position reflects %s prop',
    (position) => {
      renderDockPanel({ position })

      expect(screen.getByTestId('dock-panel')).toHaveAttribute(
        'data-position',
        position
      )
    }
  )

  test('mounts DockSwitcher with current position in compact menu for side docks', async () => {
    const user = userEvent.setup()
    renderDockPanel({ position: 'left', horizontalSize: 360 })

    await user.click(screen.getByRole('button', { name: /more dock actions/i }))

    const leftSwitcherButton = screen.getByRole('button', {
      name: /dock: left/i,
    })
    expect(leftSwitcherButton).toBeInTheDocument()
    expect(leftSwitcherButton).toHaveClass('text-primary-container')
  })

  test('clicking a DockSwitcher button calls onPositionChange', async () => {
    const user = userEvent.setup()
    const onPositionChange = vi.fn()
    renderDockPanel({ position: 'bottom', onPositionChange })

    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    expect(onPositionChange).toHaveBeenCalledWith('right')
  })

  test('forwards selectedDiffFile to Panel', () => {
    const selectedDiffFile = {
      path: 'src/test.ts',
      staged: false,
      cwd: '/repo',
    }

    renderDockPanel({
      tab: 'diff',
      selectedDiffFile,
      onSelectedDiffFileChange: vi.fn(),
    })

    expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
  })

  test('keeps the diff available while durable review hydration loads', () => {
    renderDockPanel({
      tab: 'diff',
      reviewStateLoading: true,
      selectedDiffFile: {
        path: 'src/foo.ts',
        staged: false,
        cwd: '/repo',
      },
      onSelectedDiffFileChange: vi.fn(),
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Restoring review comments…'
    )

    expect(
      screen.getByRole('toolbar', { name: 'Diff toolbar' })
    ).toBeInTheDocument()
  })

  test('keeps the diff available when review hydration fails', () => {
    renderDockPanel({
      tab: 'diff',
      reviewStateUnavailable: true,
      selectedDiffFile: {
        path: 'src/foo.ts',
        staged: false,
        cwd: '/repo',
      },
      onSelectedDiffFileChange: vi.fn(),
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Review comments are temporarily unavailable.'
    )

    expect(
      screen.getByRole('toolbar', { name: 'Diff toolbar' })
    ).toBeInTheDocument()
  })

  test('preserves selected diff file when the dock closes and reopens', () => {
    const useFileDiffSpy = vi.mocked(useFileDiffModule.useFileDiff)
    const { rerender } = render(<SelectedDiffLifecycleHarness open />)

    expect(useFileDiffSpy).toHaveBeenLastCalledWith(
      'src/second.ts',
      false,
      '/repo',
      false,
      '/repo:0:src/second.ts:unstaged'
    )

    const closed = false

    rerender(<SelectedDiffLifecycleHarness open={closed} />)
    expect(screen.getByTestId('dock-closed')).toBeInTheDocument()

    rerender(<SelectedDiffLifecycleHarness open />)

    expect(useFileDiffSpy).toHaveBeenLastCalledWith(
      'src/second.ts',
      false,
      '/repo',
      false,
      '/repo:0:src/second.ts:unstaged'
    )

    fireEvent.mouseEnter(screen.getByTestId('changed-files-edge-hint'))

    expect(
      screen.getByRole('button', { name: /second\.ts/i, current: 'page' })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('forwards parent-provided gitStatus to Panel on the unselected-file render branch', () => {
    vi.mocked(useGitStatusModule.useGitStatus).mockClear()

    const sharedGitStatus = {
      files: [],
      filesCwd: '/repo',
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: false,
    }

    renderDockPanel({ tab: 'diff', gitStatus: sharedGitStatus })

    expect(vi.mocked(useGitStatusModule.useGitStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    )
  })

  test('forwards parent-provided gitStatus to Panel on the selected-file render branch', () => {
    vi.mocked(useGitStatusModule.useGitStatus).mockClear()

    const sharedGitStatus = {
      files: [],
      filesCwd: '/repo',
      loading: false,
      error: null,
      refresh: vi.fn(),
      idle: false,
    }

    renderDockPanel({
      tab: 'diff',
      selectedDiffFile: {
        path: 'src/test.ts',
        staged: false,
        cwd: '/repo',
      },
      onSelectedDiffFileChange: vi.fn(),
      gitStatus: sharedGitStatus,
    })

    expect(vi.mocked(useGitStatusModule.useGitStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    )
  })

  test('keeps pending inline feedback across Editor and Diff tab switches when parent-owned', async () => {
    const user = userEvent.setup()
    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      response: inlineDiffResponse,
      diff: inlineDiffResponse.fileDiff,
      loading: false,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    })

    const { rerender } = render(<SharedFeedbackDockHarness tab="diff" open />)

    await addInlineComment(user, 'Survives tab switch')

    rerender(<SharedFeedbackDockHarness tab="editor" open />)

    expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()

    rerender(<SharedFeedbackDockHarness tab="diff" open />)

    expect(
      await screen.findByRole('button', { name: /finish feedback \(1\)/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Survives tab switch')).toBeInTheDocument()
  })

  test('keeps open inline comment draft across Editor and Diff tab switches when parent-owned', async () => {
    const user = userEvent.setup()
    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      response: inlineDiffResponse,
      diff: inlineDiffResponse.fileDiff,
      loading: false,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    })

    const { rerender } = render(<SharedFeedbackDockHarness tab="diff" open />)

    await openInlineCommentDraft(user, 'Draft survives tab switch')

    rerender(<SharedFeedbackDockHarness tab="editor" open />)

    expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()

    rerender(<SharedFeedbackDockHarness tab="diff" open />)

    expect(await screen.findByPlaceholderText('Request change')).toHaveValue(
      'Draft survives tab switch'
    )
  })

  test('keeps pending inline feedback after the dock unmounts and reopens when parent-owned', async () => {
    const user = userEvent.setup()
    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      response: inlineDiffResponse,
      diff: inlineDiffResponse.fileDiff,
      loading: false,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    })

    const { rerender } = render(<SharedFeedbackDockHarness tab="diff" open />)

    await addInlineComment(user, 'Survives dock reopen')

    const closed = false
    rerender(<SharedFeedbackDockHarness tab="diff" open={closed} />)

    expect(screen.getByTestId('dock-closed')).toBeInTheDocument()

    rerender(<SharedFeedbackDockHarness tab="diff" open />)

    expect(
      await screen.findByRole('button', { name: /finish feedback \(1\)/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Survives dock reopen')).toBeInTheDocument()
  })

  test('keeps open inline comment draft after the dock unmounts and reopens when parent-owned', async () => {
    const user = userEvent.setup()
    vi.spyOn(useFileDiffModule, 'useFileDiff').mockReturnValue({
      response: inlineDiffResponse,
      diff: inlineDiffResponse.fileDiff,
      loading: false,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    })

    const { rerender } = render(<SharedFeedbackDockHarness tab="diff" open />)

    await openInlineCommentDraft(user, 'Draft survives dock reopen')

    const closed = false
    rerender(<SharedFeedbackDockHarness tab="diff" open={closed} />)

    expect(screen.getByTestId('dock-closed')).toBeInTheDocument()

    rerender(<SharedFeedbackDockHarness tab="diff" open />)

    expect(await screen.findByPlaceholderText('Request change')).toHaveValue(
      'Draft survives dock reopen'
    )
  })

  test('keeps absolute feedback paths after dock reopen while the diff reloads', async () => {
    const user = userEvent.setup()
    let diffLoaded = true

    vi.spyOn(useFileDiffModule, 'useFileDiff').mockImplementation(() => ({
      response: diffLoaded ? inlineDiffResponse : null,
      diff: diffLoaded ? inlineDiffResponse.fileDiff : null,
      loading: !diffLoaded,
      error: null,
      latestDiffStatus: null,
      refetch: vi.fn(),
      acceptLatestDiff: vi.fn(),
    }))

    const writePty = vi.fn().mockResolvedValue(undefined)

    const feedbackDispatch: FeedbackDispatchTarget = {
      candidates: [
        {
          paneId: 'pane-1',
          ptyId: 'pty-1',
          tabName: 'Agent',
          agentLabel: 'Claude Code',
          cwd: '/repo/subdir',
          status: 'running',
          isFocused: true,
        },
      ],
      writePty,
    }

    const { rerender } = render(
      <SharedFeedbackDockHarness
        tab="diff"
        open
        feedbackDispatch={feedbackDispatch}
      />
    )

    await addInlineComment(user, 'Preserve the absolute path')

    const closed = false
    rerender(
      <SharedFeedbackDockHarness
        tab="diff"
        open={closed}
        feedbackDispatch={feedbackDispatch}
      />
    )

    diffLoaded = false
    rerender(
      <SharedFeedbackDockHarness
        tab="diff"
        open
        feedbackDispatch={feedbackDispatch}
      />
    )

    await user.click(
      await screen.findByRole('button', { name: /finish feedback \(1\)/i })
    )

    const popover = await screen.findByRole('dialog', {
      name: 'Finish feedback',
    })
    await user.click(
      within(popover).getByRole('button', { name: 'Confirm (Shift+Y)' })
    )

    await waitFor(() => expect(writePty).toHaveBeenCalledTimes(1))

    const [, payload] = writePty.mock.calls[0]
    expect(payload as string).toContain('/repo/src/foo.ts')
  })

  describe('focus highlight', () => {
    test('keeps a neutral junction edge regardless of focus (no bright border)', () => {
      // The active terminal pane owns the focus highlight; the dock no longer
      // paints a competing lavender outline. Both focus states use the same
      // neutral separator edge.
      const { rerenderWith } = renderDockPanel({
        isFocused: true,
        position: 'bottom',
      })
      const focused = screen.getByTestId('dock-panel')
      expect(focused).toHaveClass('border-t')
      expect(focused).toHaveClass('border-outline-variant/30')
      expect(focused).not.toHaveClass('border-primary-container')

      rerenderWith({ isFocused: false, position: 'bottom' })
      const unfocused = screen.getByTestId('dock-panel')
      expect(unfocused).toHaveClass('border-outline-variant/30')
      expect(unfocused).not.toHaveClass('border-primary-container')
    })

    test('does not paint a bright focus box shadow or outline overlay', () => {
      renderDockPanel({ isFocused: true })

      // No lavender ring/glow and no full outline rectangle competing with the
      // pane highlight.
      const panel = screen.getByTestId('dock-panel')
      expect(panel.style.boxShadow).toBeFalsy()
      expect(screen.queryByTestId('dock-focus-outline')).toBeNull()
    })

    test('dock container suppresses native browser focus outline', () => {
      renderDockPanel({ isFocused: true })

      expect(screen.getByTestId('dock-panel')).toHaveClass('focus:outline-none')
    })

    test('diff focus target suppresses native browser focus outline', () => {
      renderDockPanel({ isFocused: true, tab: 'diff' })

      expect(screen.getByTestId('diff-focus-target')).toHaveClass(
        'focus:outline-none'
      )
    })

    test('isFocused=false has no box shadow', () => {
      renderDockPanel({ isFocused: false })

      expect(screen.getByTestId('dock-panel').style.boxShadow).toBe('')
      expect(screen.queryByTestId('dock-focus-outline')).not.toBeInTheDocument()
    })
  })

  test('ref focusEditor delegates to CodeEditor when editor is ready', () => {
    const ref = createRef<DockPanelHandle>()

    renderDockPanel({
      ref,
      tab: 'editor',
      selectedFilePath: '/home/user/test.ts',
    })

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusEditor()).toBe(true)
    expect(mockEditorView.focus).toHaveBeenCalledOnce()
  })

  test('ref focusEditor returns false when no editorView is ready', () => {
    vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockReturnValueOnce({
      editorView: null,
      updateContent: vi.fn(),
      copySelection: vi.fn(),
      cutSelection: vi.fn(),
      pasteClipboard: vi.fn(),
      selectAll: vi.fn(),
      setContainer: vi.fn(),
    })
    const ref = createRef<DockPanelHandle>()

    renderDockPanel({
      ref,
      tab: 'editor',
      selectedFilePath: '/home/user/test.ts',
    })

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focusEditor()).toBe(false)
  })

  test('ref focusEditor falls back to section focus when editorView returns false', () => {
    // Simulates Ctrl+e with dock open but no file loaded (filePath=null → editorView missing).
    // focusEditor() should call sectionRef.focus() so the container captures keyboard input.
    vi.spyOn(useCodeMirrorModule, 'useCodeMirror').mockReturnValueOnce({
      editorView: null,
      updateContent: vi.fn(),
      copySelection: vi.fn(),
      cutSelection: vi.fn(),
      pasteClipboard: vi.fn(),
      selectAll: vi.fn(),
      setContainer: vi.fn(),
    })
    const ref = createRef<DockPanelHandle>()
    renderDockPanel({ ref, tab: 'editor', selectedFilePath: null })

    expect(ref.current).not.toBeNull()
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    const result = ref.current!.focusEditor()

    // Returns false because editorView is unavailable
    expect(result).toBe(false)
    // And the section element gets focused as fallback
    expect(focusSpy).toHaveBeenCalled()

    focusSpy.mockRestore()
  })

  test('ref focusDiff focuses the diff wrapper', () => {
    const ref = createRef<DockPanelHandle>()

    renderDockPanel({ ref, tab: 'diff' })

    expect(ref.current).not.toBeNull()
    ref.current!.focusDiff()
    expect(screen.getByTestId('diff-focus-target')).toHaveFocus()
  })
})
