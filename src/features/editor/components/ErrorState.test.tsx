import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorState } from './ErrorState'

describe('ErrorState', () => {
  test('renders with error icon and message', () => {
    const errorMessage = 'Failed to load file'
    render(<ErrorState message={errorMessage} />)

    // Verify icon is present
    const icon = screen.getByText('error_outline')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')

    // Verify error message
    const message = screen.getByText(/Failed to load file/)
    expect(message).toBeInTheDocument()
  })

  test('has correct styling for dark atmospheric design', () => {
    render(<ErrorState message="Error" />)

    // Verify container has flex centering classes
    const wrapper = screen.getByTestId('error-state')
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center')
  })

  test('icon has correct size and color', () => {
    render(<ErrorState message="Error" />)

    const icon = screen.getByText('error_outline')
    // Check for text-6xl (64px equivalent) and error color
    expect(icon.className).toMatch(/text-6xl/)
    expect(icon.className).toMatch(/text-error/)
  })

  test('error message has correct styling', () => {
    render(<ErrorState message="Something went wrong" />)

    const message = screen.getByText(/Something went wrong/)
    expect(message.className).toMatch(/text-on-surface-variant/)
    expect(message.className).toMatch(/text-sm/)
  })

  test('has accessible structure', () => {
    render(<ErrorState message="Error" />)

    // Icon should have aria-hidden
    const icon = screen.getByText('error_outline')
    expect(icon).toHaveAttribute('aria-hidden', 'true')

    // Container should have role for screen readers
    const wrapper = screen.getByRole('alert')
    expect(wrapper).toBeInTheDocument()
  })

  test('displays custom error message', () => {
    const customMessage = 'Permission denied'
    render(<ErrorState message={customMessage} />)

    const message = screen.getByText(/Permission denied/)
    expect(message).toBeInTheDocument()
  })

  test('displays prefixed error message', () => {
    render(<ErrorState message="File not found" />)

    // Should show "Error: " prefix
    const message = screen.getByText(/Error:.*File not found/)
    expect(message).toBeInTheDocument()
  })
})
