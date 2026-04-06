import {
  render,
  screen,
  waitFor,
  act,
  renderHook,
} from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFileContent } from './hooks/useFileContent'
import { CodeEditor } from './components/CodeEditor'
import type { FileContentResponse } from './services/fileService'

// Mock file content responses
const mockTypeScriptFile: FileContentResponse = {
  content: `export const Button = (): ReactElement => {
  return <button>Click me</button>
}`,
  language: 'typescript',
}

const mockJavaScriptFile: FileContentResponse = {
  content: `function sum(a, b) {
  return a + b
}`,
  language: 'javascript',
}

const mockCSSFile: FileContentResponse = {
  content: `.button {
  background: blue;
  color: white;
}`,
  language: 'css',
}

// Mock fetch for Vite dev middleware
const originalFetch = global.fetch

// Mock Shiki highlighting service
vi.mock('./services/shikiService', () => ({
  detectLanguage: vi.fn((fileName: string) => {
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
      return 'typescript'
    }
    if (fileName.endsWith('.js') || fileName.endsWith('.jsx')) {
      return 'javascript'
    }
    if (fileName.endsWith('.css')) {
      return 'css'
    }

    return 'plaintext'
  }),
  highlightCode: vi.fn((content: string, language: string) => {
    // Mock syntax highlighting by returning tokens
    const lines = content.split('\n')

    return Promise.resolve(
      lines.map((line) => ({
        tokens: [
          {
            content: line,
            color: language === 'typescript' ? '#89b4fa' : '#cdd6f4',
            fontStyle: 0,
          },
        ],
      }))
    )
  }),
}))

