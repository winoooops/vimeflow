import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import DockPanel from './DockPanel'
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

type DockPanelTestProps = Parameters<typeof DockPanel>[0]

const renderDockPanel = (
  overrides: Partial<DockPanelTestProps> = {}
): ReturnType<typeof render> => {
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
    selectedFilePath: null,
    content: '',
    ...overrides,
  } as DockPanelTestProps

  return render(<DockPanel {...props} />)
}

describe('DockPanel', () => {
  const mockEditorView = {
    destroy: vi.fn(),
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
      diff: null,
      loading: false,
      error: null,
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

  test('renders resize handle for vertical docks', () => {
    const { unmount } = renderDockPanel()

    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()

    unmount()
    renderDockPanel({ position: 'top' })

    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()
  })

  test('does not render resize handle for side docks', () => {
    renderDockPanel({ position: 'left' })

    expect(screen.queryByTestId('resize-handle')).not.toBeInTheDocument()
  })

  test('has controlled height from WorkspaceView for bottom dock', () => {
    renderDockPanel({ verticalSize: 420 })

    expect(screen.getByTestId('dock-panel')).toHaveStyle({ height: '420px' })
  })

  test('uses fixed flex basis for side docks', () => {
    renderDockPanel({ position: 'right' })

    expect(screen.getByTestId('dock-panel')).toHaveStyle({ flex: '0 0 40%' })
  })

  test('resize handle forwards mouse down to lifted resize hook', () => {
    const onVerticalResizeMouseDown = vi.fn()
    renderDockPanel({ onVerticalResizeMouseDown })

    fireEvent.mouseDown(screen.getByTestId('resize-handle'), { clientY: 100 })

    expect(onVerticalResizeMouseDown).toHaveBeenCalled()
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

  test('mounts DockSwitcher in header with current position', () => {
    renderDockPanel({ position: 'left' })

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
})
