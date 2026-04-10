import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeEditor } from './CodeEditor'
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
    state: { doc: { toString: (): string => 'test content' } },
  }

  const mockUpdateContent = vi.fn()
  const mockUseCodeMirror = vi.fn()
  const mockUseVimMode = vi.fn()
  const mockGetLanguageExtension = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCodeMirror.mockReturnValue({
      editorView: mockEditorView,
      updateContent: mockUpdateContent,
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
})
