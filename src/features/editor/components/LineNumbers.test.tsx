import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineNumbers } from './LineNumbers'

describe('LineNumbers', () => {
  test('renders line numbers for given line count', () => {
    render(<LineNumbers lineCount={10} currentLine={null} />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  test('renders large line numbers correctly', () => {
    render(<LineNumbers lineCount={100} currentLine={null} />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  test('highlights current line number', () => {
    render(<LineNumbers lineCount={10} currentLine={5} />)

    const currentLineNumber = screen.getByText('5')

    expect(currentLineNumber).toHaveClass('text-primary-container/60')
  })

  test('applies correct styling to line number container', () => {
    render(<LineNumbers lineCount={5} currentLine={null} />)

    const gutter = screen.getByTestId('line-numbers-gutter')

    expect(gutter).toHaveClass('w-14')
    expect(gutter).toHaveClass('bg-surface-container-low')
    expect(gutter).toHaveClass('font-mono')
    expect(gutter).toHaveClass('text-right')
  })

  test('renders with correct line height', () => {
    render(<LineNumbers lineCount={5} currentLine={null} />)

    const gutter = screen.getByTestId('line-numbers-gutter')

    expect(gutter).toHaveClass('leading-6')
  })

  test('renders with correct text size', () => {
    render(<LineNumbers lineCount={5} currentLine={null} />)

    const gutter = screen.getByTestId('line-numbers-gutter')

    expect(gutter).toHaveClass('text-[0.75rem]')
  })
})
