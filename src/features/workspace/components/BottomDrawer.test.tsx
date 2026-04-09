import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import BottomDrawer from './BottomDrawer'
import type { IFileSystemService } from '../../files/services/fileSystemService'
import * as useCodeMirrorModule from '../../editor/hooks/useCodeMirror'
import * as useVimModeModule from '../../editor/hooks/useVimMode'
import * as languageServiceModule from '../../editor/services/languageService'
import { javascript } from '@codemirror/lang-javascript'

// Mock CodeMirror hooks to prevent actual initialization
vi.mock('../../editor/hooks/useCodeMirror')
vi.mock('../../editor/hooks/useVimMode')
vi.mock('../../editor/services/languageService')

const mockFileSystemService: IFileSystemService = {
  listDir: vi.fn(),
  readFile: vi.fn().mockResolvedValue('// Mock file content'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}

describe('BottomDrawer', () => {
  const mockEditorView = {
    destroy: vi.fn(),
    state: { doc: { toString: (): string => 'test content' } },
  }

  const mockUseCodeMirror = vi.fn()
  const mockUseVimMode = vi.fn()
  const mockGetLanguageExtension = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock implementations
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

    // Mock fileSystemService methods
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue(
      'file content from service'
    )
    vi.mocked(mockFileSystemService.writeFile).mockResolvedValue()
  })

  test('accepts selectedFilePath prop', () => {
    render(
      <BottomDrawer
        selectedFilePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    expect(screen.getByTestId('bottom-drawer')).toBeInTheDocument()
  })

  test('passes selectedFilePath to CodeEditor', () => {
    render(
      <BottomDrawer
        selectedFilePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    // CodeEditor should be rendered (not "No file selected" message)
    expect(screen.queryByTestId('no-file-selected')).not.toBeInTheDocument()
  })

  test('shows CodeEditor when file is selected', () => {
    render(
      <BottomDrawer
        selectedFilePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    // Check that CodeMirror container is rendered
    expect(screen.getByTestId('codemirror-container')).toBeInTheDocument()
  })

  test('shows "No file selected" when selectedFilePath is null', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    expect(screen.getByTestId('no-file-selected')).toBeInTheDocument()
    expect(screen.getByText(/No file selected/i)).toBeInTheDocument()
  })

  test('renders resize handle at top edge', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    const resizeHandle = screen.getByTestId('resize-handle')
    expect(resizeHandle).toBeInTheDocument()
  })

  test('has dynamic height from useResizable hook', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    const drawer = screen.getByTestId('bottom-drawer')
    // Should have inline style with height (default 400px)
    expect(drawer).toHaveStyle({ height: '400px' })
  })

  test('resize handle triggers mouse down handler', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    const resizeHandle = screen.getByTestId('resize-handle')
    fireEvent.mouseDown(resizeHandle, { clientY: 100 })

    // No error should occur
    expect(resizeHandle).toBeInTheDocument()
  })

  test('renders with Editor tab active by default', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    // Editor tab should be active (has border-bottom and primary color)
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toBeInTheDocument()
    expect(editorTab).toHaveClass('text-primary')
    expect(editorTab).toHaveClass('border-b-2')

    // Diff tab should be inactive
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(diffTab).toBeInTheDocument()
    expect(diffTab).toHaveClass('text-slate-400')
    expect(diffTab).not.toHaveClass('border-b-2')
  })

  test('switches to Diff Viewer tab when clicked', async () => {
    const user = userEvent.setup()
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    await user.click(diffTab)

    // Diff tab should now be active
    expect(diffTab).toHaveClass('text-primary')
    expect(diffTab).toHaveClass('border-b-2')

    // Editor tab should be inactive
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toHaveClass('text-slate-400')
    expect(editorTab).not.toHaveClass('border-b-2')
  })

  test('displays Diff Viewer content when Diff tab is active', async () => {
    const user = userEvent.setup()
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    // Switch to Diff tab
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    await user.click(diffTab)

    // Check for diff content
    expect(screen.getByText(/No changes to review/i)).toBeInTheDocument()
  })

  test('renders collapse toggle button', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    const collapseToggle = screen.getByRole('button', {
      name: /collapse|expand|keyboard_arrow/i,
    })
    expect(collapseToggle).toBeInTheDocument()
  })

  test('uses Material Symbols icons for tabs', () => {
    render(
      <BottomDrawer
        selectedFilePath={null}
        fileSystemService={mockFileSystemService}
      />
    )

    // Editor tab should have 'code' icon text
    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(within(editorTab).getByText('code')).toBeInTheDocument()

    // Diff tab should have 'difference' icon text
    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(within(diffTab).getByText('difference')).toBeInTheDocument()
  })
})