describe('FileContentLoading Integration Tests', () => {
  beforeEach(() => {
    // Mock fetch for file service API
    global.fetch = vi.fn((url: string | URL | Request) => {
      let urlString: string
      if (typeof url === 'string') {
        urlString = url
      } else if (url instanceof URL) {
        urlString = url.toString()
      } else {
        urlString = url.url
      }

      if (urlString.includes('/api/files/content')) {
        const urlObj =
          typeof url === 'string'
            ? new URL(url, window.location.origin)
            : url instanceof URL
              ? url
              : new URL(url.url)
        const path = urlObj.searchParams.get('path')

        if (path?.includes('Button.tsx')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTypeScriptFile),
          } as Response)
        }

        if (path?.includes('sum.js')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockJavaScriptFile),
          } as Response)
        }

        if (path?.includes('styles.css')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockCSSFile),
          } as Response)
        }

        if (path?.includes('nonexistent.ts')) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({ error: 'File not found: nonexistent.ts' }),
          } as Response)
        }
      }

      return Promise.reject(new Error(`Unhandled fetch: ${urlString}`))
    }) as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  test('useFileContent hook loads file content from API', async () => {
    const { result } = renderHook(() => useFileContent())

    // Initially, no content loaded
    expect(result.current.content).toBeNull()
    expect(result.current.language).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()

    // Load a TypeScript file
    await act(async () => {
      await result.current.loadFile('src/components/Button.tsx')
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.content).toBe(mockTypeScriptFile.content)
    })

    expect(result.current.language).toBe('typescript')
    expect(result.current.error).toBeNull()
  })

  test('useFileContent hook shows loading state while fetching', async () => {
    const { result } = renderHook(() => useFileContent())

    // Create a promise that we can control
    let resolveLoad: (value: Response) => void

    const slowFetch = new Promise<Response>((resolve) => {
      resolveLoad = resolve
    })

    // Override fetch with slow version for this test
    global.fetch = vi.fn(() => slowFetch) as typeof fetch

    // Start loading (don't await yet)
    let loadPromise: Promise<void>

    act(() => {
      loadPromise = result.current.loadFile('src/components/Button.tsx')
    })

    // Should show loading state
    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    // Now complete the fetch
    await act(async () => {
      resolveLoad({
        ok: true,
        json: () => Promise.resolve(mockTypeScriptFile),
      } as Response)
      await loadPromise
    })

    // Should complete loading
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  test('useFileContent hook handles error state when file fetch fails', async () => {
    const { result } = renderHook(() => useFileContent())

    // Try to load a nonexistent file
    await act(async () => {
      await result.current.loadFile('src/nonexistent.ts')
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeTruthy()
    })

    expect(result.current.content).toBeNull()
    expect(result.current.language).toBeNull()
  })

  test('useFileContent hook caches file content on subsequent loads', async () => {
    const { result } = renderHook(() => useFileContent())

    // First load
    await act(async () => {
      await result.current.loadFile('src/components/Button.tsx')
    })

    await waitFor(() => {
      expect(result.current.content).toBe(mockTypeScriptFile.content)
    })

    const fetchCallCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .length

    // Second load (should use cache)
    await act(async () => {
      await result.current.loadFile('src/components/Button.tsx')
    })

    // Fetch should not be called again (uses cache)
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchCallCount
    )
    expect(result.current.content).toBe(mockTypeScriptFile.content)
  })

  test('useFileContent hook loads different files sequentially', async () => {
    const { result } = renderHook(() => useFileContent())

    // Load TypeScript file
    await act(async () => {
      await result.current.loadFile('src/components/Button.tsx')
    })

    await waitFor(() => {
      expect(result.current.content).toBe(mockTypeScriptFile.content)
      expect(result.current.language).toBe('typescript')
    })

    // Load JavaScript file
    await act(async () => {
      await result.current.loadFile('src/utils/sum.js')
    })

    await waitFor(() => {
      expect(result.current.content).toBe(mockJavaScriptFile.content)
      expect(result.current.language).toBe('javascript')
    })

    // Load CSS file
    await act(async () => {
      await result.current.loadFile('src/styles/styles.css')
    })

    await waitFor(() => {
      expect(result.current.content).toBe(mockCSSFile.content)
      expect(result.current.language).toBe('css')
    })
  })

  test('CodeEditor renders file content with syntax highlighting', async () => {
    render(
      <CodeEditor
        content={mockTypeScriptFile.content}
        currentLine={2}
        fileName="Button.tsx"
      />
    )

    // Wait for syntax highlighting to apply
    await waitFor(() => {
      const codeEditor = screen.getByTestId('code-editor')

      expect(codeEditor).toBeInTheDocument()
    })

    // Verify content is rendered
    const lines = mockTypeScriptFile.content.split('\n')

    for (const line of lines) {
      if (line.trim()) {
        const codeEditor = screen.getByTestId('code-editor')

        expect(codeEditor.textContent).toContain(line)
      }
    }
  })

  test('CodeEditor highlights current line correctly', async () => {
    const currentLine = 2

    render(
      <CodeEditor
        content={mockTypeScriptFile.content}
        currentLine={currentLine}
        fileName="Button.tsx"
      />
    )

    await waitFor(() => {
      const currentLineElement = screen.getByTestId(`code-line-${currentLine}`)

      expect(currentLineElement).toHaveClass('bg-primary/5')
    })

    const currentLineElement = screen.getByTestId(`code-line-${currentLine}`)

    expect(currentLineElement).toHaveClass('border-primary')
    expect(currentLineElement).toHaveClass('border-l-2')
  })

  test('CodeEditor renders plain text when syntax highlighting is not available', () => {
    const plainContent = 'line 1\nline 2\nline 3'

    render(
      <CodeEditor
        content={plainContent}
        currentLine={null}
        fileName="plain.txt"
      />
    )

    // Should render plain lines
    const lines = plainContent.split('\n')

    for (let index = 0; index < lines.length; index++) {
      const lineNumber = index + 1
      const lineElement = screen.getByTestId(`code-line-${lineNumber}`)

      expect(lineElement).toBeInTheDocument()
    }
  })

  test('CodeEditor applies syntax highlighting based on file language', async () => {
    const { rerender } = render(
      <CodeEditor
        content={mockTypeScriptFile.content}
        currentLine={null}
        fileName="Button.tsx"
      />
    )

    await waitFor(() => {
      const codeEditor = screen.getByTestId('code-editor')

      expect(codeEditor).toBeInTheDocument()
    })

    // Change to JavaScript file
    rerender(
      <CodeEditor
        content={mockJavaScriptFile.content}
        currentLine={null}
        fileName="sum.js"
      />
    )

    await waitFor(() => {
      const codeEditor = screen.getByTestId('code-editor')

      expect(codeEditor.textContent).toContain('function sum')
    })
  })

  test('Integration: useFileContent + CodeEditor renders loaded file with highlighting', async () => {
    // Step 1: Use the hook to load file content
    const { result } = renderHook(() => useFileContent())

    await act(async () => {
      await result.current.loadFile('src/components/Button.tsx')
    })

    await waitFor(() => {
      expect(result.current.content).toBe(mockTypeScriptFile.content)
    })

    // Step 2: Render CodeEditor with loaded content
    render(
      <CodeEditor
        content={result.current.content ?? ''}
        currentLine={1}
        fileName="Button.tsx"
      />
    )

    // Step 3: Verify the integration
    await waitFor(() => {
      const codeEditor = screen.getByTestId('code-editor')

      expect(codeEditor).toBeInTheDocument()
    })

    const codeEditor = screen.getByTestId('code-editor')

    expect(codeEditor.textContent).toContain('export const Button')
  })
})
