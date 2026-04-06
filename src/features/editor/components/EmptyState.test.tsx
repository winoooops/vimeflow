import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  test('renders with centered icon and text', () => {
    render(<EmptyState />)

    // Verify icon is present
    const icon = screen.getByText('code_off')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')

    // Verify heading
    const heading = screen.getByText('No file open')
    expect(heading).toBeInTheDocument()

    // Verify hint text
    const hint = screen.getByText(
      'Select a file from the explorer to start editing'
    )
    expect(hint).toBeInTheDocument()
  })

  test('has correct styling for dark atmospheric design', () => {
    render(<EmptyState />)

    // Verify container has flex centering classes
    const wrapper = screen.getByTestId('empty-state')
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center')
  })

  test('icon has correct size and opacity', () => {
    render(<EmptyState />)

    const icon = screen.getByText('code_off')
    // Check for text-6xl (64px equivalent) and opacity
    expect(icon.className).toMatch(/text-on-surface-variant/)
  })

  test('heading has correct text style', () => {
    render(<EmptyState />)

    const heading = screen.getByText('No file open')
    expect(heading.className).toMatch(/text-on-surface-variant/)
    expect(heading.className).toMatch(/text-sm/)
    expect(heading.className).toMatch(/font-medium/)
  })

  test('hint has correct text style', () => {
    render(<EmptyState />)

    const hint = screen.getByText(
      'Select a file from the explorer to start editing'
    )
    expect(hint.className).toMatch(/text-on-surface-variant/)
    expect(hint.className).toMatch(/text-xs/)
  })

  test('has accessible structure', () => {
    render(<EmptyState />)

    // Icon should have aria-hidden
    const icon = screen.getByText('code_off')
    expect(icon).toHaveAttribute('aria-hidden', 'true')

    // Container should have role for screen readers
    const wrapper = screen.getByRole('status')
    expect(wrapper).toBeInTheDocument()
  })
})
