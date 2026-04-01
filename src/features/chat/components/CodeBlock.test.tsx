import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'

describe('CodeBlock', () => {
  test('renders code block with all elements', () => {
    render(
      <CodeBlock
        filename="auth_middleware.py"
        language="python"
        code="import redis_client"
      />
    )

    const figure = screen.getByRole('figure', { name: 'auth_middleware.py' })
    expect(figure).toBeInTheDocument()
    expect(screen.getByText('auth_middleware.py')).toBeInTheDocument()
    expect(screen.getByText('PYTHON')).toBeInTheDocument()
    expect(screen.getByText('import redis_client')).toBeInTheDocument()
  })

  test('applies correct Tailwind classes to container', () => {
    render(
      <CodeBlock filename="test.ts" language="typescript" code="const x = 1" />
    )

    const container = screen.getByRole('figure', { name: 'test.ts' })
    expect(container).toHaveClass('bg-surface-container-highest')
    expect(container).toHaveClass('rounded-lg')
    expect(container).toHaveClass('p-4')
    expect(container).toHaveClass('font-label')
    expect(container).toHaveClass('text-[13px]')
    expect(container).toHaveClass('border-l-4')
    expect(container).toHaveClass('border-secondary')
    expect(container).toHaveClass('overflow-x-auto')
    expect(container).toHaveClass('shadow-inner')
  })

  test('renders language badge in uppercase', () => {
    render(
      <CodeBlock filename="test.js" language="javascript" code="const x = 1" />
    )

    expect(screen.getByText('JAVASCRIPT')).toBeInTheDocument()
  })

  test('renders file icon in header', () => {
    render(<CodeBlock filename="test.py" language="python" code="print(1)" />)

    const header = screen.getByTestId('code-block-header')
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const icon = header.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
  })

  test('applies correct styling to header', () => {
    render(<CodeBlock filename="test.py" language="python" code="print(1)" />)

    const header = screen.getByTestId('code-block-header')
    expect(header).toHaveClass('flex')
    expect(header).toHaveClass('items-center')
    expect(header).toHaveClass('justify-between')
    expect(header).toHaveClass('mb-3')
    expect(header).toHaveClass('border-b')
    expect(header).toHaveClass('border-outline-variant/20')
    expect(header).toHaveClass('pb-2')
  })

  test('applies correct styling to code element', () => {
    render(<CodeBlock filename="test.py" language="python" code="print(1)" />)

    const codeElement = screen.getByTestId('code-block-code')
    expect(codeElement).toHaveClass('text-[#f8f8f2]')
  })

  test('preserves whitespace in code', () => {
    const codeWithSpaces = '  def hello():\n    print("world")'
    render(
      <CodeBlock filename="test.py" language="python" code={codeWithSpaces} />
    )

    const codeElement = screen.getByTestId('code-block-code')
    // Use textContent directly to preserve whitespace (toHaveTextContent normalizes it)
    expect(codeElement.textContent).toBe(codeWithSpaces)
  })

  test('handles empty code', () => {
    render(<CodeBlock filename="empty.txt" language="text" code="" />)

    const codeElement = screen.getByTestId('code-block-code')
    expect(codeElement).toBeEmptyDOMElement()
  })

  test('handles long filenames', () => {
    const longFilename = 'very_long_filename_that_might_wrap_in_ui.py'
    render(
      <CodeBlock filename={longFilename} language="python" code="print(1)" />
    )

    const figure = screen.getByRole('figure', { name: longFilename })
    expect(figure).toBeInTheDocument()
  })
})
