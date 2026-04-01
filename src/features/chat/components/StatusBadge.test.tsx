import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  test('renders with provided status text', () => {
    render(<StatusBadge status="Thinking" />)
    expect(screen.getByRole('status')).toHaveTextContent('THINKING')
  })

  test('transforms status text to uppercase', () => {
    render(<StatusBadge status="refactoring" />)
    expect(screen.getByRole('status')).toHaveTextContent('REFACTORING')
  })

  test('applies correct Tailwind classes for styling', () => {
    render(<StatusBadge status="Completed" />)
    const badge = screen.getByRole('status')

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
    expect(screen.getByRole('status')).toHaveTextContent('PENDING')

    rerender(<StatusBadge status="Error" />)
    expect(screen.getByRole('status')).toHaveTextContent('ERROR')

    rerender(<StatusBadge status="Success" />)
    expect(screen.getByRole('status')).toHaveTextContent('SUCCESS')
  })

  test('handles empty string status', () => {
    render(<StatusBadge status="" />)
    const badge = screen.getByRole('status')
    expect(badge).toBeEmptyDOMElement()
  })

  test('renders as a span element', () => {
    render(<StatusBadge status="Active" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveTextContent('ACTIVE')
    expect(badge.tagName).toBe('SPAN')
  })
})
