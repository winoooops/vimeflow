import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeEditor } from './CodeEditor'

describe('CodeEditor', () => {
  const sampleCode = `import React from 'react'

const App = () => {
  return <div>Hello</div>
}

export default App`

  test('renders code content', () => {
    render(<CodeEditor content={sampleCode} currentLine={null} />)

    expect(screen.getByTestId('code-line-1')).toBeInTheDocument()
    expect(screen.getByTestId('code-line-3')).toHaveTextContent(
      'const App = () => {'
    )

    expect(screen.getByTestId('code-line-7')).toHaveTextContent(
      'export default App'
    )
  })

  test('applies correct container styling', () => {
    render(<CodeEditor content={sampleCode} currentLine={null} />)

    const container = screen.getByTestId('code-editor')

    expect(container).toHaveClass('flex-1')
    expect(container).toHaveClass('bg-surface')
    expect(container).toHaveClass('font-mono')
    expect(container).toHaveClass('overflow-auto')
  })

  test('uses correct font size and line height', () => {
    render(<CodeEditor content={sampleCode} currentLine={null} />)

    const container = screen.getByTestId('code-editor')

    expect(container).toHaveClass('text-[0.875rem]')
    expect(container).toHaveClass('leading-6')
  })

  test('highlights current line', () => {
    render(<CodeEditor content={sampleCode} currentLine={3} />)

    const lines = screen.getAllByTestId(/^code-line-/)
    const currentLine = lines[2] // 0-indexed, so line 3 is index 2

    expect(currentLine).toHaveClass('bg-surface-container-high')
  })

  test('renders all lines correctly', () => {
    render(<CodeEditor content={sampleCode} currentLine={null} />)

    const lines = screen.getAllByTestId(/^code-line-/)

    expect(lines).toHaveLength(7) // 7 lines in sampleCode
  })

  test('applies syntax highlighting to keywords', () => {
    render(
      <CodeEditor content="import const export function" currentLine={null} />
    )

    const codeLine = screen.getByTestId('code-line-1')

    expect(codeLine).toBeInTheDocument()
    expect(codeLine.textContent).toBe('import const export function')
  })

  test('handles empty content', () => {
    render(<CodeEditor content="" currentLine={null} />)

    const container = screen.getByTestId('code-editor')

    expect(container).toBeInTheDocument()
  })

  test('handles single line content', () => {
    render(<CodeEditor content="const x = 1" currentLine={1} />)

    const lines = screen.getAllByTestId(/^code-line-/)

    expect(lines).toHaveLength(1)
  })
})
