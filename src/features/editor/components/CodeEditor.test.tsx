import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CodeEditor } from './CodeEditor'
import * as shikiService from '../services/shikiService'

// Mock Shiki service
vi.mock('../services/shikiService', () => ({
  highlightCode: vi.fn((code: string) =>
    // Return mock LineTokens structure
    Promise.resolve(
      code.split('\n').map((line) => ({
        tokens: [
          {
            content: line || ' ',
            color: '#cdd6f4',
            fontStyle: 0,
          },
        ],
      }))
    )
  ),
  detectLanguage: vi.fn((fileName: string) => {
    if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) {
      return 'typescript'
    }
    if (fileName.endsWith('.jsx') || fileName.endsWith('.js')) {
      return 'javascript'
    }
    if (fileName.endsWith('.css')) {
      return 'css'
    }
    if (fileName.endsWith('.md')) {
      return 'markdown'
    }

    return 'plaintext'
  }),
}))

describe('CodeEditor', () => {
  const sampleCode = `import React from 'react'

const App = () => {
  return <div>Hello</div>
}

export default App`

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders code content', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    await waitFor(() => {
      expect(screen.getByTestId('code-line-1')).toBeInTheDocument()
      expect(screen.getByTestId('code-line-3')).toHaveTextContent(
        'const App = () => {'
      )

      expect(screen.getByTestId('code-line-7')).toHaveTextContent(
        'export default App'
      )
    })
  })

  test('applies correct container styling', () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    const container = screen.getByTestId('code-editor')

    // Outer container has flex layout for line numbers + code
    expect(container).toHaveClass('flex')
    expect(container).toHaveClass('flex-1')
    expect(container).toHaveClass('overflow-auto')
    expect(container).toHaveClass('thin-scrollbar')
  })

  test('renders code lines with proper structure', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    // Verify code lines are rendered
    await waitFor(() => {
      expect(screen.getByTestId('code-line-1')).toBeInTheDocument()
      expect(screen.getByTestId('code-line-7')).toBeInTheDocument()
    })
  })

  test('renders line numbers gutter', () => {
    render(
      <CodeEditor content={sampleCode} currentLine={3} fileName="App.tsx" />
    )

    const lineNumbersGutter = screen.getByTestId('line-numbers-gutter')
    expect(lineNumbersGutter).toBeInTheDocument()
  })

  test('highlights current line with bg-primary/5 and border', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={3} fileName="App.tsx" />
    )

    await waitFor(() => {
      const lines = screen.getAllByTestId(/^code-line-/)
      const currentLine = lines[2] // 0-indexed, so line 3 is index 2

      expect(currentLine).toHaveClass('bg-primary/5')
    })

    const lines = screen.getAllByTestId(/^code-line-/)
    const currentLine = lines[2]

    expect(currentLine).toHaveClass('border-l-2')
    expect(currentLine).toHaveClass('border-primary')
  })

  test('renders all lines correctly', () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    const lines = screen.getAllByTestId(/^code-line-/)

    expect(lines).toHaveLength(7) // 7 lines in sampleCode
  })

  test('detects TypeScript language from .tsx extension', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    await waitFor(() => {
      expect(shikiService.detectLanguage).toHaveBeenCalledWith('App.tsx')
    })
  })

  test('detects JavaScript language from .js extension', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="app.js" />
    )

    await waitFor(() => {
      expect(shikiService.detectLanguage).toHaveBeenCalledWith('app.js')
    })
  })

  test('handles empty content', () => {
    render(<CodeEditor content="" currentLine={null} fileName="empty.txt" />)

    const container = screen.getByTestId('code-editor')

    expect(container).toBeInTheDocument()
  })

  test('handles single line content', () => {
    render(
      <CodeEditor content="const x = 1" currentLine={1} fileName="test.ts" />
    )

    const lines = screen.getAllByTestId(/^code-line-/)

    expect(lines).toHaveLength(1)
  })

  test('calls highlightCode with correct arguments', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={null} fileName="App.tsx" />
    )

    await waitFor(() => {
      expect(shikiService.highlightCode).toHaveBeenCalledWith(
        sampleCode,
        'typescript'
      )
    })
  })

  test('non-current lines do not have highlight styling', async () => {
    render(
      <CodeEditor content={sampleCode} currentLine={3} fileName="App.tsx" />
    )

    await waitFor(() => {
      const lines = screen.getAllByTestId(/^code-line-/)
      const nonCurrentLine = lines[0] // Line 1 (not current)

      expect(nonCurrentLine).not.toHaveClass('bg-primary/5')
      expect(nonCurrentLine).not.toHaveClass('border-l-2')
    })
  })
})
