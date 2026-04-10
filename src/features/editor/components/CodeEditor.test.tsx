import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CodeEditor } from './CodeEditor'
import type { IFileSystemService } from '../../files/services/fileSystemService'
import * as useCodeMirrorModule from '../hooks/useCodeMirror'
import * as useVimModeModule from '../hooks/useVimMode'
import * as languageServiceModule from '../services/languageService'
import { javascript } from '@codemirror/lang-javascript'

// Mock the hooks
vi.mock('../hooks/useCodeMirror')
vi.mock('../hooks/useVimMode')
vi.mock('../services/languageService')

const mockFileSystemService: IFileSystemService = {
  listDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}

describe('CodeEditor', () => {
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

    // Mock fileSystemService methods
    vi.mocked(mockFileSystemService.readFile).mockResolvedValue(
      'file content from service'
    )
    vi.mocked(mockFileSystemService.writeFile).mockResolvedValue()
  })

  test('renders empty state when no file is selected', () => {
    render(
      <CodeEditor filePath={null} fileSystemService={mockFileSystemService} />
    )

    expect(screen.getByText(/no file selected/i)).toBeInTheDocument()
  })

  test('loads file content when filePath prop is provided', async () => {
    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockFileSystemService.readFile).toHaveBeenCalledWith(
        '/home/user/test.ts'
      )
    })
  })

  test('initializes CodeMirror with file content and language', async () => {
    render(
      <CodeEditor
        filePath="/home/user/app.tsx"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockUseCodeMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContent: 'file content from service',
          language: expect.any(Object),
        })
      )
    })
  })

  test('detects language from filename', async () => {
    render(
      <CodeEditor
        filePath="/home/user/app.tsx"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockGetLanguageExtension).toHaveBeenCalledWith('app.tsx')
    })
  })

  test('renders editor container div', () => {
    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    const container = screen.getByTestId('codemirror-container')

    expect(container).toBeInTheDocument()
    expect(container).toHaveClass('flex-1')
  })

  test('tracks vim mode using useVimMode hook', async () => {
    mockUseVimMode.mockReturnValue('INSERT')

    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockUseVimMode).toHaveBeenCalledWith(mockEditorView)
    })
  })

  test('passes onSave callback to useCodeMirror', async () => {
    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockUseCodeMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          onSave: expect.any(Function),
        })
      )
    })
  })

  test('saves file when onSave is called', async () => {
    let onSaveCallback: (() => void) | null = null

    mockUseCodeMirror.mockImplementation(
      (options: {
        onSave: () => void
      }): {
        editorView: typeof mockEditorView
        updateContent: ReturnType<typeof vi.fn>
      } => {
        onSaveCallback = options.onSave

        return {
          editorView: mockEditorView,
          updateContent: vi.fn(),
        }
      }
    )

    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(onSaveCallback).not.toBeNull()
    })

    // Call the save callback (simulates :w in vim)
    onSaveCallback!()

    await waitFor(() => {
      expect(mockFileSystemService.writeFile).toHaveBeenCalledWith(
        '/home/user/test.ts',
        'test content'
      )
    })
  })

  test('reloads file when filePath prop changes', async () => {
    const { rerender } = render(
      <CodeEditor
        filePath="/home/user/file1.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockFileSystemService.readFile).toHaveBeenCalledWith(
        '/home/user/file1.ts'
      )
    })

    vi.mocked(mockFileSystemService.readFile).mockResolvedValue(
      'content of file 2'
    )

    rerender(
      <CodeEditor
        filePath="/home/user/file2.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockFileSystemService.readFile).toHaveBeenCalledWith(
        '/home/user/file2.ts'
      )
    })
  })

  test('handles file read errors gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation((): void => {
        // Mock implementation - intentionally empty
      })

    vi.mocked(mockFileSystemService.readFile).mockRejectedValue(
      new Error('File not found')
    )

    render(
      <CodeEditor
        filePath="/home/user/missing.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to load file:',
        expect.any(Error)
      )
    })

    consoleError.mockRestore()
  })

  test('does not reload when filePath changes to null', async () => {
    const { rerender } = render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockFileSystemService.readFile).toHaveBeenCalledTimes(1)
    })

    vi.clearAllMocks()

    rerender(
      <CodeEditor filePath={null} fileSystemService={mockFileSystemService} />
    )

    expect(mockFileSystemService.readFile).not.toHaveBeenCalled()
  })

  test('handles unknown file extensions', async () => {
    mockGetLanguageExtension.mockReturnValue(null)

    render(
      <CodeEditor
        filePath="/home/user/file.xyz"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockUseCodeMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          language: null,
        })
      )
    })
  })

  test('passes options to useCodeMirror', async () => {
    render(
      <CodeEditor
        filePath="/home/user/test.ts"
        fileSystemService={mockFileSystemService}
      />
    )

    await waitFor(() => {
      expect(mockUseCodeMirror).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContent: expect.any(String),
          onSave: expect.any(Function),
        })
      )
    })
  })
})
