import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { DiffLine } from './DiffLine'
import type { DiffLine as DiffLineType } from '../types'

describe('DiffLine', () => {
  const mockOnRightClick = vi.fn()

  test('renders added line with green styling', () => {
    const line: DiffLineType = {
      type: 'added',
      newLineNumber: 42,
      content: 'const newFeature = true',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Check for line number
    expect(screen.getByText('42')).toBeInTheDocument()

    // Check for + prefix
    expect(screen.getByText('+')).toBeInTheDocument()

    // Check for content
    expect(screen.getByText('const newFeature = true')).toBeInTheDocument()

    // Check for green styling class on the main container
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const lineElement = container.querySelector('.diff-added')
    expect(lineElement).toBeInTheDocument()
  })

  test('renders removed line with red styling', () => {
    const line: DiffLineType = {
      type: 'removed',
      oldLineNumber: 15,
      content: 'const oldFeature = false',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Check for line number
    expect(screen.getByText('15')).toBeInTheDocument()

    // Check for - prefix
    expect(screen.getByText('-')).toBeInTheDocument()

    // Check for content
    expect(screen.getByText('const oldFeature = false')).toBeInTheDocument()

    // Check for red styling class on the main container
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const lineElement = container.querySelector('.diff-removed')
    expect(lineElement).toBeInTheDocument()
  })

  test('renders context line without prefix or background', () => {
    const line: DiffLineType = {
      type: 'context',
      oldLineNumber: 10,
      newLineNumber: 10,
      content: 'unchanged code',
      highlights: [],
    }

    render(<DiffLine line={line} onRightClick={mockOnRightClick} />)

    // Check for both line numbers
    const lineNumbers = screen.getAllByText('10')
    expect(lineNumbers).toHaveLength(2) // old and new line numbers

    // Check for content (no prefix)
    expect(screen.getByText('unchanged code')).toBeInTheDocument()

    // Check no diff styling
    // eslint-disable-next-line testing-library/no-node-access
    const lineElement = screen.getByText('unchanged code').closest('div')
    expect(lineElement).not.toHaveClass('diff-added')
    expect(lineElement).not.toHaveClass('diff-removed')
  })

  test('preserves leading whitespace and tabs in code content', () => {
    const line: DiffLineType = {
      type: 'context',
      oldLineNumber: 10,
      newLineNumber: 10,
      content: '\t  unchanged code',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const contentDiv = container.querySelector('.whitespace-pre')
    expect(contentDiv).toBeInTheDocument()
    expect(contentDiv?.textContent).toBe('\t  unchanged code')
    expect(contentDiv).toHaveStyle({ tabSize: '2' })
  })

  test('renders word-level highlights for added lines', () => {
    const line: DiffLineType = {
      type: 'added',
      newLineNumber: 5,
      content: '  const value = newValue',
      highlights: [{ start: 16, end: 24 }], // highlight "newValue"
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Check that "newValue" is highlighted
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const highlightedSpan = container.querySelector('.diff-highlight-added')
    expect(highlightedSpan).toBeInTheDocument()
    expect(highlightedSpan?.textContent).toBe('newValue')

    // Verify the content div contains the full text
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const contentDiv = container.querySelector('.whitespace-pre.font-mono')
    expect(contentDiv?.textContent).toBe('  const value = newValue')
  })

  test('renders word-level highlights for removed lines', () => {
    const line: DiffLineType = {
      type: 'removed',
      oldLineNumber: 5,
      content: '  const value = oldValue',
      highlights: [{ start: 16, end: 24 }], // highlight "oldValue"
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Check that "oldValue" is highlighted
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const highlightedSpan = container.querySelector('.diff-highlight-removed')
    expect(highlightedSpan).toBeInTheDocument()
    expect(highlightedSpan?.textContent).toBe('oldValue')

    // Verify the content div contains the full text
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const contentDiv = container.querySelector('.whitespace-pre.font-mono')
    expect(contentDiv?.textContent).toBe('  const value = oldValue')
  })

  test('renders multiple word highlights', () => {
    const line: DiffLineType = {
      type: 'added',
      newLineNumber: 7,
      content: '  const foo = bar + baz',
      highlights: [
        { start: 8, end: 11 }, // "foo"
        { start: 20, end: 23 }, // "baz"
      ],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Verify the content div contains the full text
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const contentDiv = container.querySelector('.whitespace-pre.font-mono')
    expect(contentDiv?.textContent).toBe('  const foo = bar + baz')

    // Check for multiple highlights
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const highlights = container.querySelectorAll('.diff-highlight-added')
    expect(highlights).toHaveLength(2)
    expect(highlights[0]?.textContent).toBe('foo')
    expect(highlights[1]?.textContent).toBe('baz')
  })

  test('applies focused state styling when isFocused is true', () => {
    const line: DiffLineType = {
      type: 'context',
      oldLineNumber: 20,
      newLineNumber: 20,
      content: '  some code',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} isFocused onRightClick={mockOnRightClick} />
    )

    // Check for focus styling class
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const lineElement = container.querySelector('.bg-surface-bright\\/20')
    expect(lineElement).toBeInTheDocument()
  })

  test('does not apply focused state when isFocused is false', () => {
    const line: DiffLineType = {
      type: 'context',
      oldLineNumber: 20,
      newLineNumber: 20,
      content: '  some code',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Should not have focus styling
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const lineElement = container.querySelector('.bg-surface-bright\\/20')
    expect(lineElement).not.toBeInTheDocument()
  })

  test('calls onRightClick callback when right-clicked', async () => {
    const user = userEvent.setup()

    const line: DiffLineType = {
      type: 'added',
      newLineNumber: 42,
      content: '  const test = true',
      highlights: [],
    }

    render(<DiffLine line={line} onRightClick={mockOnRightClick} />)

    const lineContent = screen.getByText('const test = true')

    // Simulate right-click
    await user.pointer({ keys: '[MouseRight]', target: lineContent })

    expect(mockOnRightClick).toHaveBeenCalledTimes(1)
  })

  test('renders gutter with right-aligned monospace line numbers', () => {
    const line: DiffLineType = {
      type: 'context',
      oldLineNumber: 123,
      newLineNumber: 123,
      content: '  code',
      highlights: [],
    }

    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )

    // Line numbers should have monospace font and right alignment
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const gutters = container.querySelectorAll('.font-mono.text-right')
    expect(gutters.length).toBeGreaterThan(0)
  })

  test('renders only new line number for added lines', () => {
    const line: DiffLineType = {
      type: 'added',
      newLineNumber: 42,
      content: 'new line',
      highlights: [],
    }

    render(<DiffLine line={line} onRightClick={mockOnRightClick} />)

    // Should show new line number
    expect(screen.getByText('42')).toBeInTheDocument()

    // Old line number gutter should be empty (but present)
    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const gutters = container.querySelectorAll('.font-mono.text-right')
    expect(gutters).toHaveLength(2) // Both gutters present, one empty
  })

  test('renders only old line number for removed lines', () => {
    const line: DiffLineType = {
      type: 'removed',
      oldLineNumber: 15,
      content: 'removed line',
      highlights: [],
    }

    render(<DiffLine line={line} onRightClick={mockOnRightClick} />)

    // Should show old line number
    expect(screen.getByText('15')).toBeInTheDocument()

    // New line number gutter should be empty (but present)
    const { container } = render(
      <DiffLine line={line} onRightClick={mockOnRightClick} />
    )
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const gutters = container.querySelectorAll('.font-mono.text-right')
    expect(gutters).toHaveLength(2) // Both gutters present, one empty
  })
})
