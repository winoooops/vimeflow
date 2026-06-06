import { describe, test, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import * as useCodeMirrorModule from '../hooks/useCodeMirror'
import * as useVimModeModule from '../hooks/useVimMode'
import * as languageServiceModule from '../services/languageService'
import { javascript } from '@codemirror/lang-javascript'

// Mock the hooks
vi.mock('../hooks/useCodeMirror')
vi.mock('../hooks/useVimMode')
vi.mock('../services/languageService')

describe('CodeEditor', () => {
  const mockEditorView = {
    destroy: vi.fn(),
    focus: vi.fn(),
    posAtCoords: vi.fn().mockReturnValue(3),
    dispatch: vi.fn(),
    state: {
      doc: { toString: (): string => 'test content' },
      selection: { ranges: [{ from: 0, to: 0, empty: true }] },
    },
  }

  const mockUpdateContent = vi.fn()
  const mockCopySelection = vi.fn()
  const mockCutSelection = vi.fn()
  const mockPasteClipboard = vi.fn()
  const mockSelectAll = vi.fn()
  const mockUseCodeMirror = vi.fn()
  const mockUseVimMode = vi.fn()
  const mockGetLanguageExtension = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCodeMirror.mockReturnValue({
      editorView: mockEditorView,
      updateContent: mockUpdateContent,
      setContainer: vi.fn(),
      copySelection: mockCopySelection,
      cutSelection: mockCutSelection,
      pasteClipboard: mockPasteClipboard,
      selectAll: mockSelectAll,
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
  })

  test('renders empty state when no file is selected', () => {
    render(<CodeEditor filePath={null} content="" />)

    expect(screen.getByText(/no file selected/i)).toBeInTheDocument()
  })

  test('initializes CodeMirror with provided content and language', () => {
    render(<CodeEditor filePath="/home/user/app.tsx" content="const x = 42" />)

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContent: 'const x = 42',
        language: expect.any(Object),
      })
    )
  })

  test('detects language from filename', () => {
    render(<CodeEditor filePath="/home/user/app.tsx" content="" />)

    expect(mockGetLanguageExtension).toHaveBeenCalledWith('app.tsx')
  })

  test('renders editor container div', () => {
    render(<CodeEditor filePath="/home/user/test.ts" content="" />)

    const container = screen.getByTestId('codemirror-container')

    expect(container).toBeInTheDocument()
    // The container fills its wrapper (which is the flex-1 slot).
    expect(container).toHaveClass('h-full')
  })

  test('renders loading overlay when isLoading is true', () => {
    render(<CodeEditor filePath="/home/user/test.ts" content="" isLoading />)

    expect(screen.getByTestId('code-editor-loading')).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Loading file' })
    ).toBeInTheDocument()
  })

  test('does not render loading overlay when isLoading is false', () => {
    render(<CodeEditor filePath="/home/user/test.ts" content="" />)

    expect(screen.queryByTestId('code-editor-loading')).not.toBeInTheDocument()
  })

  test('tracks vim mode using useVimMode hook', () => {
    mockUseVimMode.mockReturnValue('INSERT')

    render(<CodeEditor filePath="/home/user/test.ts" content="" />)

    expect(mockUseVimMode).toHaveBeenCalledWith(mockEditorView)
  })

  test('passes onSave callback to useCodeMirror', () => {
    const handleSave = vi.fn()

    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        content=""
        onSave={handleSave}
      />
    )

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        onSave: expect.any(Function),
      })
    )
  })

  test('onSave prop is invoked when useCodeMirror triggers its save callback', () => {
    const handleSave = vi.fn()
    const captured: { onSave?: () => void } = {}

    mockUseCodeMirror.mockImplementation((options: { onSave: () => void }) => {
      captured.onSave = options.onSave

      return {
        editorView: mockEditorView,
        updateContent: mockUpdateContent,
        setContainer: vi.fn(),
        copySelection: mockCopySelection,
        cutSelection: mockCutSelection,
        pasteClipboard: mockPasteClipboard,
        selectAll: mockSelectAll,
      }
    })

    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        content=""
        onSave={handleSave}
      />
    )

    // Simulate vim :w
    captured.onSave?.()

    expect(handleSave).toHaveBeenCalledTimes(1)
  })

  test('no-ops the save callback when onSave prop is omitted', () => {
    const captured: { onSave?: () => void } = {}

    mockUseCodeMirror.mockImplementation((options: { onSave: () => void }) => {
      captured.onSave = options.onSave

      return {
        editorView: mockEditorView,
        updateContent: mockUpdateContent,
        setContainer: vi.fn(),
        copySelection: mockCopySelection,
        cutSelection: mockCutSelection,
        pasteClipboard: mockPasteClipboard,
        selectAll: mockSelectAll,
      }
    })

    render(<CodeEditor filePath="/home/user/test.ts" content="" />)

    // Should not throw when no onSave is wired — the component must not
    // fall back to an internal writeFile path (that path silently
    // swallowed errors).
    expect(() => captured.onSave?.()).not.toThrow()
  })

  test('pushes new content into CodeMirror when content prop changes', () => {
    const { rerender } = render(
      <CodeEditor filePath="/home/user/test.ts" content="hello" />
    )

    // The prop-sync effect should push the initial content.
    expect(mockUpdateContent).toHaveBeenCalledWith('hello')

    mockUpdateContent.mockClear()

    rerender(<CodeEditor filePath="/home/user/test.ts" content="world" />)

    expect(mockUpdateContent).toHaveBeenCalledWith('world')
  })

  test('does not push content updates when filePath is null', () => {
    render(<CodeEditor filePath={null} content="should not push" />)

    expect(mockUpdateContent).not.toHaveBeenCalled()
  })

  test('handles unknown file extensions', () => {
    mockGetLanguageExtension.mockReturnValue(null)

    render(<CodeEditor filePath="/home/user/file.xyz" content="" />)

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        language: null,
      })
    )
  })

  test('passes onContentChange to useCodeMirror as onChange', () => {
    const onContentChange = vi.fn()

    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        content=""
        onContentChange={onContentChange}
      />
    )

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        onChange: onContentChange,
      })
    )
  })

  test('passes shouldAutoFocus to useCodeMirror', () => {
    render(
      <CodeEditor filePath="/home/user/test.ts" content="" shouldAutoFocus />
    )

    expect(mockUseCodeMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldAutoFocus: true,
      })
    )
  })

  test('ref focus returns true when editorView is ready', () => {
    const ref = createRef<CodeEditorHandle>()

    render(<CodeEditor ref={ref} filePath="/test.ts" content="hello" />)

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focus()).toBe(true)
    expect(mockEditorView.focus).toHaveBeenCalledOnce()
  })

  test('ref focus returns false when no file is loaded', () => {
    const ref = createRef<CodeEditorHandle>()

    render(<CodeEditor ref={ref} filePath={null} content="" />)

    expect(ref.current).not.toBeNull()
    expect(ref.current!.focus()).toBe(false)
  })

  test('right-click menu routes editor clipboard actions', () => {
    render(<CodeEditor filePath="/home/user/test.ts" content="hello" />)

    const container = screen.getByTestId('codemirror-container')

    const clickMenuItem = (name: RegExp): void => {
      fireEvent.contextMenu(container, { clientX: 40, clientY: 80 })
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }

    clickMenuItem(/copy/i)
    expect(mockCopySelection).toHaveBeenCalledOnce()

    clickMenuItem(/cut/i)
    expect(mockCutSelection).toHaveBeenCalledOnce()

    clickMenuItem(/paste/i)
    expect(mockPasteClipboard).toHaveBeenCalledOnce()

    clickMenuItem(/select all/i)
    expect(mockSelectAll).toHaveBeenCalledOnce()
  })

  test('right-click focuses editor and syncs selection to click position', () => {
    render(<CodeEditor filePath="/home/user/test.ts" content="hello" />)

    const container = screen.getByTestId('codemirror-container')

    fireEvent.contextMenu(container, { clientX: 40, clientY: 80 })

    expect(mockEditorView.focus).toHaveBeenCalledOnce()
    expect(mockEditorView.posAtCoords).toHaveBeenCalledWith({ x: 40, y: 80 })
    expect(mockEditorView.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 3, head: 3 },
    })
  })

  test('right-click still shows menu when posAtCoords returns null', () => {
    mockEditorView.posAtCoords.mockReturnValueOnce(null)

    render(<CodeEditor filePath="/home/user/test.ts" content="hello" />)

    const container = screen.getByTestId('codemirror-container')

    fireEvent.contextMenu(container, { clientX: 40, clientY: 80 })

    expect(mockEditorView.focus).toHaveBeenCalledOnce()
    expect(mockEditorView.posAtCoords).toHaveBeenCalledWith({ x: 40, y: 80 })
    expect(mockEditorView.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: 'Context menu' })).toBeInTheDocument()
  })

  test('right-click preserves existing selection when clicking inside it', () => {
    mockEditorView.posAtCoords.mockReturnValueOnce(3)
    mockEditorView.state.selection.ranges = [
      { from: 0, to: 5, empty: false },
    ]

    render(<CodeEditor filePath="/home/user/test.ts" content="hello" />)

    const container = screen.getByTestId('codemirror-container')

    fireEvent.contextMenu(container, { clientX: 40, clientY: 80 })

    expect(mockEditorView.focus).toHaveBeenCalledOnce()
    expect(mockEditorView.posAtCoords).toHaveBeenCalledWith({ x: 40, y: 80 })
    expect(mockEditorView.dispatch).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: 'Context menu' })).toBeInTheDocument()
  })
})
