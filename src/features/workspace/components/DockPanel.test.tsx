import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { createRef, forwardRef, type ReactElement } from 'react'
import DockPanel, { type DockPanelHandle } from './DockPanel'
import * as useCodeMirrorModule from '../../editor/hooks/useCodeMirror'
import * as useVimModeModule from '../../editor/hooks/useVimMode'
import * as languageServiceModule from '../../editor/services/languageService'
import * as useGitStatusModule from '../../diff/hooks/useGitStatus'
import * as useFileDiffModule from '../../diff/hooks/useFileDiff'
import { javascript } from '@codemirror/lang-javascript'

vi.mock('../../editor/hooks/useCodeMirror')
vi.mock('../../editor/hooks/useVimMode')
vi.mock('../../editor/services/languageService')
vi.mock('../../diff/hooks/useGitStatus')
vi.mock('../../diff/hooks/useFileDiff')
vi.mock('@pierre/diffs/react', () => ({
  useWorkerPool: vi.fn(() => null),
  MultiFileDiff: vi.fn(() => <div data-testid="multi-file-diff" />),
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
      refetch: vi.fn(),
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

  test('shows "No file selected" when selectedFilePath is null', () => {
    renderDockPanel()

    expect(screen.getByTestId('no-file-selected')).toBeInTheDocument()
    expect(screen.getByText(/No file selected/i)).toBeInTheDocument()
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

  test('renders controlled active tab', () => {
    renderDockPanel({ tab: 'diff' })

    expect(screen.getByRole('button', { name: /diff viewer/i })).toHaveClass(
      'text-[#e2c7ff]'
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
    expect(editorTab).toHaveClass('bg-[rgba(226,199,255,0.08)]')
    expect(editorTab).toHaveClass('border-[rgba(203,166,247,0.3)]')
    expect(editorTab).toHaveClass('text-[#e2c7ff]')
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
    expect(leftSwitcherButton).toHaveClass('text-[#cba6f7]')
  })

  test('clicking a DockSwitcher button calls onPositionChange', async () => {
    const user = userEvent.setup()
    const onPositionChange = vi.fn()
    renderDockPanel({ position: 'bottom', onPositionChange })

    await user.click(screen.getByRole('button', { name: /dock: right/i }))

    expect(onPositionChange).toHaveBeenCalledWith('right')
  })

  test('forwards selectedDiffFile to DiffPanelContent', () => {
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

  test('forwards parent-provided gitStatus to DiffPanelContent on the unselected-file render branch', () => {
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

  test('forwards parent-provided gitStatus to DiffPanelContent on the selected-file render branch', () => {
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

  describe('focus highlight', () => {
    test('isFocused=true applies mauve border to bottom junction edge', () => {
      renderDockPanel({ isFocused: true, position: 'bottom' })

      // border-t is the edge class; border-[color] is the shared shorthand
      const section = screen.getByTestId('dock-panel')
      expect(section).toHaveClass('border-t')
      expect(section).toHaveClass('border-[#cba6f7]')
    })

    test('isFocused=false uses neutral bottom junction edge', () => {
      renderDockPanel({ isFocused: false, position: 'bottom' })
      const section = screen.getByTestId('dock-panel')

      expect(section).toHaveClass('border-t')
      expect(section).toHaveClass('border-[rgba(74,68,79,0.3)]')
      expect(section).not.toHaveClass('border-[#cba6f7]')
    })

    test('isFocused=true applies box shadow', () => {
      renderDockPanel({ isFocused: true })

      expect(screen.getByTestId('dock-panel').style.boxShadow).toBeTruthy()
    })

    test('isFocused=true renders a complete focus outline overlay', () => {
      renderDockPanel({ isFocused: true })

      expect(screen.getByTestId('dock-focus-outline')).toHaveClass(
        'border-[#cba6f7]'
      )
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
