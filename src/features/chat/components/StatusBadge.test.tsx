import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  test('renders with provided status text', () => {
    render(<StatusBadge status="Thinking" />)
    expect(screen.getByText('THINKING')).toBeInTheDocument()
  })

  test('transforms status text to uppercase', () => {
    render(<StatusBadge status="refactoring" />)
    expect(screen.getByText('REFACTORING')).toBeInTheDocument()
  })

  test('applies correct Tailwind classes for styling', () => {
    render(<StatusBadge status="Completed" />)
    const badge = screen.getByText('COMPLETED')

    // Check that the badge element exists and has the expected classes
    expect(badge).toHaveClass('bg-secondary/10')
    expect(badge).toHaveClass('text-secondary')
    expect(badge).toHaveClass('text-[9px]')
    expect(badge).toHaveClass('px-1.5')
    expect(badge).toHaveClass('py-0.5')
    expect(badge).toHaveClass('rounded')
    expect(badge).toHaveClass('font-bold')
    expect(badge).toHaveClass('uppercase')
    expect(badge).toHaveClass('tracking-wider')
  })

  test('renders with different status values', () => {
    const { rerender } = render(<StatusBadge status="Pending" />)
    expect(screen.getByText('PENDING')).toBeInTheDocument()

    rerender(<StatusBadge status="Error" />)
    expect(screen.getByText('ERROR')).toBeInTheDocument()

    rerender(<StatusBadge status="Success" />)
    expect(screen.getByText('SUCCESS')).toBeInTheDocument()
  })

  test('handles empty string status', () => {
    render(<StatusBadge status="" />)
    const badge = screen.getByTestId('status-badge')
    expect(badge).toBeEmptyDOMElement()
  })

  test('renders as a span element', () => {
    render(<StatusBadge status="Active" />)
    const badge = screen.getByText('ACTIVE')
    expect(badge.tagName).toBe('SPAN')
  })
})
